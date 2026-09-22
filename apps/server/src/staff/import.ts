import { DEVICE_LIMITS } from '@attendance/shared';
import { z } from 'zod';

import { encryptSecret } from '../crypto.js';
import { db } from '../db.js';
import { logger } from '../logger.js';
import { pushStaffToDevices } from './sync.js';

/** Columns accepted in the upload, with the Malay headers an operator will use. */
/*
 * Every header spelling accepted, in both languages.
 *
 * The English column names are here because the interface is translated. An operator reading the
 * English screen is told the recognised columns are "Staff No., Name, NRIC" — and before these
 * aliases existed the parser knew `employeeno` and `fullname` but not `staff no.`, `name` or `nric`,
 * so following the instruction on screen produced a file that was refused on its header row.
 *
 * Compared lowercased and trimmed, so `Staff No.` and `staff no.` are the same key.
 */
const COLUMN_ALIASES: Record<string, string> = {
  no_staf: 'employeeNo',
  'no. staf': 'employeeNo',
  employeeno: 'employeeNo',
  'employee no': 'employeeNo',
  'employee no.': 'employeeNo',
  'staff no': 'employeeNo',
  'staff no.': 'employeeNo',
  staff_no: 'employeeNo',

  nama: 'fullName',
  nama_penuh: 'fullName',
  fullname: 'fullName',
  'full name': 'fullName',
  full_name: 'fullName',
  name: 'fullName',

  no_kp: 'icNo',
  'no. kp': 'icNo',
  ic: 'icNo',
  icno: 'icNo',
  nric: 'icNo',
  'nric no': 'icNo',
  'nric no.': 'icNo',

  telefon: 'phone',
  phone: 'phone',
  'phone no': 'phone',
  'phone no.': 'phone',
  mobile: 'phone',

  emel: 'email',
  email: 'email',

  jabatan: 'department',
  department: 'department',

  lokasi: 'location',
  location: 'location',

  pin: 'doorPin',
  pin_pintu: 'doorPin',
  doorpin: 'doorPin',
  'door pin': 'doorPin',
  door_pin: 'doorPin',

  gaji: 'basicSalary',
  gaji_bulanan: 'basicSalary',
  'gaji bulanan': 'basicSalary',
  basicsalary: 'basicSalary',
  salary: 'basicSalary',
  'basic salary': 'basicSalary',
  'monthly salary': 'basicSalary',
};

const rowSchema = z.object({
  employeeNo: z
    .string()
    .trim()
    .min(1, 'No. Staf diperlukan')
    .max(DEVICE_LIMITS.employeeNoMaxLength, `Maksimum ${DEVICE_LIMITS.employeeNoMaxLength} aksara`)
    .regex(/^[A-Za-z0-9._-]+$/, 'Hanya huruf, nombor, titik, sengkang'),
  fullName: z
    .string()
    .trim()
    .min(1, 'Nama diperlukan')
    .max(DEVICE_LIMITS.nameMaxLength, `Maksimum ${DEVICE_LIMITS.nameMaxLength} aksara`),
  icNo: z.string().trim().max(20).optional(),
  phone: z.string().trim().max(20).optional(),
  email: z.union([z.literal(''), z.email('Emel tidak sah')]).optional(),
  department: z.string().trim().max(120).optional(),
  location: z.string().trim().max(120).optional(),
  doorPin: z
    .union([
      z.literal(''),
      z
        .string()
        .regex(/^\d+$/, 'PIN mesti nombor')
        .min(DEVICE_LIMITS.passwordLength.min, `Minimum ${DEVICE_LIMITS.passwordLength.min} digit`)
        .max(DEVICE_LIMITS.passwordLength.max, `Maksimum ${DEVICE_LIMITS.passwordLength.max} digit`),
    ])
    .optional(),
  /*
   * Empty cells are dropped before this schema runs, so there is no `''` branch: an
   * omitted wage arrives as `undefined` and stays null in the directory.
   *
   * Coerced from text because every CSV cell is text. A cell holding `abc` becomes NaN
   * and fails `positive()`, which is what names the bad row in the preview instead of
   * writing a wage of zero.
   */
  basicSalary: z.coerce
    .number('Gaji mesti nombor')
    .positive('Gaji mesti lebih daripada sifar')
    .max(1_000_000, 'Gaji maksimum 1,000,000')
    .optional(),
});

export type ImportRow = z.infer<typeof rowSchema>;

export interface RowProblem {
  /** 1-based, counting the header as line 1, so it matches what a spreadsheet shows. */
  line: number;
  employeeNo: string;
  field: string;
  message: string;
}

export interface ImportPreview {
  totalLines: number;
  valid: ImportRow[];
  problems: RowProblem[];
  /** Already present in the directory; these are skipped rather than duplicated. */
  existing: string[];
  /** Department and location names in the file that do not exist yet. */
  newDepartments: string[];
  newLocations: string[];
}

/**
 * Parses and validates an upload without writing anything.
 *
 * Split from the commit deliberately. With five thousand rows, discovering a bad
 * column on row 4000 after 3999 writes leaves the directory half-populated and the
 * operator with no clear way back. Validating everything first means the commit is
 * predictable.
 */
export async function previewImport(
  csv: string,
  /**
   * Whether the caller holds the `salary` action on `staff.directory`.
   *
   * Gated here rather than at the route because both endpoints reach the CSV through
   * this function — `startImport` is only ever handed rows this produced — so one check
   * covers the upload and the commit.
   */
  options: { maySetSalary: boolean },
): Promise<ImportPreview> {
  const lines = splitLines(csv);
  const preview: ImportPreview = {
    totalLines: Math.max(0, lines.length - 1),
    valid: [],
    problems: [],
    existing: [],
    newDepartments: [],
    newLocations: [],
  };

  if (lines.length < 2) return preview;

  const headers = parseCsvLine(lines[0]!).map((header) =>
    COLUMN_ALIASES[header.trim().toLowerCase()] ?? header.trim(),
  );

  /*
   * Refused rather than ignored.
   *
   * Dropping the column silently would let somebody upload five thousand wages, watch the
   * import report success, and leave every overtime claim priced from a wage that was
   * never stored. `staff.import` is not the grant that decides pay.
   */
  if (headers.includes('basicSalary') && !options.maySetSalary) {
    preview.problems.push({
      line: 1,
      employeeNo: '',
      field: 'header',
      message:
        'Fail ini mengandungi kolum Gaji, yang memerlukan kebenaran "Gaji Bulanan" pada ' +
        'Direktori Staf. Buang kolum itu atau minta kebenaran tersebut.',
    });
    return preview;
  }

  if (!headers.includes('employeeNo') || !headers.includes('fullName')) {
    preview.problems.push({
      line: 1,
      employeeNo: '',
      field: 'header',
      message:
        'Fail mesti mempunyai kolum No. Staf dan Nama. Kolum dikenali: No. Staf, Nama, No. KP, ' +
        'Telefon, Emel, Jabatan, Lokasi, PIN, Gaji.',
    });
    return preview;
  }

  // Duplicates within the file itself are caught here. The database unique index
  // would reject the second one anyway, but as a mid-commit failure rather than
  // something the operator can fix before starting.
  const seen = new Map<string, number>();

  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim().length === 0) continue;

    const cells = parseCsvLine(line);
    const record: Record<string, string> = {};
    headers.forEach((header, column) => {
      const value = cells[column]?.trim() ?? '';
      if (value.length > 0) record[header] = value;
    });

    const lineNumber = index + 1;
    const parsed = rowSchema.safeParse(record);

    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        preview.problems.push({
          line: lineNumber,
          employeeNo: record['employeeNo'] ?? '',
          field: String(issue.path[0] ?? 'baris'),
          message: issue.message,
        });
      }
      continue;
    }

    const duplicateOf = seen.get(parsed.data.employeeNo);
    if (duplicateOf !== undefined) {
      preview.problems.push({
        line: lineNumber,
        employeeNo: parsed.data.employeeNo,
        field: 'employeeNo',
        message: `Berulang dalam fail ini, sudah ada pada baris ${duplicateOf}`,
      });
      continue;
    }

    seen.set(parsed.data.employeeNo, lineNumber);
    preview.valid.push(parsed.data);
  }

  if (preview.valid.length === 0) return preview;

  const employeeNos = preview.valid.map((row) => row.employeeNo);
  const [existing, departments, locations] = await Promise.all([
    db().staff.findMany({
      where: { employeeNo: { in: employeeNos } },
      select: { employeeNo: true },
    }),
    db().department.findMany({ select: { name: true } }),
    db().location.findMany({ select: { name: true } }),
  ]);

  preview.existing = existing.map((row) => row.employeeNo);

  const knownDepartments = new Set(departments.map((row) => row.name.toLowerCase()));
  const knownLocations = new Set(locations.map((row) => row.name.toLowerCase()));

  preview.newDepartments = [
    ...new Set(
      preview.valid
        .map((row) => row.department)
        .filter((name): name is string => !!name && !knownDepartments.has(name.toLowerCase())),
    ),
  ];
  preview.newLocations = [
    ...new Set(
      preview.valid
        .map((row) => row.location)
        .filter((name): name is string => !!name && !knownLocations.has(name.toLowerCase())),
    ),
  ];

  return preview;
}

export interface ImportProgress {
  jobId: string;
  status: 'running' | 'done' | 'failed';
  total: number;
  created: number;
  skipped: number;
  pushed: number;
  pushFailed: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
  /** Terminal failures, capped so a total outage cannot exhaust memory. */
  failures: Array<{ employeeNo: string; deviceName: string; error: string }>;
}

/**
 * Import jobs in memory.
 *
 * Adequate because an import is an attended, one-off operation: the operator is
 * watching the progress bar. A restart mid-import loses the progress report, not
 * the staff already created, and re-running skips what exists.
 */
const jobs = new Map<string, ImportProgress>();

export function getImportJob(jobId: string): ImportProgress | undefined {
  return jobs.get(jobId);
}

/**
 * Creates the staff records, then pushes them to the terminals.
 *
 * Runs in the background and reports progress, because five thousand rows means
 * several thousand sequential device calls: holding an HTTP request open for that
 * would time out long before it finished.
 */
export function startImport(rows: ImportRow[], deviceIds: number[]): ImportProgress {
  const jobId = `import-${Date.now().toString(36)}`;
  const job: ImportProgress = {
    jobId,
    status: 'running',
    total: rows.length,
    created: 0,
    skipped: 0,
    pushed: 0,
    pushFailed: 0,
    startedAt: new Date().toISOString(),
    failures: [],
  };
  jobs.set(jobId, job);

  void run(job, rows, deviceIds);
  return job;
}

async function run(
  job: ImportProgress,
  rows: ImportRow[],
  deviceIds: number[],
): Promise<void> {
  const prisma = db();

  try {
    // Referenced departments and locations are created up front, so the per-row
    // work is a plain insert with no lookups.
    const departmentIds = await ensureDepartments(rows);
    const locationIds = await ensureLocations(rows);

    for (const row of rows) {
      /**
       * Relies on the unique index rather than checking first.
       *
       * A read followed by a write is a race: two imports of the same file, which
       * happens when an impatient operator clicks twice, would both see "not
       * present" and both insert. Letting the database arbitrate and treating the
       * rejection as "already there" makes the import safe to run concurrently and
       * safe to re-run.
       */
      let staff;
      try {
        staff = await prisma.staff.create({
          data: {
            employeeNo: row.employeeNo,
            fullName: row.fullName,
            icNo: row.icNo ?? null,
            phone: row.phone ?? null,
            email: row.email && row.email.length > 0 ? row.email : null,
            departmentId: row.department
              ? (departmentIds.get(row.department.toLowerCase()) ?? null)
              : null,
            locationId: row.location ? (locationIds.get(row.location.toLowerCase()) ?? null) : null,
            doorPinEncrypted:
              row.doorPin && row.doorPin.length > 0 ? encryptSecret(row.doorPin) : null,
            basicSalary: row.basicSalary ?? null,
            active: true,
          },
        });
      } catch (error) {
        if (isUniqueViolation(error)) {
          job.skipped += 1;
          continue;
        }
        throw error;
      }

      job.created += 1;

      if (deviceIds.length === 0) continue;

      const outcomes = await pushStaffToDevices(staff, deviceIds);
      for (const outcome of outcomes) {
        if (outcome.ok) {
          job.pushed += 1;
        } else {
          job.pushFailed += 1;
          // Capped: a terminal that is down for the whole import would otherwise
          // produce one entry per row.
          if (job.failures.length < 100) {
            job.failures.push({
              employeeNo: row.employeeNo,
              deviceName: outcome.deviceName,
              error: outcome.error ?? 'tidak diketahui',
            });
          }
        }
      }
    }

    job.status = 'done';
  } catch (error) {
    job.status = 'failed';
    job.error = error instanceof Error ? error.message : String(error);
    logger().error({ jobId: job.jobId, err: job.error }, 'Bulk import failed');
  } finally {
    job.finishedAt = new Date().toISOString();

    // Kept for a while so the browser can still read the final result, then
    // dropped rather than accumulating for the process lifetime.
    setTimeout(() => jobs.delete(job.jobId), 30 * 60_000).unref();
  }
}

/**
 * True for a unique constraint rejection.
 *
 * Matched on Prisma's `P2002` code rather than the message, which is not stable
 * across versions or database engines.
 */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === 'P2002'
  );
}

async function ensureDepartments(rows: ImportRow[]): Promise<Map<string, number>> {
  const prisma = db();
  const names = [...new Set(rows.map((row) => row.department).filter((name): name is string => !!name))];
  const map = new Map<string, number>();

  for (const name of names) {
    const existing = await prisma.department.findFirst({ where: { name } });
    const record = existing ?? (await prisma.department.create({ data: { name } }));
    map.set(name.toLowerCase(), record.id);
  }

  return map;
}

async function ensureLocations(rows: ImportRow[]): Promise<Map<string, number>> {
  const prisma = db();
  const names = [...new Set(rows.map((row) => row.location).filter((name): name is string => !!name))];
  const map = new Map<string, number>();

  for (const name of names) {
    const existing = await prisma.location.findFirst({ where: { name } });
    const record = existing ?? (await prisma.location.create({ data: { name } }));
    map.set(name.toLowerCase(), record.id);
  }

  return map;
}

/** Splits on any newline convention and strips a UTF-8 BOM. */
function splitLines(csv: string): string[] {
  return csv.replace(/^\uFEFF/, '').split(/\r\n|\n|\r/);
}

/**
 * Parses one CSV line, honouring quoted fields.
 *
 * Hand-rolled rather than adding a dependency, because the shape here is narrow:
 * quoted fields, doubled quotes for a literal quote, and commas. Names in this
 * region routinely contain commas ("Ali bin Abu, Dr"), so a plain `split(',')`
 * would corrupt them.
 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];

    if (inQuotes) {
      if (char === '"') {
        if (line[index + 1] === '"') {
          current += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',' || char === ';') {
      cells.push(current);
      current = '';
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells;
}

/**
 * Template for the operator to fill in.
 *
 * The Gaji column is only offered to a caller who may set wages. Handing everybody a
 * template with a column that then refuses the whole upload is a trap dressed as help.
 */
export function importTemplate(options: { maySetSalary: boolean }): string {
  const salary = options.maySetSalary;
  return [
    `No. Staf,Nama,No. KP,Telefon,Emel,Jabatan,Lokasi,PIN${salary ? ',Gaji' : ''}`,
    '1001,Ahmad bin Ali,880101015123,0123456789,ahmad@hospital.local,Kejururawatan,Wad Bedah,123456' +
      (salary ? ',3120.00' : ''),
    '1002,"Siti Aminah binti Hassan, Dr",900202025456,0198765432,siti@hospital.local,Perubatan,Pintu Utama,' +
      (salary ? ',4500' : ''),
  ].join('\n');
}
