import {
  ArrowLeft,
  Ban,
  CircleCheck,
  Eye,
  EyeOff,
  Languages,
  Loader2,
  Pencil,
  Plus,
  Save,
  Star,
  Trash2,
  TriangleAlert,
} from 'lucide-react';
import { useCallback, useEffect, useState, type ReactNode } from 'react';

import { useAuth } from '../lib/auth';
import { cn } from '../lib/cn';
import { LabelBadge, T, useLabels, useTranslation } from '../lib/translation';
import {
  translationApi,
  type TranslationLabel,
  type TranslationLabelsPayload,
  type TranslationLocale,
  type TranslationLocalesPayload,
} from '../lib/settings-api';
import { CONTROL, ChannelHint, SettingRow } from './ChannelForm';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import {
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
  RecordTable,
  RowAction,
  RowActions,
  SettingsGroup,
  SettingsStack,
} from './RecordPanel';
import { Button } from './ui';

/**
 * Interface wording.
 *
 * Two views in one tab: the list of languages, and the editor for one of them. The editor
 * replaces the list rather than expanding a row — it is a column of inputs, one per label,
 * and eventually there will be hundreds.
 *
 * Malay is the source, not a translation of itself. Its wording lives in the code, so the
 * editor refuses to open for it: a stored Malay copy would be a second place the wording is
 * defined, and it would win over any later correction made in the source.
 */
export function TranslationTab(): ReactNode {
  const [editing, setEditing] = useState<string | null>(null);

  return editing === null ? (
    <LocaleList onOpen={setEditing} />
  ) : (
    <LabelEditor code={editing} onBack={() => setEditing(null)} />
  );
}

// ---------------------------------------------------------------------------
// Languages
// ---------------------------------------------------------------------------

function LocaleList({ onOpen }: { onOpen: (code: string) => void }): ReactNode {
  const { can, refreshDisplay } = useAuth();
  const { t } = useLabels();
  const { showNumbers, setShowNumbers } = useTranslation();
  const [data, setData] = useState<TranslationLocalesPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [renaming, setRenaming] = useState<TranslationLocale | null>(null);
  const [confirming, setConfirming] = useState<TranslationLocale | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await translationApi.locales());
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('translation.error.load'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function setActive(locale: TranslationLocale, active: boolean): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await translationApi.updateLocale(locale.code, { active });
      setNotice(
        t(active ? 'translation.notice.enabled' : 'translation.notice.disabled', {
          name: locale.name,
        }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('translation.error.status'));
    }
  }

  async function makeDefault(locale: TranslationLocale): Promise<void> {
    setError(null);
    setNotice(null);
    try {
      await translationApi.updateLocale(locale.code, { isDefault: true });
      // The session carries the default, so refreshing it is what makes the change real for
      // this browser rather than only in the table.
      await refreshDisplay();
      setNotice(t('translation.notice.default', { name: locale.name }));
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('translation.error.default'));
    }
  }

  async function remove(locale: TranslationLocale): Promise<void> {
    setConfirming(null);
    setError(null);
    try {
      const outcome = await translationApi.removeLocale(locale.code);
      setNotice(
        outcome.removed > 0
          ? t('translation.notice.removed.withTranslations', {
              name: locale.name,
              count: outcome.removed,
            })
          : t('translation.notice.removed', { name: locale.name }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('translation.error.remove'));
    }
  }

  if (data === null) {
    return loading ? (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    ) : (
      <PanelBody>
        <Feedback error={error} />
      </PanelBody>
    );
  }

  const editable = can('settings.translation', 'edit');

  return (
    <>
      <PanelSection
        icon={<Languages className="size-4" aria-hidden />}
        title={<T k="settings.translation.title" />}
        subtitle={<T k="translation.subtitle" />}
        action={
          <div className="flex flex-wrap items-center gap-2">
            {/*
              The diagnostic, beside the action it supports. Listing "label #1: Alih Bahasa"
              still leaves somebody hunting through screens for where that string appears;
              this stamps the numbers onto the interface and answers it directly.
            */}
            <Button
              variant="ghost"
              onClick={() => setShowNumbers(!showNumbers)}
              className={cn(showNumbers && 'border-amber-300 bg-amber-50 text-amber-900')}
            >
              {showNumbers ? (
                <EyeOff className="size-4" aria-hidden />
              ) : (
                <Eye className="size-4" aria-hidden />
              )}
              <T k={showNumbers ? 'translation.numbers.hide' : 'translation.numbers.show'} />
            </Button>

            {editable && (
              <Button onClick={() => setAdding(true)}>
                <Plus className="size-4" aria-hidden />
                <T k="translation.action.add" />
              </Button>
            )}
          </div>
        }
      />

      {showNumbers && (
        <PanelBody className="pb-0">
          <PanelNote tone="warn" icon={<Eye className="size-3.5" aria-hidden />}>
            {/*
              The three badges are specimens, so they travel as nodes inside one sentence.
              Split into fragments, a translator could not reorder the clauses around them.
            */}
            <T
              k="translation.numbers.legend"
              vars={{
                source: <LabelBadge tone="source">#1</LabelBadge>,
                translated: <LabelBadge tone="translated">#1</LabelBadge>,
                unregistered: <LabelBadge tone="unregistered">#–</LabelBadge>,
              }}
            />
          </PanelNote>
        </PanelBody>
      )}

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <RecordTable
        loading={loading}
        rowCount={data.locales.length}
        empty={<T k="translation.empty" />}
        columns={[
          { header: <T k="translation.column.language" /> },
          { header: <T k="translation.column.code" />, width: 'w-20' },
          { header: <T k="translation.column.translated" />, width: 'w-44' },
          { header: <T k="panel.column.status" />, width: 'w-28' },
          { header: <T k="translation.column.default" />, width: 'w-24' },
          // No "Ditambah": when a language row was created answers nothing anybody asks of
          // this table, and it was taking the width the action icons needed.
          { header: <T k="panel.column.actions" />, width: 'w-44', align: 'right' },
        ]}
      >
        {data.locales.map((locale) => {
          const complete = locale.translated >= data.labelCount;
          const partial = locale.translated > 0 && !complete;

          return (
            <tr
              key={locale.code}
              className={cn(
                'border-b border-slate-100 hover:bg-slate-50/70',
                // Tinted before the status column is read: a language switched on while
                // still incomplete shows a screen that is half one language, half another.
                !locale.isSource && locale.active && !complete && 'bg-amber-50/40',
              )}
            >
              <td className="px-5 py-2.5">
                <button
                  type="button"
                  onClick={() => onOpen(locale.code)}
                  className="hover:text-brand-700 text-left font-medium text-slate-800 hover:underline"
                >
                  {locale.name}
                </button>
                {locale.isSource && (
                  <span className="mt-0.5 block text-[11px] text-slate-500">
                    <T k="translation.row.isSource" />
                  </span>
                )}
              </td>

              <td className="px-2 py-2.5 font-mono text-xs text-slate-600">{locale.code}</td>

              <td className="px-2 py-2.5">
                {locale.isSource ? (
                  <span className="text-xs text-slate-500">
                    <T k="translation.row.all" vars={{ count: data.labelCount }} />
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <span className="text-xs tabular-nums text-slate-600">
                      <T
                        k="translation.row.progress"
                        vars={{ translated: locale.translated, total: data.labelCount }}
                      />
                    </span>
                    <span
                      aria-hidden
                      className="h-1.5 w-16 overflow-hidden rounded-full bg-slate-200"
                    >
                      <span
                        className={cn('block h-full rounded-full', complete ? 'bg-emerald-500' : 'bg-amber-500')}
                        style={{
                          width: `${String(
                            data.labelCount === 0
                              ? 0
                              : Math.round((locale.translated / data.labelCount) * 100),
                          )}%`,
                        }}
                      />
                    </span>
                  </span>
                )}
              </td>

              <td className="px-2 py-2.5">
                <span
                  className={cn(
                    'inline-block rounded px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase',
                    locale.active ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600',
                  )}
                >
                  <T k={locale.active ? 'app.status.active' : 'app.status.inactive'} />
                </span>
                {partial && locale.active && (
                  <span className="mt-0.5 block text-[11px] text-amber-700">
                    <T k="translation.row.incomplete" />
                  </span>
                )}
              </td>

              <td className="px-2 py-2.5">
                {locale.isDefault ? (
                  <span className="inline-flex items-center gap-1 rounded bg-brand-50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-brand-700 uppercase">
                    <Star className="size-3 fill-current" aria-hidden />
                    <T k="translation.row.default" />
                  </span>
                ) : (
                  <span className="text-xs text-slate-400">—</span>
                )}
              </td>

              <td className="px-2 py-2.5 pr-4">
                <RowActions>
                  <RowAction
                    icon={<Languages className="size-4" aria-hidden />}
                    label={
                      locale.isSource
                        ? t('translation.row.viewSource')
                        : t('translation.row.edit', { name: locale.name })
                    }
                    tone="view"
                    onClick={() => onOpen(locale.code)}
                  />
                  {editable && (
                    /*
                      One click makes it the default. Disabled with the reason in the
                      tooltip rather than enabled and answering 409: an inactive language
                      cannot be the default, because the default is what every user opens.
                    */
                    <RowAction
                      icon={
                        <Star
                          className={cn('size-4', locale.isDefault && 'fill-current')}
                          aria-hidden
                        />
                      }
                      label={
                        locale.isDefault
                          ? t('translation.row.alreadyDefault', { name: locale.name })
                          : !locale.active
                            ? t('translation.row.needsActive')
                            : t('translation.row.makeDefault', { name: locale.name })
                      }
                      tone="warn"
                      disabled={locale.isDefault || !locale.active}
                      onClick={() => void makeDefault(locale)}
                    />
                  )}
                  {editable && (
                    <RowAction
                      icon={<Pencil className="size-4" aria-hidden />}
                      label={
                        locale.isSource
                          ? t('translation.row.sourceNameLocked')
                          : t('translation.row.rename')
                      }
                      tone="edit"
                      disabled={locale.isSource}
                      onClick={() => setRenaming(locale)}
                    />
                  )}
                  {editable && (
                    <RowAction
                      icon={
                        locale.active ? (
                          <Ban className="size-4" aria-hidden />
                        ) : (
                          <CircleCheck className="size-4" aria-hidden />
                        )
                      }
                      label={
                        locale.isSource
                          ? t('translation.row.sourceAlwaysActive')
                          : locale.isDefault
                            ? t('translation.row.defaultLocked')
                            : locale.active
                              ? t('translation.row.disable')
                              : t('translation.row.enable')
                      }
                      tone="warn"
                      disabled={locale.isSource || (locale.isDefault && locale.active)}
                      onClick={() => void setActive(locale, !locale.active)}
                    />
                  )}
                  {editable && (
                    <RowAction
                      icon={<Trash2 className="size-4" aria-hidden />}
                      label={
                        locale.isSource
                          ? t('translation.row.sourceUndeletable')
                          : locale.isDefault
                            ? t('translation.row.defaultLocked')
                            : t('translation.row.remove', { name: locale.name })
                      }
                      tone="danger"
                      disabled={locale.isSource || locale.isDefault}
                      onClick={() => setConfirming(locale)}
                    />
                  )}
                </RowActions>
              </td>
            </tr>
          );
        })}
      </RecordTable>

      <PanelBody className="space-y-3 pt-4">
        <PanelNote>
          <T
            k="translation.note.addedInactive"
            vars={{
              inactive: (
                <strong className="font-medium">
                  <T k="translation.note.addedInactive.inactive" />
                </strong>
              ),
            }}
          />
        </PanelNote>

        <PanelNote>
          <T k="translation.note.fallback" />
        </PanelNote>
      </PanelBody>

      {adding && (
        <LocaleDialog
          onClose={() => setAdding(false)}
          onSaved={(name) => {
            setAdding(false);
            setNotice(t('translation.notice.added', { name }));
            void load();
          }}
        />
      )}

      {renaming !== null && (
        <RenameDialog
          locale={renaming}
          onClose={() => setRenaming(null)}
          onSaved={() => {
            setRenaming(null);
            void load();
          }}
        />
      )}

      {confirming !== null && (
        <Dialog
          title={<T k="translation.remove.title" vars={{ name: confirming.name }} />}
          titleText={t('translation.remove.title', { name: confirming.name })}
          onClose={() => setConfirming(null)}
        >
          <div className="space-y-3">
            <p className="text-sm text-slate-700">
              {confirming.translated > 0 ? (
                <T
                  k="translation.remove.withTranslations"
                  vars={{ count: confirming.translated }}
                />
              ) : (
                <T k="translation.remove.empty" />
              )}
            </p>
            {confirming.translated > 0 && (
              <PanelNote tone="danger" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
                <T k="translation.remove.hint" />
              </PanelNote>
            )}
            <div className="flex justify-end gap-2 border-t border-slate-200 pt-3">
              <Button variant="ghost" onClick={() => setConfirming(null)}>
                <T k="dialog.cancel" />
              </Button>
              <Button
                onClick={() => void remove(confirming)}
                className="bg-rose-600 hover:bg-rose-500"
              >
                <T k="app.remove" />
              </Button>
            </div>
          </div>
        </Dialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function LocaleDialog({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: (name: string) => void;
}): ReactNode {
  const { t } = useLabels();
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await translationApi.addLocale({ code: code.trim(), name: name.trim() });
      onSaved(name.trim());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('translation.add.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="translation.add.title" />}
      titleText={t('translation.add.title')}
      description={<T k="translation.add.description" />}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />

        <div>
          <SettingRow
            label={<T k="translation.field.name" />}
            hint={<T k="translation.field.name.hint" />}
            required
          >
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder={t('translation.field.name.placeholder')}
              aria-label={t('translation.field.name')}
              autoFocus
              className={CONTROL}
            />
          </SettingRow>

          <SettingRow
            label={<T k="translation.field.code" />}
            hint={<T k="translation.field.code.hint" />}
            required
          >
            <input
              value={code}
              onChange={(event) => setCode(event.target.value.toLowerCase().replace(/[^a-z-]/g, ''))}
              placeholder={t('translation.field.code.placeholder')}
              aria-label={t('translation.field.code')}
              className={cn(CONTROL, 'max-w-32 font-mono')}
            />
          </SettingRow>
        </div>

        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0 || code.trim().length < 2}
          submitLabel={<T k="translation.add.submit" />}
        />
      </div>
    </Dialog>
  );
}

function RenameDialog({
  locale,
  onClose,
  onSaved,
}: {
  locale: TranslationLocale;
  onClose: () => void;
  onSaved: () => void;
}): ReactNode {
  const { t } = useLabels();
  const [name, setName] = useState(locale.name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await translationApi.updateLocale(locale.code, { name: name.trim() });
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('translation.rename.error'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      title={<T k="translation.rename.title" vars={{ name: locale.name }} />}
      titleText={t('translation.rename.title', { name: locale.name })}
      onClose={onClose}
    >
      <div className="space-y-4">
        <Feedback error={error} />
        <SettingRow label={<T k="translation.field.name" />} required>
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            aria-label={t('translation.field.name')}
            autoFocus
            className={CONTROL}
          />
        </SettingRow>
        {/* The code is the key and part of the URL, so it is shown but not editable. */}
        <SettingRow
          label={<T k="translation.field.code.short" />}
          hint={<T k="translation.field.code.locked" />}
        >
          <p className="rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-sm text-slate-600">
            {locale.code}
          </p>
        </SettingRow>
        <DialogFooter
          onClose={onClose}
          onSubmit={() => void submit()}
          busy={busy}
          disabled={name.trim().length === 0}
        />
      </div>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

/**
 * One language's wording, one row per label.
 *
 * Label on the left, input on the right — the same shape as every other settings form here,
 * so a long column of these reads as a form rather than as a spreadsheet.
 *
 * The label id is shown beside each row. It is the number an operator can write down and
 * quote, and it is assigned once per label key and never reused, so it stays the same when
 * labels are added.
 */
function LabelEditor({ code, onBack }: { code: string; onBack: () => void }): ReactNode {
  const { can } = useAuth();
  const { t } = useLabels();
  const [data, setData] = useState<TranslationLabelsPayload | null>(null);
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const payload = await translationApi.labels(code);
      setData(payload);
      setDraft(Object.fromEntries(payload.labels.map((label) => [label.id, label.text])));
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('translation.editor.error.load'));
    }
  }, [code, t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(): Promise<void> {
    if (data === null) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const outcome = await translationApi.saveLabels(
        code,
        data.labels.map((label) => ({ id: label.id, text: draft[label.id] ?? '' })),
      );
      setNotice(
        outcome.cleared > 0
          ? t('translation.editor.saved.cleared', {
              count: outcome.written,
              cleared: outcome.cleared,
            })
          : t('translation.editor.saved', { count: outcome.written }),
      );
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('app.error.save'));
    } finally {
      setBusy(false);
    }
  }

  if (data === null) {
    return error !== null ? (
      <PanelBody>
        <Feedback error={error} />
      </PanelBody>
    ) : (
      <div className="flex min-h-48 items-center justify-center">
        <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
      </div>
    );
  }

  const editable = can('settings.translation', 'edit') && !data.locale.isSource;
  const dirty = data.labels.some((label) => (draft[label.id] ?? '') !== label.text);
  const done = data.labels.filter((label) => (draft[label.id] ?? '').trim().length > 0).length;

  return (
    <>
      <PanelSection
        icon={<Languages className="size-4" aria-hidden />}
        title={data.locale.name}
        subtitle={
          <T
            k={
              data.locale.isSource
                ? 'translation.editor.subtitle.source'
                : 'translation.editor.subtitle'
            }
          />
        }
        action={
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-slate-400 tabular-nums">
              <T k="translation.editor.progress" vars={{ done, total: data.labels.length }} />
            </span>
            <Button variant="ghost" onClick={onBack}>
              <ArrowLeft className="size-4" aria-hidden />
              <T k="translation.editor.back" />
            </Button>
          </div>
        }
      />

      {(error !== null || notice !== null) && (
        <PanelBody className="pb-0">
          <Feedback error={error} notice={notice} />
        </PanelBody>
      )}

      <SettingsStack>
        {data.locale.isSource && (
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="translation.editor.sourceWarning" />
          </PanelNote>
        )}

        <SettingsGroup
          /*
            The group heading comes from `LABEL_GROUPS`, which is not itself registered: it
            is the index of the table being edited, and a heading read from that table would
            change under the translator as they worked.
          */
          title={data.groups[data.labels[0]?.groupKey ?? ''] ?? t('translation.editor.group')}
          icon={<Languages className="size-3.5" aria-hidden />}
          subtitle={<T k="translation.editor.group.subtitle" />}
          action={
            <span className="text-[11px] text-slate-400 tabular-nums">
              <T k="translation.editor.labelCount" vars={{ count: data.labels.length }} />
            </span>
          }
        >
          <ChannelHint>
            <T k="translation.editor.hint" />
          </ChannelHint>

          {data.labels.map((label) => (
            <LabelRow
              key={label.id}
              label={label}
              value={draft[label.id] ?? ''}
              editable={editable}
              onChange={(text) => setDraft((current) => ({ ...current, [label.id]: text }))}
            />
          ))}
        </SettingsGroup>
      </SettingsStack>

      {editable && (
        <PanelActions
          hint={<T k={dirty ? 'translation.editor.dirty' : 'translation.editor.clean'} />}
        >
          <Button onClick={() => void save()} disabled={busy || !dirty}>
            {busy ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : (
              <Save className="size-4" aria-hidden />
            )}
            <T k="translation.editor.save" />
          </Button>
          <Button
            variant="ghost"
            onClick={() =>
              setDraft(Object.fromEntries(data.labels.map((entry) => [entry.id, entry.text])))
            }
            disabled={busy || !dirty}
          >
            <T k="dialog.cancel" />
          </Button>
        </PanelActions>
      )}
    </>
  );
}

function LabelRow({
  label,
  value,
  editable,
  onChange,
}: {
  label: TranslationLabel;
  value: string;
  editable: boolean;
  onChange: (text: string) => void;
}): ReactNode {
  const { t } = useLabels();
  return (
    <SettingRow
      /*
        Number, then the source wording, on one line. Nothing else.

        The row used to carry the label's location as a second line — `Tetapan › Konfigurasi
        Umum › tajuk tab`. It is off the row now: with a column of these, the breadcrumbs
        become the bulk of what is on screen while the two things somebody is comparing, the
        source and their translation, sit further apart for it. The location is still on the
        badge's tooltip, one hover away, for when it is actually the question.
      */
      label={
        <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-0.5">
          <LabelBadge tone="plain" title={label.context ?? undefined}>
            #{label.id}
          </LabelBadge>
          {label.sourceText}
        </span>
      }
    >
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={!editable}
        placeholder={label.sourceText}
        aria-label={t('translation.editor.row.aria', { source: label.sourceText })}
        className={cn(CONTROL, 'disabled:bg-slate-50 disabled:text-slate-500')}
      />
    </SettingRow>
  );
}
