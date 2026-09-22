/**
 * Asks the terminal whether credentials can be read out of it and written into another.
 *
 * Read-only. This is the deciding question for propagating an enrolment across terminals:
 * a face can already be copied because `faceURL` is downloadable, but fingerprints and cards
 * are only copyable if this firmware implements the read side. The ISAPI reference lists the
 * endpoints; whether V4.38.0 answers them is a different matter, and guessing it would put a
 * feature in front of an operator that silently does nothing.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/probe-credentials.mts [employeeNo]
 */
import { HikvisionClient, IsapiStatusError } from '@attendance/hik-isapi';

const employeeNo = process.argv[2] ?? '1';

const client = new HikvisionClient({
  baseUrl: requireEnv('HIK_HOST'),
  username: requireEnv('HIK_USERNAME'),
  password: requireEnv('HIK_PASSWORD'),
  verifyTls: process.env['HIK_VERIFY_TLS'] === 'true',
});

/** Capability documents first: they say what exists without changing anything. */
const CAPABILITIES = [
  '/ISAPI/AccessControl/FingerPrintCfg/capabilities?format=json',
  '/ISAPI/AccessControl/FingerPrintUpload/capabilities?format=json',
  '/ISAPI/AccessControl/FingerPrintDownload/capabilities?format=json',
  '/ISAPI/AccessControl/CaptureFingerPrint/capabilities?format=json',
  '/ISAPI/AccessControl/CardInfo/capabilities?format=json',
];

console.log(`\n=== Dokumen keupayaan ===`);
for (const path of CAPABILITIES) {
  await probe('GET', path);
}

console.log(`\n=== Baca kredensial untuk employeeNo ${employeeNo} ===`);
// Both are POST-with-condition endpoints on this firmware family.
await probe('POST', '/ISAPI/AccessControl/FingerPrintDownload?format=json', {
  FingerPrintDownloadCond: { searchID: 'probe-fp', employeeNo, cardReaderNo: 1 },
});
await probe('POST', '/ISAPI/AccessControl/CardInfo/Search?format=json', {
  CardInfoSearchCond: { searchID: 'probe-card', searchResultPosition: 0, maxResults: 10, EmployeeNoList: [{ employeeNo }] },
});

/**
 * `FingerPrintCfg` is the endpoint this firmware kept, and the deciding one.
 *
 * `FingerPrintDownload` answers `notSupport`, so if this does not return `fingerData` then
 * no template can leave the unit and a fingerprint cannot be copied to a second terminal at
 * all — it has to be re-captured at each one.
 */
console.log(`\n=== Templat cap jari: boleh dibaca keluar? ===`);
await probe('POST', '/ISAPI/AccessControl/FingerPrintCfg/Search?format=json', {
  FingerPrintCfgSearchCond: { searchID: 'probe-fpcfg', employeeNo, cardReaderNo: 1 },
});
await probe('GET', `/ISAPI/AccessControl/FingerPrintCfg?format=json&employeeNo=${employeeNo}`);

await client.close();

async function probe(method: 'GET' | 'POST', path: string, body?: unknown): Promise<void> {
  const name = path.replace('/ISAPI/AccessControl/', '').replace('?format=json', '');
  try {
    const reply = method === 'GET' ? await client.raw.get(path) : await client.raw.post(path, body);
    const text = JSON.stringify(reply);
    console.log(`  [ADA]  ${name}`);
    console.log(`         ${text.length > 600 ? `${text.slice(0, 600)}…` : text}`);
  } catch (error) {
    if (error instanceof IsapiStatusError) {
      console.log(`  [TIADA] ${name} — ${error.statusString} (${error.subStatusCode ?? 'tiada subkod'})`);
    } else {
      console.log(`  [RALAT] ${name} — ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}
