import {
  BadgeCheck,
  Building2,
  Camera,
  Fingerprint,
  KeyRound,
  Languages,
  Loader2,
  Lock,
  MapPin,
  Save,
  ShieldCheck,
  TriangleAlert,
  User,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { CONTROL, ChannelHint, SettingRow } from '../components/ChannelForm';
import { Feedback } from '../components/Dialog';
import {
  KeyValue,
  KeyValueList,
  PanelActions,
  PanelBody,
  PanelCard,
  PanelNote,
  PanelSection,
  SettingsGroup,
  SettingsStack,
} from '../components/RecordPanel';
import { Button } from '../components/ui';
import { cn } from '../lib/cn';
import { formatDateOnly, formatDateTime } from '../lib/operations-api';
import { formatRinggit } from '../lib/overtime-api';
import { profileApi, type ProfileEditable, type ProfilePayload } from '../lib/settings-api';
import { useAuth } from '../lib/auth';
import { T, useLabels } from '../lib/translation';

/**
 * A person's own record.
 *
 * The organising idea is the split between two cards: what you own and what the
 * organisation owns. Your phone number, your address, your photo, your password — yours.
 * Your employee number, your name as payroll spells it, and your department — not, and
 * shown here so you can check them and tell HR if they are wrong.
 *
 * That line is not a UI preference. The employee number is the join key to every terminal
 * and every attendance row, and the department drives payroll subtotals — somebody retyping
 * their own would move money between cost centres with nobody approving it.
 */
export function ProfilePage(): ReactNode {
  const { refreshDisplay } = useAuth();
  const { t } = useLabels();
  const [data, setData] = useState<ProfilePayload | null>(null);
  const [form, setForm] = useState<ProfileEditable | null>(null);
  /**
   * Held apart from `form` because it is not a staff column.
   *
   * `form` mirrors the nine fields on the staff row; the language lives on the account. They
   * travel in one request and share one save button, but keeping them separate in state is
   * what lets the payload's `editable` block stay exactly the fields it has always been.
   */
  const [locale, setLocale] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await profileApi.load();
      setData(payload);
      setForm(payload.editable);
      setLocale(payload.language.chosen);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profile.error.load'));
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (form === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await profileApi.save({ ...form, locale });
      setNotice(t('profile.saved'));
      await load();
      /*
       * The language change lands through here.
       *
       * `refreshDisplay()` re-reads the session, which is where the resolved locale lives, and
       * `TranslationProvider` watches that value — so the new wording arrives without a reload
       * and without this screen knowing anything about the dictionary.
       */
      await refreshDisplay();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  if (data === null || form === null) {
    return (
      <PanelCard title={<T k="profile.title" />}>
        {error !== null ? (
          <PanelBody>
            <Feedback error={error} />
          </PanelBody>
        ) : (
          <div className="flex min-h-48 items-center justify-center">
            <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
          </div>
        )}
      </PanelCard>
    );
  }

  const set = <K extends keyof ProfileEditable>(key: K, value: string): void => {
    setForm((current) => (current === null ? current : { ...current, [key]: value }));
  };

  const dirty =
    JSON.stringify(form) !== JSON.stringify(data.editable) || locale !== data.language.chosen;

  /*
   * One language on offer means nothing to choose.
   *
   * The select is replaced with a note rather than hidden: a box holding a single option reads
   * as a list that failed to load, and dropping the section entirely leaves somebody who was
   * told they can change language with nowhere to do it.
   */
  const canChooseLanguage = data.language.options.length > 1;

  return (
    <PanelCard
      title={<T k="profile.title" />}
      subtitle={<T k="profile.subtitle" />}
    >
      <PanelSection
        icon={<User className="size-4" aria-hidden />}
        title={data.managed.fullName}
        subtitle={
          <T
            k="profile.header.subtitle"
            vars={{ employeeNo: data.managed.employeeNo, roleName: data.managed.roleName }}
          />
        }
        action={
          data.managed.twoFactorEnabled ? (
            <span className="inline-flex items-center gap-1.5 rounded bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-emerald-700">
              <ShieldCheck className="size-3" aria-hidden />
              <T k="profile.twoFactor.on" />
            </span>
          ) : (
            <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-amber-700">
              <T k="profile.twoFactor.off" />
            </span>
          )
        }
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        <SettingsGroup
          title={<T k="profile.group.photo" />}
          icon={<Camera className="size-3.5" aria-hidden />}
        >
          <PhotoRow
            photo={data.photo}
            maxBytes={data.limits.maxPhotoBytes}
            onChanged={async () => {
              await load();
              await refreshDisplay();
            }}
          />
        </SettingsGroup>

        <SettingsGroup
          title={<T k="profile.group.basic" />}
          icon={<BadgeCheck className="size-3.5" aria-hidden />}
          subtitle={<T k="profile.group.basic.subtitle" />}
        >
          <SettingRow
            label={<T k="profile.position" />}
            hint={<T k="profile.position.hint" />}
          >
            <input
              value={form.position}
              onChange={(event) => set('position', event.target.value)}
              placeholder={t('profile.position.placeholder')}
              aria-label={t('profile.position')}
              className={CONTROL}
            />
          </SettingRow>

          <SettingRow label={<T k="profile.phone" />} hint={<T k="profile.phone.hint" />}>
            <input
              value={form.phone}
              onChange={(event) => set('phone', event.target.value)}
              placeholder="+60123456789"
              aria-label={t('profile.phone')}
              className={cn(CONTROL, 'max-w-64 font-mono')}
            />
          </SettingRow>

          <SettingRow
            label={<T k="profile.contactEmail" />}
            hint={<T k="profile.contactEmail.hint" />}
          >
            <input
              type="email"
              value={form.contactEmail}
              onChange={(event) => set('contactEmail', event.target.value)}
              placeholder="nama@contoh.com"
              aria-label={t('profile.contactEmail')}
              className={CONTROL}
            />
          </SettingRow>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="profile.group.address" />}
          icon={<MapPin className="size-3.5" aria-hidden />}
          subtitle={<T k="profile.group.address.subtitle" />}
        >
          {/*
            Said once here rather than under six fields. A cascade of Malaysian states,
            cities and postcodes is a dataset to keep current for a field nothing computes
            against.
          */}
          <SettingRow label={<T k="profile.address1" />}>
            <input
              value={form.addressLine1}
              onChange={(event) => set('addressLine1', event.target.value)}
              placeholder="No. 12, Jalan Tunku Abdul Rahman"
              aria-label={t('profile.address1')}
              className={CONTROL}
            />
          </SettingRow>

          <SettingRow label={<T k="profile.address2" />}>
            <input
              value={form.addressLine2}
              onChange={(event) => set('addressLine2', event.target.value)}
              placeholder="Taman Sibu Jaya"
              aria-label={t('profile.address2')}
              className={CONTROL}
            />
          </SettingRow>

          <SettingRow label={<T k="profile.city" />}>
            <input
              value={form.city}
              onChange={(event) => set('city', event.target.value)}
              placeholder="Sibu"
              aria-label={t('profile.city')}
              className={cn(CONTROL, 'max-w-72')}
            />
          </SettingRow>

          <SettingRow label={<T k="profile.state" />}>
            <input
              value={form.state}
              onChange={(event) => set('state', event.target.value)}
              placeholder="Sarawak"
              aria-label={t('profile.state')}
              className={cn(CONTROL, 'max-w-72')}
            />
          </SettingRow>

          <SettingRow label={<T k="profile.postcode" />}>
            <input
              value={form.postcode}
              onChange={(event) => set('postcode', event.target.value.replace(/\D/g, ''))}
              placeholder="96000"
              aria-label={t('profile.postcode')}
              className={cn(CONTROL, 'max-w-32 font-mono')}
            />
          </SettingRow>

          <SettingRow label={<T k="profile.country" />}>
            <input
              value={form.country}
              onChange={(event) => set('country', event.target.value)}
              placeholder="Malaysia"
              aria-label={t('profile.country')}
              className={cn(CONTROL, 'max-w-72')}
            />
          </SettingRow>
        </SettingsGroup>

        {/*
          The one preference on this screen that changes the screen itself.

          Stored on the account rather than in the browser, so it follows the person to
          whatever machine they sign in from — and so an administrator reading a report about
          confusing wording can see which language that person is actually looking at.
        */}
        <SettingsGroup
          title={<T k="profile.group.language" />}
          icon={<Languages className="size-3.5" aria-hidden />}
          subtitle={<T k="profile.group.language.subtitle" />}
        >
          {canChooseLanguage ? (
            <>
              <SettingRow
                label={<T k="profile.language" />}
                hint={<T k="profile.language.hint" />}
              >
                <select
                  value={locale}
                  onChange={(event) => setLocale(event.target.value)}
                  aria-label={t('profile.language')}
                  className={cn(CONTROL, 'max-w-72')}
                >
                  {/*
                    Following the default is a real choice, not the absence of one — it means
                    "move me when the organisation moves". Naming what it currently resolves to
                    stops it reading as an empty option.
                  */}
                  <option value="">
                    {data.language.fallback === null
                      ? t('profile.language.followDefault.unknown')
                      : t('profile.language.followDefault', {
                          name: data.language.fallback.name,
                        })}
                  </option>
                  {data.language.options.map((option) => (
                    <option key={option.code} value={option.code}>
                      {option.isSource
                        ? t('profile.language.option.source', { name: option.name })
                        : option.name}
                    </option>
                  ))}
                </select>
              </SettingRow>

              <ChannelHint>
                <T k="profile.language.appliesOnSave" />
              </ChannelHint>

              <PanelNote>
                <T
                  k="profile.language.note"
                  vars={{
                    emphasis: (
                      <strong className="font-medium">
                        <T k="profile.language.note.emphasis" />
                      </strong>
                    ),
                  }}
                />
              </PanelNote>
            </>
          ) : (
            <PanelNote>
              <T k="profile.language.onlyOne" />
            </PanelNote>
          )}
        </SettingsGroup>

        {/*
          Shown, not editable, and the reason is stated. Without the reason this card reads
          as fields somebody forgot to make editable.
        */}
        <SettingsGroup
          title={<T k="profile.group.managed" />}
          icon={<Building2 className="size-3.5" aria-hidden />}
          subtitle={<T k="profile.group.managed.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400">
              <T k="profile.group.managed.readOnly" />
            </span>
          }
        >
          <div className="my-2 space-y-3">
            <KeyValueList>
              <KeyValue label={<T k="profile.managed.employeeNo" />} value={data.managed.employeeNo} />
              <KeyValue
                label={<T k="profile.managed.fullName" />}
                value={data.managed.fullName}
                mono={false}
              />
              <KeyValue label={<T k="profile.managed.icNo" />} value={data.managed.icNo ?? '—'} />
              <KeyValue
                label={<T k="profile.managed.department" />}
                value={data.managed.department ?? '—'}
                mono={false}
              />
              <KeyValue
                label={<T k="profile.managed.location" />}
                value={data.managed.location ?? '—'}
                mono={false}
              />
              <KeyValue
                label={<T k="profile.managed.hireDate" />}
                value={formatDateOnly(data.managed.hireDate)}
              />
              <KeyValue
                label={<T k="profile.managed.basicSalary" />}
                value={
                  data.managed.basicSalary === null
                    ? '—'
                    : formatRinggit(data.managed.basicSalary)
                }
              />
              <KeyValue
                label={<T k="profile.managed.loginEmail" />}
                value={data.managed.loginEmail}
              />
              <KeyValue
                label={<T k="profile.managed.roleName" />}
                value={data.managed.roleName}
                mono={false}
              />
              <KeyValue
                label={<T k="profile.managed.lastLogin" />}
                value={formatDateTime(data.managed.lastLoginAt)}
              />
            </KeyValueList>

            <PanelNote>
              <T
                k="profile.managed.note"
                vars={{
                  employeeNo: (
                    <strong className="font-medium">
                      <T k="profile.managed.note.employeeNo" />
                    </strong>
                  ),
                  department: (
                    <strong className="font-medium">
                      <T k="profile.managed.note.department" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>

            <PanelNote>
              <T
                k="profile.managed.salaryNote"
                vars={{
                  salary: (
                    <strong className="font-medium">
                      <T k="profile.managed.salaryNote.emphasis" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>
          </div>
        </SettingsGroup>

        <SettingsGroup
          title={<T k="profile.group.credentials" />}
          icon={<Fingerprint className="size-3.5" aria-hidden />}
          subtitle={<T k="profile.group.credentials.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400 tabular-nums">
              <T
                k="profile.credentials.count"
                vars={{
                  count:
                    data.managed.biometrics.face +
                    data.managed.biometrics.fingerprint +
                    data.managed.biometrics.card,
                }}
              />
            </span>
          }
        >
          <div className="my-2 space-y-3">
            <KeyValueList>
              <KeyValue
                label={<T k="profile.credentials.face" />}
                value={String(data.managed.biometrics.face)}
              />
              <KeyValue
                label={<T k="profile.credentials.fingerprint" />}
                value={String(data.managed.biometrics.fingerprint)}
              />
              <KeyValue
                label={<T k="profile.credentials.card" />}
                value={String(data.managed.biometrics.card)}
              />
            </KeyValueList>

            {/*
              The distinction that stops somebody changing their avatar believing they have
              re-enrolled their face — or an operator deleting a photo and removing a person's
              ability to clock in.
            */}
            <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
              <T
                k="profile.credentials.note"
                vars={{
                  emphasis: (
                    <strong className="font-medium">
                      <T k="profile.credentials.note.emphasis" />
                    </strong>
                  ),
                }}
              />
            </PanelNote>

            {data.managed.biometrics.face +
              data.managed.biometrics.fingerprint +
              data.managed.biometrics.card ===
              0 && (
              <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="profile.credentials.none" />
              </PanelNote>
            )}
          </div>
        </SettingsGroup>
      </SettingsStack>

      <PanelActions hint={dirty ? <T k="profile.dirty" /> : <T k="profile.clean" />}>
        <Button onClick={() => void save()} disabled={busy || !dirty}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Save className="size-4" aria-hidden />
          )}
          <T k="profile.action.save" />
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            setForm(data.editable);
            setLocale(data.language.chosen);
          }}
          disabled={busy || !dirty}
        >
          <T k="profile.action.cancel" />
        </Button>
      </PanelActions>

      <PasswordSection minLength={data.limits.passwordMinLength} />
    </PanelCard>
  );
}

// ---------------------------------------------------------------------------

function PhotoRow({
  photo,
  maxBytes,
  onChanged,
}: {
  photo: { set: boolean; url: string | null; bytes: number | null };
  maxBytes: number;
  onChanged: () => Promise<void>;
}): ReactNode {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { t } = useLabels();

  async function upload(file: File): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Checked here too, so somebody with a 3 MB photo is told before the browser spends a
      // minute sending it.
      if (file.size > maxBytes) {
        throw new Error(
          t('profile.photo.tooLarge', {
            size: Math.round(file.size / 1024),
            limit: Math.round(maxBytes / 1024),
          }),
        );
      }
      await profileApi.uploadPhoto(file);
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profile.photo.error.upload'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await profileApi.removePhoto();
      await onChanged();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profile.photo.error.remove'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <SettingRow
      label={<T k="profile.photo.label" />}
      hint={
        <T k="profile.photo.hint" vars={{ kilobytes: Math.round(maxBytes / 1024) }} />
      }
    >
      <div className="space-y-2">
        <div className="flex items-center gap-4">
          <span className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-full border border-slate-200 bg-slate-50">
            {busy ? (
              <Loader2
                className="size-5 animate-spin text-slate-400"
                aria-label={t('profile.photo.uploading')}
              />
            ) : photo.set && photo.url !== null ? (
              <img
                src={photo.url}
                alt={t('profile.photo.alt')}
                className="size-full object-cover"
              />
            ) : (
              <User className="size-6 text-slate-300" aria-hidden />
            )}
          </span>

          <div className="flex flex-wrap items-center gap-3">
            <label
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg border border-slate-300 px-2.5 py-1.5 text-xs font-medium text-slate-700',
                busy ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:bg-slate-50',
              )}
            >
              <Camera className="size-3.5" aria-hidden />
              <T k={photo.set ? 'profile.photo.replace' : 'profile.photo.choose'} />
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  // Reset so choosing the same file twice still fires a change.
                  event.target.value = '';
                  if (file) void upload(file);
                }}
                className="hidden"
              />
            </label>

            {photo.set && (
              <>
                {photo.bytes !== null && (
                  <span className="text-xs text-slate-500">
                    <T
                      k="profile.photo.size"
                      vars={{ kilobytes: Math.round(photo.bytes / 1024) }}
                    />
                  </span>
                )}
                <button
                  type="button"
                  onClick={() => void remove()}
                  disabled={busy}
                  className="text-xs font-medium text-rose-700 hover:underline disabled:opacity-50"
                >
                  <T k="app.remove" />
                </button>
              </>
            )}
          </div>
        </div>

        {error !== null && <p className="text-xs text-rose-700">{error}</p>}

        <p className="text-xs text-slate-500">
          <T k="profile.photo.savedImmediately" />
        </p>
      </div>
    </SettingRow>
  );
}

// ---------------------------------------------------------------------------

/**
 * Changing your own password.
 *
 * The current password is required, unlike the administrator reset. A session left open on
 * an unlocked machine must not be enough to lock the owner out of their own account.
 */
function PasswordSection({ minLength }: { minLength: number }): ReactNode {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const { t } = useLabels();

  const mismatch = confirm.length > 0 && next !== confirm;
  const tooShort = next.length > 0 && next.length < minLength;
  const ready = current.length > 0 && next.length >= minLength && next === confirm;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await profileApi.changePassword({
        currentPassword: current,
        newPassword: next,
      });
      setNotice(outcome.note);
      setCurrent('');
      setNext('');
      setConfirm('');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('profile.password.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PanelSection
        icon={<Lock className="size-4" aria-hidden />}
        title={<T k="profile.password.title" />}
        // "Biarkan kosong untuk mengekalkan" belongs on a form where the password sits
        // beside other fields. Here it is a section of its own with three required boxes,
        // so that wording would describe a behaviour this screen does not have.
        subtitle={<T k="profile.password.subtitle" />}
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        <SettingsGroup
          title={<T k="profile.password.group" />}
          icon={<KeyRound className="size-3.5" aria-hidden />}
        >
          <ChannelHint>
            <T k="profile.password.hint" vars={{ count: minLength }} />
          </ChannelHint>

          <SettingRow
            label={<T k="profile.password.current" />}
            hint={<T k="profile.password.current.hint" />}
            required
          >
            <input
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              autoComplete="current-password"
              aria-label={t('profile.password.current')}
              className={cn(CONTROL, 'max-w-80')}
            />
          </SettingRow>

          <SettingRow label={<T k="profile.password.new" />} required>
            <div className="space-y-1">
              <input
                type="password"
                value={next}
                onChange={(event) => setNext(event.target.value)}
                autoComplete="new-password"
                aria-label={t('profile.password.new')}
                className={cn(CONTROL, 'max-w-80')}
              />
              {tooShort && (
                <p className="text-xs text-rose-700">
                  <T
                    k="profile.password.tooShort"
                    vars={{ min: minLength, current: next.length }}
                  />
                </p>
              )}
            </div>
          </SettingRow>

          <SettingRow label={<T k="profile.password.confirm" />} required>
            <div className="space-y-1">
              <input
                type="password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                aria-label={t('profile.password.confirm')}
                className={cn(CONTROL, 'max-w-80')}
              />
              {mismatch && (
                <p className="text-xs text-rose-700">
                  <T k="profile.password.mismatch" />
                </p>
              )}
            </div>
          </SettingRow>

          {/*
            Stated before the button, not after the fact. Somebody changing their password on
            a shared workstation should know their phone is about to be signed out.
          */}
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />} className="my-2">
            <T
              k="profile.password.otherSessions"
              vars={{
                emphasis: (
                  <strong className="font-medium">
                    <T k="profile.password.otherSessions.emphasis" />
                  </strong>
                ),
              }}
            />
          </PanelNote>
        </SettingsGroup>
      </SettingsStack>

      <PanelActions>
        <Button onClick={() => void submit()} disabled={busy || !ready}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <KeyRound className="size-4" aria-hidden />
          )}
          <T k="profile.password.action" />
        </Button>
      </PanelActions>
    </>
  );
}
