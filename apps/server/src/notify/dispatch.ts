import { db } from '../db.js';
import { emailTemplateFor, moduleSettings, type NotifyModule } from '../hr/approval.js';
import {
  renderTemplate,
  textToHtml,
  type TemplateEvent,
  type TemplateVars,
} from '../hr/email-template.js';
import { logger } from '../logger.js';
import { sendMail } from './email.js';
import { sendSmsWith } from './sms.js';
import { sendTelegramWith } from './telegram.js';
import { sanitiseTriggers, triggerLabel } from './triggers.js';

/**
 * Fans one event out to whichever channels are subscribed to it.
 *
 * Never throws. A notification is a side effect of something that already succeeded — a
 * leave request was approved, the roster was written, attendance was recomputed — and
 * failing that operation because a gateway was unreachable would turn a missing SMS into
 * a missing approval. Failures are logged and dropped.
 *
 * Nothing is queued or retried beyond what each channel does internally. That is a real
 * limitation, stated rather than hidden: if the gateway is down when the event happens,
 * the notification is lost. A durable outbox is the right answer once these messages
 * matter enough that somebody would go looking for a missing one.
 */

export interface NotificationEvent {
  trigger: string;
  /** One line, used as the SMS body and the Telegram message. */
  summary: string;
  /** Optional extra lines. Telegram gets them; SMS does not, because SMS is billed. */
  lines?: string[];
  /** Mobile number for the SMS channel. Without one, only the broadcast channels fire. */
  mobile?: string | null;
  /**
   * Everything the email part needs, when this event has one.
   *
   * Omitted for events with no addressable recipient — a device going offline is nobody's
   * mail. Supplying it does not guarantee a send: the module still has to have nominated a
   * profile, and the template for the event still has to be switched on.
   */
  email?: {
    /** Which module's profile and template to use. */
    module: NotifyModule;
    event: TemplateEvent;
    /** Recipient. Without one there is nothing to send to. */
    to?: string | null;
    /** Placeholder values for the template. */
    vars: TemplateVars;
  };
}

export function notify(event: NotificationEvent): void {
  // Deliberately not awaited by callers. `void` marks that the fire-and-forget is
  // intentional rather than a forgotten await.
  void dispatch(event).catch((cause: unknown) => {
    logger().error({ err: cause, trigger: event.trigger }, 'Notification dispatch crashed');
  });
}

async function dispatch(event: NotificationEvent): Promise<void> {
  const [sms, telegram] = await Promise.all([
    db().smsConfig.findUnique({ where: { id: 1 } }),
    db().telegramConfig.findUnique({ where: { id: 1 } }),
  ]);

  const label = triggerLabel(event.trigger);

  if (
    sms !== null &&
    sms.enabled &&
    sanitiseTriggers(sms.triggers).includes(event.trigger) &&
    event.mobile
  ) {
    try {
      // Only the summary. Every extra line is a billed segment, and an SMS that runs to
      // three parts costs three times as much to say the same thing.
      const outcome = await sendSmsWith(sms, { to: event.mobile, text: event.summary });
      logger().info({ trigger: event.trigger, to: outcome.to }, 'Notification SMS sent');
    } catch (cause) {
      logger().warn(
        { trigger: event.trigger, error: cause instanceof Error ? cause.message : String(cause) },
        'Notification SMS failed',
      );
    }
  }

  if (
    telegram !== null &&
    telegram.enabled &&
    sanitiseTriggers(telegram.triggers).includes(event.trigger)
  ) {
    try {
      const text = [`${label}`, '', event.summary, ...(event.lines ?? [])].join('\n');
      await sendTelegramWith(telegram, text);
      logger().info({ trigger: event.trigger }, 'Notification Telegram sent');
    } catch (cause) {
      logger().warn(
        { trigger: event.trigger, error: cause instanceof Error ? cause.message : String(cause) },
        'Notification Telegram failed',
      );
    }
  }

  await dispatchEmail(event);
}

/**
 * The email part.
 *
 * This used to be a comment explaining why email could not be sent: there are several named
 * profiles rather than one configuration, so "send this by email" had no answer until
 * something could name the sender. A module setting now does, and that is the whole reason
 * it exists.
 *
 * Four things must all be true before anything is sent, and each one is a decision somebody
 * made rather than a failure:
 *
 *   a recipient address        — no address, nothing to send to
 *   a nominated profile        — blank means this module does not send email
 *   an enabled template        — an event can be switched off on its own
 *   an active profile          — `sendMail` refuses an inactive one
 *
 * Never throws, like the rest of dispatch. A relay being unreachable must not fail the
 * approval that already succeeded.
 */
/**
 * The hospital's name, for the template signature. Empty when nobody has set one.
 *
 * The settings column is JSON, so the value arrives as `unknown` and is narrowed rather than
 * cast. A number or an object here would be a corrupted row, and printing `[object Object]`
 * into an email is worse than printing nothing.
 */
async function organisationName(): Promise<string> {
  const row = await db().setting.findUnique({ where: { key: 'organisation.name' } });
  return typeof row?.value === 'string' ? row.value : '';
}

async function dispatchEmail(event: NotificationEvent): Promise<void> {
  const spec = event.email;
  if (spec === undefined || !spec.to) return;

  const settings = await moduleSettings(spec.module);
  const profileKey = settings.emailProfileKey.trim();
  if (profileKey === '') return;

  const template = await emailTemplateFor(spec.module, spec.event);
  if (template === null) return;

  /*
   * Injected here rather than passed by every caller.
   *
   * It is the same value for every module and every event, so asking each route to supply it
   * would be four places to forget it — and a template headed by an em dash where the
   * hospital's name belongs looks like a broken system rather than a missing setting.
   */
  const vars = { organisation: await organisationName(), ...spec.vars };

  const subject = renderTemplate(template.subject, vars);
  const body = renderTemplate(template.body, vars);

  /*
   * A placeholder the module cannot fill is logged rather than swallowed.
   *
   * `renderTemplate` prints an em dash so a recipient never sees template syntax, but a
   * template referring to a field that does not exist is a typo somebody should find — and
   * the editor's save-time check only catches it if the template was saved after this
   * placeholder list existed.
   */
  const unfilled = [...new Set([...subject.unknown, ...body.unknown])];
  if (unfilled.length > 0) {
    logger().warn(
      { module: spec.module, event: spec.event, unfilled },
      'Email template refers to placeholders this module does not supply',
    );
  }

  const recipients =
    settings.ccEmail.trim() === '' ? spec.to : `${spec.to}, ${settings.ccEmail.trim()}`;

  try {
    const outcome = await sendMail(profileKey, {
      to: recipients,
      subject: subject.output,
      text: body.output,
      // Both parts, so a client that prefers HTML still shows paragraphs and one that does
      // not falls back to the text the operator actually wrote.
      html: textToHtml(body.output),
    });
    logger().info(
      { trigger: event.trigger, profile: profileKey, attempts: outcome.attempts },
      'Notification email sent',
    );
  } catch (cause) {
    logger().warn(
      {
        trigger: event.trigger,
        profile: profileKey,
        error: cause instanceof Error ? cause.message : String(cause),
      },
      'Notification email failed',
    );
  }
}
