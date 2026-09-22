import { ArrowLeft, Grid3x3, Loader2, Lock, Save, Sparkles, TriangleAlert, X } from 'lucide-react';
import { groupByDomain } from '@attendance/shared';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router';

import { Feedback } from '../components/Dialog';
import {
  FormGrid,
  PanelActions,
  PanelBody,
  PanelNote,
  PanelSection,
} from '../components/RecordPanel';
import { Badge, Button, Field } from '../components/ui';
import {
  rolesApi,
  screenActions,
  sectionProgress,
  type PermissionMatrix,
  type RoleRow,
  type ScreenPermission,
} from '../lib/settings-api';
import { T, TEnum, useLabels } from '../lib/translation';

/**
 * Role editor.
 *
 * One page rather than a dialog. Thirty-five screens and up to nine actions each makes
 * a grid that needs the width of the viewport, and the section a row belongs to has to
 * stay visible while its checkbox is being ticked.
 *
 * Read-only mode reuses the same page. A separate viewer would be a second place for
 * the matrix layout to drift from what the editor shows.
 */
export function RoleEditorPage(): ReactNode {
  const navigate = useNavigate();
  const params = useParams<{ id?: string }>();
  const [query] = useSearchParams();
  const { t, tEnum } = useLabels();

  const roleId = params.id !== undefined && params.id !== 'baharu' ? Number(params.id) : null;
  const readOnly = query.get('baca') === '1';

  const [matrix, setMatrix] = useState<PermissionMatrix | null>(null);
  const [role, setRole] = useState<RoleRow | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState<'active' | 'inactive'>('active');
  const [permissions, setPermissions] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);

  useEffect(() => {
    async function load(): Promise<void> {
      try {
        const definition = await rolesApi.matrix();
        setMatrix(definition);

        if (roleId !== null) {
          const existing = await rolesApi.get(roleId);
          if (!existing) {
            setLoadError(t('roles.editor.error.notFound'));
            return;
          }
          setRole(existing);
          setName(existing.name);
          setDescription(existing.description ?? '');
          setStatus(existing.status);
          setPermissions(existing.permissions);
        }
      } catch (cause) {
        setLoadError(cause instanceof Error ? cause.message : t('roles.editor.error.load'));
      }
    }
    void load();
  }, [roleId, t]);

  const granted = useMemo(() => {
    if (!matrix) return 0;
    return matrix.sections.reduce(
      (running, section) => running + sectionProgress(section, permissions).granted,
      0,
    );
  }, [matrix, permissions]);

  /**
   * Sections in domain order, each carrying the heading it should be introduced by.
   *
   * Flattened to one list rather than nested, because the matrix is a table: a domain wrapper
   * element would have to be a `tbody`, and nesting one inside another is not valid. So the
   * heading rides on the first section of its domain instead.
   *
   * A section whose label maps to no domain — Dashboard, which summarises all of them — keeps
   * its place at the top with no heading, exactly as it does in the rail.
   */
  const orderedSections = useMemo(() => {
    if (!matrix) return [];

    const { ungrouped, domains } = groupByDomain(matrix.sections, (section) => section.labelKey);

    return [
      ...ungrouped.map((section) => ({ ...section, domainLabelKey: undefined })),
      ...domains.flatMap((domain) =>
        domain.groups.map((section, index) => ({
          ...section,
          // Only the first section of a domain introduces it.
          domainLabelKey: index === 0 ? domain.labelKey : undefined,
        })),
      ),
    ];
  }, [matrix]);

  const toggle = useCallback((screenKey: string, action: string): void => {
    setPermissions((current) => {
      const held = current[screenKey] ?? [];
      const next = held.includes(action)
        ? held.filter((entry) => entry !== action)
        : [...held, action];
      return { ...current, [screenKey]: next };
    });
  }, []);

  /**
   * Ticking a row implies view.
   *
   * A grant to change a record without the ability to open it describes an account that
   * cannot use the permission it holds, and the server refuses it. Adding view here
   * means the row does not have to be fixed after the save fails.
   */
  const setRow = useCallback((screen: ScreenPermission, on: boolean): void => {
    setPermissions((current) => ({
      ...current,
      [screen.key]: on ? screenActions(screen) : [],
    }));
  }, []);

  const setAll = useCallback(
    (on: boolean): void => {
      if (!matrix) return;
      const next: Record<string, string[]> = {};
      for (const section of matrix.sections) {
        for (const screen of section.screens) {
          next[screen.key] = on ? screenActions(screen) : [];
        }
      }
      setPermissions(next);
    },
    [matrix],
  );

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      // Empty rows are dropped so the stored shape reads as a list of what the role can
      // do rather than every screen with mostly empty arrays.
      const cleaned = Object.fromEntries(
        Object.entries(permissions).filter(([, actions]) => actions.length > 0),
      );

      if (roleId !== null) {
        await rolesApi.update(roleId, {
          ...(role?.systemRole === true ? {} : { name: name.trim(), status }),
          description: description.trim(),
          permissions: cleaned,
        });
      } else {
        await rolesApi.create({
          name: name.trim(),
          description: description.trim(),
          status,
          permissions: cleaned,
        });
      }
      void navigate('/tetapan/peranan');
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('roles.editor.error.save'));
    } finally {
      setBusy(false);
    }
  }

  if (loadError !== null) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <PanelBody className="space-y-3">
          <BackLink />
          <Feedback error={loadError} />
        </PanelBody>
      </section>
    );
  }

  if (!matrix || (roleId !== null && !role)) {
    return (
      <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex min-h-64 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
        </div>
      </section>
    );
  }

  const heading = readOnly ? (
    <T k="roles.editor.heading.view" vars={{ name: role?.name ?? '' }} />
  ) : roleId !== null ? (
    <T k="roles.editor.heading.edit" vars={{ name: role?.name ?? '' }} />
  ) : (
    <T k="roles.action.new" />
  );

  return (
    <section className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 px-5 pt-5 pb-4">
        <div className="flex items-start gap-3">
          <BackLink />
          <div>
            <h1 className="text-lg font-semibold text-slate-800">{heading}</h1>
            <p className="mt-0.5 text-sm text-slate-500">
              <T k={readOnly ? 'roles.editor.subtitle.view' : 'roles.editor.subtitle.edit'} />
            </p>
          </div>
        </div>

        {!readOnly && (
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="ghost" onClick={() => setAll(false)}>
              <X className="size-4" aria-hidden />
              <T k="roles.editor.clearAll" />
            </Button>
            <Button variant="ghost" onClick={() => setAll(true)}>
              <Sparkles className="size-4" aria-hidden />
              <T k="roles.editor.selectAll" />
            </Button>
            <Button onClick={() => void submit()} disabled={busy || name.trim().length === 0}>
              <Save className="size-4" aria-hidden />
              <T k="roles.editor.save" />
            </Button>
          </div>
        )}
      </header>

      <PanelSection
        title={<T k="roles.editor.details" />}
        action={
          role !== null ? (
            <Badge tone={role.accountCount > 0 ? 'warning' : 'neutral'}>
              <T k="roles.editor.affected" vars={{ count: role.accountCount }} />
            </Badge>
          ) : undefined
        }
      />

      <PanelBody className="space-y-4">
        <Feedback error={error} />

        <FormGrid>
          <Field
            label={<T k="roles.editor.name" />}
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('roles.editor.name.placeholder')}
            disabled={readOnly || role?.systemRole === true}
            hint={
              role?.systemRole === true ? <T k="roles.editor.name.locked" /> : undefined
            }
          />
          <Field
            label={<T k="roles.editor.description" />}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            placeholder={t('roles.editor.description.placeholder')}
            disabled={readOnly}
          />
          <div>
            <label htmlFor="role-status" className="block text-sm font-medium text-slate-700">
              <T k="roles.editor.status" />
            </label>
            <select
              id="role-status"
              value={status}
              onChange={(event) => setStatus(event.target.value as typeof status)}
              disabled={readOnly || role?.systemRole === true}
              className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm disabled:bg-slate-50 disabled:text-slate-500"
            >
              <option value="active">{t('app.status.active')}</option>
              <option value="inactive">{t('app.status.inactive')}</option>
            </select>
            {status === 'inactive' && (
              <p className="mt-1.5 text-xs text-amber-800">
                <T k="roles.editor.status.warning" />
              </p>
            )}
          </div>
        </FormGrid>
      </PanelBody>

      <PanelSection
        title={<T k="roles.editor.matrix.title" />}
        subtitle={<T k="roles.editor.matrix.subtitle" />}
        action={
          <span className="text-xs tabular-nums text-slate-500">
            <T k="roles.editor.matrix.granted" vars={{ granted, total: matrix.total }} />
          </span>
        }
      />

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">
            <T k="roles.editor.matrix.caption" />
          </caption>
          <thead>
            <tr className="border-b border-slate-200 text-left text-[11px] tracking-wide text-slate-500 uppercase">
              <th scope="col" className="px-5 py-2 font-medium">
                <T k="roles.editor.matrix.column.screen" />
              </th>
              {matrix.standardActions.map((action) => (
                <th key={action} scope="col" className="px-2 py-2 text-center font-medium">
                  <TEnum k={matrix.actionLabels[action]} fallback={action} />
                </th>
              ))}
              <th
                scope="col"
                className="border-l border-slate-300 px-4 py-2 text-left font-medium"
              >
                <T k="roles.editor.matrix.column.others" />
              </th>
              <th scope="col" className="w-24 px-3 py-2 text-right font-medium">
                <span className="sr-only">
                  <T k="roles.editor.matrix.column.fullRow" />
                </span>
              </th>
            </tr>
          </thead>

          {/*
            Partitioned by the same shared mapping the sidebar uses.

            The matrix and the rail describe the same structure from two directions — one grants
            access to the screens the other navigates to — so a role editor whose sections
            disagreed with the rail would be asking somebody to grant permissions in one
            arrangement and check the result in another.

            `groupByDomain` also imposes the domain order, so the two cannot present the same
            partition in two sequences even if the underlying arrays drift apart.
          */}
          {orderedSections.map((section) => {
            const progress = sectionProgress(section, permissions);
            const complete = progress.granted === progress.total;

            return (
              <tbody key={section.key}>
                {/*
                  A domain heading, emitted on the first section of each domain.

                  Inside the same `tbody` as that section rather than its own, because a `tbody`
                  holding only a heading row would let a browser break the page between the
                  heading and the first row it introduces.
                */}
                {section.domainLabelKey !== undefined && (
                  <tr className="border-y border-slate-300 bg-slate-100">
                    <th
                      scope="colgroup"
                      colSpan={matrix.standardActions.length + 3}
                      className="px-5 py-1.5 text-left text-[11px] font-semibold tracking-wider text-slate-500 uppercase"
                    >
                      <T k={section.domainLabelKey} />
                    </th>
                  </tr>
                )}

                <tr className="bg-brand-100/50 border-y border-slate-200">
                  <th
                    scope="colgroup"
                    colSpan={matrix.standardActions.length + 3}
                    className="px-5 py-2 text-left"
                  >
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="text-brand-600 text-xs font-semibold tracking-wider uppercase">
                        <T k={section.labelKey} />
                      </span>
                      <span className="text-xs tabular-nums text-slate-500">
                        <T
                          k="roles.editor.section.progress"
                          vars={{ granted: progress.granted, total: progress.total }}
                        />
                      </span>
                      {!readOnly && (
                        <button
                          type="button"
                          onClick={() => {
                            for (const screen of section.screens) setRow(screen, !complete);
                          }}
                          className="text-brand-600 text-xs font-medium uppercase hover:underline"
                        >
                          <T
                            k={
                              complete
                                ? 'roles.editor.section.clear'
                                : 'roles.editor.section.select'
                            }
                          />
                        </button>
                      )}
                    </span>
                  </th>
                </tr>

                {section.screens.map((screen) => {
                  const held = new Set(permissions[screen.key] ?? []);
                  const available = screenActions(screen);
                  const full = available.every((action) => held.has(action));

                  return (
                    <tr key={screen.key} className="border-b border-slate-100 hover:bg-slate-50/70">
                      <th scope="row" className="max-w-80 px-5 py-2 text-left font-normal">
                        <span className="block font-medium text-slate-700">
                          <T k={screen.labelKey} />
                        </span>
                        {screen.noteKey !== undefined && (
                          <span className="mt-0.5 flex items-start gap-1 text-xs text-slate-500">
                            <Lock className="mt-0.5 size-3 shrink-0" aria-hidden />
                            <T k={screen.noteKey} />
                          </span>
                        )}
                        {screen.planned === true && (
                          <span className="mt-1 inline-block">
                            <Badge tone="warning">
                              <T k="roles.editor.screen.planned" />
                            </Badge>
                          </span>
                        )}
                      </th>

                      {matrix.standardActions.map((action) => {
                        const supported = screen.actions.includes(action);
                        return (
                          <td key={action} className="px-2 py-2 text-center">
                            {supported ? (
                              <input
                                type="checkbox"
                                checked={held.has(action)}
                                disabled={readOnly}
                                onChange={() => toggle(screen.key, action)}
                                aria-label={t('roles.editor.checkbox.aria', {
                                  action: tEnum(matrix.actionLabels[action], action),
                                  screen: t(screen.labelKey),
                                })}
                              />
                            ) : (
                              <span
                                className="text-slate-300"
                                aria-label={t('roles.editor.notApplicable')}
                              >
                                —
                              </span>
                            )}
                          </td>
                        );
                      })}

                      <td className="border-l border-slate-200 px-4 py-2">
                        {screen.custom === undefined || screen.custom.length === 0 ? (
                          <span
                            className="text-slate-300"
                            aria-label={t('roles.editor.noCustom')}
                          >
                            —
                          </span>
                        ) : (
                          <div className="flex flex-wrap gap-x-4 gap-y-1">
                            {screen.custom.map((action) => (
                              <label
                                key={action.id}
                                title={
                                  action.noteKey === undefined ? undefined : t(action.noteKey)
                                }
                                className="inline-flex items-center gap-1.5 text-xs text-slate-700"
                              >
                                <input
                                  type="checkbox"
                                  checked={held.has(action.id)}
                                  disabled={readOnly}
                                  onChange={() => toggle(screen.key, action.id)}
                                  className="size-3.5"
                                />
                                <T k={action.labelKey} />
                              </label>
                            ))}
                          </div>
                        )}
                      </td>

                      <td className="px-3 py-2 text-right">
                        {!readOnly && (
                          <button
                            type="button"
                            onClick={() => setRow(screen, !full)}
                            className="text-brand-600 text-xs font-medium hover:underline"
                          >
                            <T k={full ? 'roles.editor.row.clear' : 'roles.editor.row.all'} />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>

      {!readOnly && granted === matrix.total && (
        <PanelBody className="pb-0">
          <PanelNote tone="warn" icon={<TriangleAlert className="size-3.5" aria-hidden />}>
            <T k="roles.editor.fullAccess" />
          </PanelNote>
        </PanelBody>
      )}

      <PanelActions hint={readOnly ? undefined : <T k="roles.editor.hint" />}>
        {readOnly ? (
          <Button variant="ghost" onClick={() => void navigate('/tetapan/peranan')}>
            <ArrowLeft className="size-4" aria-hidden />
            <T k="roles.editor.back" />
          </Button>
        ) : (
          <>
            <Button onClick={() => void submit()} disabled={busy || name.trim().length === 0}>
              <Save className="size-4" aria-hidden />
              <T k="roles.editor.save" />
            </Button>
            <span className="inline-flex items-center gap-1.5 text-xs">
              <Grid3x3 className="size-3.5 text-slate-400" aria-hidden />
              <button
                type="button"
                onClick={() => setAll(true)}
                className="text-brand-600 font-medium hover:underline"
              >
                <T k="roles.editor.selectAll" />
              </button>
              <button
                type="button"
                onClick={() => setAll(false)}
                className="font-medium text-rose-600 hover:underline"
              >
                <T k="roles.editor.clearAll" />
              </button>
            </span>
          </>
        )}
      </PanelActions>
    </section>
  );
}

function BackLink(): ReactNode {
  const navigate = useNavigate();
  const { t } = useLabels();
  return (
    <button
      type="button"
      onClick={() => void navigate('/tetapan/peranan')}
      aria-label={t('roles.editor.back.aria')}
      className="mt-0.5 rounded-lg border border-slate-300 p-1.5 text-slate-600 hover:bg-slate-50"
    >
      <ArrowLeft className="size-4" aria-hidden />
    </button>
  );
}
