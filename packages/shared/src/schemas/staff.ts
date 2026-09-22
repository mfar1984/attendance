import { z } from 'zod';

import { DEVICE_LIMITS } from '../limits.js';

/**
 * Staff identifier, also used as the terminal's `employeeNo`.
 *
 * The terminal reports `characterType: any`, so letters are allowed, but
 * whitespace is rejected here: this value travels in query strings and in the
 * terminal's own search filters, where a space silently changes the match.
 *
 * The length ceiling is the device's, not ours. Accepting a longer value in the
 * UI would push the failure all the way to enrolment time.
 */
export const employeeNoSchema = z
  .string()
  .trim()
  .min(1, 'No. Staf diperlukan')
  .max(
    DEVICE_LIMITS.employeeNoMaxLength,
    `No. Staf tidak boleh melebihi ${DEVICE_LIMITS.employeeNoMaxLength} aksara (had terminal)`,
  )
  .regex(/^[A-Za-z0-9._-]+$/, 'No. Staf hanya boleh mengandungi huruf, nombor, titik, sengkang');

export const staffNameSchema = z
  .string()
  .trim()
  .min(1, 'Nama diperlukan')
  .max(
    DEVICE_LIMITS.nameMaxLength,
    `Nama tidak boleh melebihi ${DEVICE_LIMITS.nameMaxLength} aksara (had terminal)`,
  );

/**
 * Door PIN pushed to the terminal.
 *
 * Kept separate from any account password on purpose: the terminal returns this
 * value in cleartext from `UserInfo/Search`, so anyone with device credentials
 * can read every PIN. Reusing an account password here would leak it.
 */
export const doorPinSchema = z
  .string()
  .regex(/^\d+$/, 'PIN pintu mesti nombor sahaja')
  .min(DEVICE_LIMITS.passwordLength.min, `PIN pintu minimum ${DEVICE_LIMITS.passwordLength.min} digit`)
  .max(DEVICE_LIMITS.passwordLength.max, `PIN pintu maksimum ${DEVICE_LIMITS.passwordLength.max} digit`);

const deviceValidityBound = z.coerce
  .date()
  .refine(
    (value) =>
      value >= new Date(DEVICE_LIMITS.validityRange.start) &&
      value <= new Date(DEVICE_LIMITS.validityRange.end),
    `Tarikh mesti antara ${DEVICE_LIMITS.validityRange.start.slice(0, 10)} dan ${DEVICE_LIMITS.validityRange.end.slice(0, 10)} (had terminal)`,
  );

/**
 * Field definitions without the cross-field rule.
 *
 * Kept separate because zod refuses `.partial()` on a schema that carries a
 * refinement, and the update variant needs every field optional. Refining the
 * two variants independently also lets the rule stay correct for a partial
 * update, where only one of the two dates may be supplied.
 */
const staffFieldsSchema = z.object({
  employeeNo: employeeNoSchema,
  fullName: staffNameSchema,
  icNo: z.string().trim().max(20).optional(),
  /**
   * `male`, `female`, or `null` to clear it. Omitted leaves it alone.
   *
   * Recorded for one reason: `LeaveType.eligibility` restricts maternity leave to women and
   * paternity leave to men, and an application for a restricted category by somebody with no
   * value here is refused. So this field is what makes those two categories usable.
   *
   * No third option and no free text. The values are compared against `eligibility`, and an
   * unmatched value would be indistinguishable from not recording one — the person would be
   * refused with a message telling them to fill in a field they had already filled in.
   */
  gender: z.union([z.null(), z.enum(['male', 'female'])]).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.email('Emel tidak sah').max(190).optional(),
  departmentId: z.number().int().positive().optional(),
  locationId: z.number().int().positive().optional(),
  hireDate: z.coerce.date().optional(),
  /**
   * Monthly wage, and the only input the overtime hourly rate is derived from
   * (Employment Act 1955 s.60I: monthly ÷ 26 ÷ 8). A wrong figure here misprices
   * every overtime claim this person files.
   *
   * `null` clears it; omitted leaves it alone. Zero is refused rather than stored,
   * because no hourly rate can be made from it and a stored zero would read as a
   * recorded wage while pricing nothing.
   *
   * Gated by the `salary` action on `staff.directory`, not by plain `edit` — see
   * `auth/permissions.ts`.
   */
  basicSalary: z.union([z.null(), z.coerce.number().positive().max(1_000_000)]).optional(),
  validFrom: deviceValidityBound.optional(),
  validTo: deviceValidityBound.optional(),
  doorPin: doorPinSchema.optional(),
  active: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional(),
});

const validityOrder = (value: { validFrom?: Date; validTo?: Date }): boolean =>
  !value.validFrom || !value.validTo || value.validFrom < value.validTo;

/** Built per call: zod expects a mutable `path`, so a shared frozen array fails. */
const validityOrderIssue = (): { message: string; path: PropertyKey[] } => ({
  message: 'Tarikh mula mesti sebelum tarikh tamat',
  path: ['validTo'],
});

export const staffInputSchema = staffFieldsSchema.refine(validityOrder, validityOrderIssue());
export type StaffInput = z.infer<typeof staffInputSchema>;

export const staffUpdateSchema = staffFieldsSchema
  .partial()
  .refine(validityOrder, validityOrderIssue());
export type StaffUpdate = z.infer<typeof staffUpdateSchema>;

/**
 * Query for the staff directory.
 *
 * Paging is mandatory rather than optional. At five thousand records an
 * unpaginated list is the kind of endpoint that works in testing and takes the
 * server down on the first real payroll run.
 */
export const staffQuerySchema = z.object({
  search: z.string().trim().max(128).optional(),
  departmentId: z.coerce.number().int().positive().optional(),
  locationId: z.coerce.number().int().positive().optional(),
  active: z.stringbool().optional(),
  /**
   * Biometric enrolment state.
   *
   * Tri-state rather than a `missingBiometrics` boolean, because a boolean can only express
   * one of the two things a screen needs to ask. Selecting "enrolled" sent no filter at all
   * and listed everybody — a chip labelled "face enrolled" showing every staff member,
   * which reads as broken rather than as unfiltered.
   *
   * `missing` means active and holding none of the three credentials. Inactive staff are
   * excluded on purpose: they are removed from the terminals anyway, so counting them as
   * unable to scan inflates a figure whose whole job is to name a fixable problem.
   */
  biometrics: z.enum(['missing', 'enrolled']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

export type StaffQuery = z.infer<typeof staffQuerySchema>;
