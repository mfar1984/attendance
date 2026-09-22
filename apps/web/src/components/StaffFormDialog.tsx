import { DEVICE_LIMITS, type LabelKey } from '@attendance/shared';
import { CircleAlert, CircleCheck, Loader2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { z } from 'zod';

import {
  staffApi,
  type DeviceSyncOutcome,
  type StaffDetail,
  type StaffFormValues,
} from '../lib/api';
import { useAuth } from '../lib/auth';
import type { Lookups } from '../lib/operations-api';
import { T, useLabels, type LabelVars } from '../lib/translation';
import { Dialog, DialogFooter, Feedback } from './Dialog';
import { Badge, Field, SelectField } from './ui';

/**
 * Validation mirrors the server's schema.
 *
 * The limits are the terminal's, imported rather than retyped: accepting a longer
 * `employeeNo` here would push the failure all the way to enrolment, after the
 * record already exists.
 */
function buildSchema(t: (key: LabelKey, vars?: LabelVars) => string) {
  return z.object({
    employeeNo: z
      .string()
      .trim()
      .min(1, t('staffForm.error.employeeNo.required'))
      .max(
        DEVICE_LIMITS.employeeNoMaxLength,
        t('staffForm.error.maxChars', { max: DEVICE_LIMITS.employeeNoMaxLength }),
      )
      .regex(/^[A-Za-z0-9._-]+$/, t('staffForm.error.employeeNo.charset')),
    fullName: z
      .string()
      .trim()
      .min(1, t('staffForm.error.fullName.required'))
      .max(
        DEVICE_LIMITS.nameMaxLength,
        t('staffForm.error.maxChars', { max: DEVICE_LIMITS.nameMaxLength }),
      ),
    icNo: z.string().trim().max(20).optional(),
    /*
     * Empty is a real answer here, not a missing one: most of this directory was imported from
     * the terminals, which carry no such field. It is sent as `null` to clear rather than being
     * omitted, so somebody who recorded it in error can take it back out.
     *
     * It matters because `LeaveType.eligibility` restricts maternity leave to women and
     * paternity leave to men, and an application from somebody with no value here is refused.
     */
    gender: z.union([z.null(), z.enum(['male', 'female'])]).optional(),
    phone: z.string().trim().max(20).optional(),
    email: z.union([z.literal(''), z.email(t('staffForm.error.email'))]).optional(),
    /*
     * Held as text in the form and validated here, so a typo shows against the field
     * rather than coming back as a 400 on save. Empty means "no wage recorded", which is
     * a legitimate state — most of this directory was imported from terminals that carry
     * no wage at all.
     */
    basicSalary: z
      .union([
        z.literal(''),
        z.coerce
          .number()
          .positive(t('staffForm.error.basicSalary'))
          .max(1_000_000, t('staffForm.error.basicSalary')),
      ])
      .optional(),
    doorPin: z
      .union([
        z.literal(''),
        z
          .string()
          .regex(/^\d+$/, t('staffForm.error.pin.digits'))
          .min(
            DEVICE_LIMITS.passwordLength.min,
            t('staffForm.error.pin.min', { min: DEVICE_LIMITS.passwordLength.min }),
          )
          .max(
            DEVICE_LIMITS.passwordLength.max,
            t('staffForm.error.pin.max', { max: DEVICE_LIMITS.passwordLength.max }),
          ),
      ])
      .optional(),
  });
}

type FieldErrors = Partial<
  Record<keyof z.infer<ReturnType<typeof buildSchema>>, string>
>;

export function StaffFormDialog({
  staffId,
  lookups,
  onClose,
  onSaved,
}: {
  /** Null creates a new record. */
  staffId: number | null;
  lookups: Lookups | null;
  onClose: () => void;
  onSaved: (message: string) => Promise<void>;
}): ReactNode {
  const editing = staffId !== null;

  const [loading, setLoading] = useState(editing);
  const [values, setValues] = useState<StaffFormValues>({
    employeeNo: '',
    fullName: '',
    active: true,
    deviceIds: [],
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sync, setSync] = useState<DeviceSyncOutcome[] | null>(null);
  /**
   * Text rather than a number, so a half-typed value is not coerced mid-keystroke.
   *
   * Separate from `values` because `StaffFormValues` is the request payload and the wage
   * goes over the wire as a number or null.
   */
  const [salaryText, setSalaryText] = useState('');
  const { t } = useLabels();
  const { can } = useAuth();
  // Gates the field entirely. The server does not return the wage without this grant, so
  // there would be nothing to show, and a disabled box invites a question with no answer.
  const maySetSalary = can('staff.directory', 'salary');

  useEffect(() => {
    if (staffId === null) return;
    let cancelled = false;

    void (async () => {
      try {
        const detail: StaffDetail = await staffApi.get(staffId);
        if (cancelled) return;
        setValues({
          employeeNo: detail.employeeNo,
          fullName: detail.fullName,
          ...(detail.icNo !== null ? { icNo: detail.icNo } : {}),
          ...(detail.gender !== null ? { gender: detail.gender } : {}),
          ...(detail.phone !== null ? { phone: detail.phone } : {}),
          ...(detail.email !== null ? { email: detail.email } : {}),
          active: detail.active,
          ...(detail.notes !== null ? { notes: detail.notes } : {}),
          deviceIds: detail.enrolments.map((row) => row.deviceId),
        });
        setSalaryText(
          detail.basicSalary === null || detail.basicSalary === undefined
            ? ''
            : String(detail.basicSalary),
        );
      } catch (cause) {
        if (!cancelled) {
          setFormError(cause instanceof Error ? cause.message : t('staffForm.error.load'));
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [staffId, t]);

  function set<K extends keyof StaffFormValues>(key: K, value: StaffFormValues[K]): void {
    setValues((current) => ({ ...current, [key]: value }));
  }

  function toggleDevice(deviceId: number): void {
    setValues((current) => ({
      ...current,
      deviceIds: current.deviceIds.includes(deviceId)
        ? current.deviceIds.filter((id) => id !== deviceId)
        : [...current.deviceIds, deviceId],
    }));
  }

  async function submit(): Promise<void> {
    setFormError(null);
    setSync(null);

    const parsed = buildSchema(t).safeParse({ ...values, basicSalary: salaryText.trim() });
    if (!parsed.success) {
      const fields = z.flattenError(parsed.error).fieldErrors as Record<string, string[]>;
      setErrors({
        basicSalary: fields['basicSalary']?.[0],
        employeeNo: fields['employeeNo']?.[0],
        fullName: fields['fullName']?.[0],
        icNo: fields['icNo']?.[0],
        phone: fields['phone']?.[0],
        email: fields['email']?.[0],
        doorPin: fields['doorPin']?.[0],
      });
      return;
    }

    setErrors({});
    setBusy(true);

    // Empty optional strings are dropped rather than sent, so a blank field means
    // "not provided" instead of overwriting a stored value with an empty string.
    const payload: StaffFormValues = {
      employeeNo: values.employeeNo.trim(),
      fullName: values.fullName.trim(),
      active: values.active,
      deviceIds: values.deviceIds,
      ...(values.icNo?.trim() ? { icNo: values.icNo.trim() } : {}),
      /*
       * `null` rather than dropped when blank, unlike the fields around it.
       *
       * Those are free text where an empty box and an untouched box are the same intent. This is a
       * three-way control whose first option is "not recorded", so choosing it has to be able to
       * clear a value that is already there — dropping the key would make the option unselectable
       * once anything else had been saved.
       */
      gender: values.gender ?? null,
      ...(values.phone?.trim() ? { phone: values.phone.trim() } : {}),
      ...(values.email?.trim() ? { email: values.email.trim() } : {}),
      ...(values.doorPin?.trim() ? { doorPin: values.doorPin.trim() } : {}),
      ...(values.departmentId !== undefined ? { departmentId: values.departmentId } : {}),
      ...(values.locationId !== undefined ? { locationId: values.locationId } : {}),
      ...(values.notes?.trim() ? { notes: values.notes.trim() } : {}),
      /*
       * Only sent when the grant is held, because the server answers 403 to the key
       * itself. Blank sends `null` on purpose: the field loaded with the stored value, so
       * an empty box is somebody clearing it rather than somebody leaving it untouched.
       */
      ...(maySetSalary
        ? { basicSalary: salaryText.trim() === '' ? null : Number(salaryText.trim()) }
        : {}),
    };

    try {
      const result = editing
        ? await staffApi.update(staffId, payload)
        : await staffApi.create(payload);

      const failed = result.sync.filter((row) => !row.ok);
      setSync(result.sync);

      if (failed.length === 0) {
        await onSaved(
          result.sync.length > 0
            ? t('staffForm.saved.enrolled', {
                name: payload.fullName,
                count: result.sync.length,
              })
            : t('staffForm.saved', { name: payload.fullName }),
        );
      } else {
        // Kept open on partial success. The record exists but the person cannot
        // use those doors yet, and closing the dialog would hide that.
        setBusy(false);
      }
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t('staffForm.error.save'));
      setBusy(false);
    }
  }

  return (
    // Uses the shared modal shell rather than its own. A second hand-rolled shell is
    // how the centring and the rule under the title drifted apart from every other
    // dialog in the first place.
    <Dialog
      title={<T k={editing ? 'staffForm.title.edit' : 'staffForm.title.create'} />}
      titleText={t(editing ? 'staffForm.title.edit' : 'staffForm.title.create')}
      description={<T k="staffForm.description" />}
      width="lg"
      onClose={onClose}
    >
      {loading ? (
        <div className="flex min-h-48 items-center justify-center">
          <Loader2 className="size-5 animate-spin text-slate-400" aria-label={t('app.loading')} />
        </div>
      ) : (
        <div className="space-y-4">
          <Feedback error={formError} />

          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label={<T k="staffForm.employeeNo" />}
              value={values.employeeNo}
              onChange={(event) => set('employeeNo', event.target.value)}
              error={errors.employeeNo}
              disabled={editing}
              hint={
                editing ? (
                  <T k="staffForm.employeeNo.locked" />
                ) : (
                  <T
                    k="staffForm.employeeNo.hint"
                    vars={{ max: DEVICE_LIMITS.employeeNoMaxLength }}
                  />
                )
              }
            />
            <Field
              label={<T k="staffForm.fullName" />}
              value={values.fullName}
              onChange={(event) => set('fullName', event.target.value)}
              error={errors.fullName}
            />
            <Field
              label={<T k="staffForm.icNo" />}
              value={values.icNo ?? ''}
              onChange={(event) => set('icNo', event.target.value)}
              error={errors.icNo}
            />
            {/*
              Not derived from the NRIC. The last digit does encode sex, but reading it would make
              a leave refusal depend on a number somebody typed, with no way to correct it where
              the digit is wrong or the person holds a passport instead.
            */}
            <SelectField
              label={<T k="staffForm.gender" />}
              value={values.gender ?? ''}
              onChange={(event) => {
                const next = event.target.value;
                set('gender', next === 'male' || next === 'female' ? next : null);
              }}
              hint={<T k="staffForm.gender.hint" />}
            >
              <option value="">{t('staffForm.gender.unset')}</option>
              <option value="male">{t('staffForm.gender.male')}</option>
              <option value="female">{t('staffForm.gender.female')}</option>
            </SelectField>
            <Field
              label={<T k="staffForm.phone" />}
              value={values.phone ?? ''}
              onChange={(event) => set('phone', event.target.value)}
              error={errors.phone}
            />
            <Field
              label={<T k="staffForm.email" />}
              type="email"
              value={values.email ?? ''}
              onChange={(event) => set('email', event.target.value)}
              error={errors.email}
            />
            <Field
              label={<T k="staffForm.doorPin" />}
              inputMode="numeric"
              value={values.doorPin ?? ''}
              onChange={(event) => set('doorPin', event.target.value.replace(/\D/g, ''))}
              error={errors.doorPin}
              hint={
                // Worth stating plainly: the terminal returns this in cleartext
                // from its own search endpoint, so it must never match a password
                // used anywhere else.
                <T
                  k="staffForm.doorPin.hint"
                  vars={{
                    min: DEVICE_LIMITS.passwordLength.min,
                    max: DEVICE_LIMITS.passwordLength.max,
                  }}
                />
              }
            />

            {maySetSalary && (
              <Field
                label={<T k="staffForm.basicSalary" />}
                type="number"
                inputMode="decimal"
                step="0.01"
                min={0}
                value={salaryText}
                onChange={(event) => setSalaryText(event.target.value)}
                error={errors.basicSalary}
                hint={<T k="staffForm.basicSalary.hint" />}
              />
            )}

            <div>
              <label htmlFor="staff-dept" className="block text-sm font-medium text-slate-700">
                <T k="staffForm.department" />
              </label>
              <select
                id="staff-dept"
                value={values.departmentId ?? ''}
                onChange={(event) =>
                  set('departmentId', event.target.value ? Number(event.target.value) : undefined)
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">{t('staffForm.none')}</option>
                {(lookups?.departments ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label htmlFor="staff-loc" className="block text-sm font-medium text-slate-700">
                <T k="staffForm.location" />
              </label>
              <select
                id="staff-loc"
                value={values.locationId ?? ''}
                onChange={(event) =>
                  set('locationId', event.target.value ? Number(event.target.value) : undefined)
                }
                className="mt-1.5 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm"
              >
                <option value="">{t('staffForm.none')}</option>
                {(lookups?.locations ?? []).map((row) => (
                  <option key={row.id} value={row.id}>
                    {row.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <fieldset className="rounded-lg border border-slate-200 p-3">
            <legend className="px-1 text-sm font-medium text-slate-700">
              <T k="staffForm.devices" />
            </legend>
            <p className="mb-2 text-xs text-slate-500">
              <T k="staffForm.devices.hint" />
            </p>
            <div className="space-y-1.5">
              {(lookups?.devices ?? []).length === 0 && (
                <p className="text-xs text-slate-500">
                  <T k="staffForm.devices.none" />
                </p>
              )}
              {(lookups?.devices ?? []).map((device) => (
                <label key={device.id} className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={values.deviceIds.includes(device.id)}
                    onChange={() => toggleDevice(device.id)}
                    className="size-4 rounded border-slate-300"
                  />
                  {device.name}
                </label>
              ))}
            </div>
          </fieldset>

          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={values.active}
              onChange={(event) => set('active', event.target.checked)}
              className="size-4 rounded border-slate-300"
            />
            <T k="staffForm.active" />
          </label>

          {/*
            Per-terminal results. Shown because a staff record can be saved
            while one door remains unreachable, and that person simply cannot
            get in there until it is retried.
          */}
          {sync !== null && sync.length > 0 && (
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
              <p className="mb-2 text-xs font-medium text-slate-700">
                <T k="staffForm.sync.heading" />
              </p>
              <ul className="space-y-1.5">
                {sync.map((row) => (
                  <li key={row.deviceId} className="flex items-start gap-2 text-xs">
                    {row.ok ? (
                      <CircleCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-600" aria-hidden />
                    ) : (
                      <CircleAlert className="mt-0.5 size-3.5 shrink-0 text-rose-500" aria-hidden />
                    )}
                    <span className="min-w-0">
                      <span className="font-medium text-slate-700">{row.deviceName}</span>
                      {row.ok ? (
                        <Badge tone="success">
                          <T k="staffForm.sync.ok" />
                        </Badge>
                      ) : (
                        <span className="ml-1.5 text-rose-700">{row.error}</span>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <DialogFooter
            onClose={onClose}
            onSubmit={() => void submit()}
            busy={busy}
            disabled={loading}
            // Reads "Tutup" once a terminal has failed: the record was saved, so
            // there is nothing left to cancel.
            closeLabel={
              <T k={sync?.some((row) => !row.ok) === true ? 'dialog.close' : 'dialog.cancel'} />
            }
            submitLabel={<T k={editing ? 'dialog.save' : 'staffForm.submit.create'} />}
          />
        </div>
      )}
    </Dialog>
  );
}
