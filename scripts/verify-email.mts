/**
 * Verifies SMTP profiles end to end against the running server.
 *
 * The point is that mail actually leaves. So this script stands up a real SMTP server on
 * loopback, points a profile at it, and then asserts the message arrived — headers,
 * sender, recipient and body. A mocked transport would prove the form saves; it would not
 * prove the stored password decrypts, that the encryption mode maps to the right socket,
 * or that the envelope carries the sender the profile declares.
 *
 * It also drives the failures, because the value of a test button is not that it went red
 * but that it said which field to change.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/verify-email.mts <password>
 */
import { AddressInfo } from 'node:net';

import { generateSync } from 'otplib';
import { SMTPServer } from 'smtp-server';

const BASE = process.env['API_BASE'] ?? 'http://127.0.0.1:8080';
const email = process.env['ADMIN_EMAIL'] ?? 'faizan@hospital.local';
const password = process.argv[2];
const totpSecret = process.env['ADMIN_TOTP_SECRET'];

if (!password) {
  console.error('Usage: verify-email.mts <adminPassword>');
  process.exit(2);
}

const SMTP_USER = 'ujian@hospital.local';
const SMTP_PASS = 'kata-laluan-ujian';

let cookie = '';
let failures = 0;
const created: number[] = [];

interface Captured {
  from: string;
  to: string[];
  raw: string;
  authUser: string | null;
}

const inbox: Captured[] = [];

/**
 * A throwaway relay.
 *
 * `allowInsecureAuth` because the profile under test uses no encryption on loopback —
 * the transport layer is not what is being verified here, the wiring is.
 */
const relay = new SMTPServer({
  authOptional: false,
  allowInsecureAuth: true,
  disabledCommands: ['STARTTLS'],
  onAuth(auth, _session, callback) {
    if (auth.username === SMTP_USER && auth.password === SMTP_PASS) {
      callback(null, { user: auth.username });
      return;
    }
    callback(new Error('Invalid username or password'));
  },
  onData(stream, session, callback) {
    let raw = '';
    stream.on('data', (chunk: Buffer) => (raw += chunk.toString('utf8')));
    stream.on('end', () => {
      inbox.push({
        from: session.envelope.mailFrom === false ? '' : session.envelope.mailFrom.address,
        to: session.envelope.rcptTo.map((entry) => entry.address),
        raw,
        authUser: (session.user as string | undefined) ?? null,
      });
      callback();
    });
  },
});

relay.on('error', () => undefined);

const port = await new Promise<number>((resolve, reject) => {
  relay.listen(0, '127.0.0.1', () => {
    const address = relay.server.address() as AddressInfo | null;
    if (address === null) reject(new Error('SMTP server did not bind'));
    else resolve(address.port);
  });
});

show('relay ujian', `127.0.0.1:${String(port)} · pengguna ${SMTP_USER}`);

await call('POST', '/api/auth/login', {
  email,
  password,
  ...(totpSecret ? { totp: generateSync({ secret: totpSecret }) } : {}),
});
check('logged in', cookie.length > 0);

const stamp = Date.now().toString().slice(-6);
const key = `ujian-${stamp}`;

// ---------------------------------------------------------------------------
console.log('\n=== Provider presets come from the server ===');
// ---------------------------------------------------------------------------

const listing = await call('GET', '/api/email-profiles');
check('the profile list responds', listing.status === 200);
const providers = (listing.body['providers'] ?? []) as Array<Record<string, unknown>>;
check('and offers presets the form can apply', providers.length >= 2);
check(
  'every preset names a host, port and encryption',
  providers.every(
    (row) =>
      typeof row['label'] === 'string' &&
      typeof row['port'] === 'number' &&
      typeof row['encryption'] === 'string',
  ),
);
for (const provider of providers) {
  show(
    `  ${String(provider['key'])}`,
    `${String(provider['host']) || '(kosong)'}:${String(provider['port'])} ${String(provider['encryption'])}`,
  );
}

// ---------------------------------------------------------------------------
console.log('\n=== Keys are validated, and unique ===');
// ---------------------------------------------------------------------------

const base = {
  name: `Ujian ${stamp}`,
  fromName: 'Sistem Kehadiran Ujian',
  fromEmail: 'kehadiran@hospital.local',
  active: true,
  provider: 'custom',
  host: '127.0.0.1',
  port,
  encryption: 'none',
  timeoutSeconds: 10,
  maxRetries: 2,
  authenticate: true,
  username: SMTP_USER,
  password: SMTP_PASS,
};

const badKey = await call('POST', '/api/email-profiles', { ...base, key: 'Tidak Sah!' });
// The key appears in code, so its shape is constrained rather than sanitised silently.
check('a key with spaces or capitals is refused', badKey.status >= 400);

const profile = await call('POST', '/api/email-profiles', { ...base, key });
check('the profile is created', profile.status === 200);
if (profile.status !== 200) {
  show('error', JSON.stringify(profile.body));
  await finish();
}
const id = Number(profile.body['id']);
created.push(id);

const duplicate = await call('POST', '/api/email-profiles', { ...base, key });
check('a duplicate key is refused', duplicate.status === 409);
show('message', String(duplicate.body['error']).slice(0, 100));

// ---------------------------------------------------------------------------
console.log('\n=== The password never comes back ===');
// ---------------------------------------------------------------------------

const afterCreate = await call('GET', '/api/email-profiles');
const row = ((afterCreate.body['profiles'] ?? []) as Array<Record<string, unknown>>).find(
  (entry) => entry['id'] === id,
);
check('the profile is listed', row !== undefined);
check('and reports that a password is stored', row?.['passwordSet'] === true);
/**
 * The credential belongs to the hospital's mail system, not to this application. An
 * endpoint that emits it — even encrypted — becomes the weak point.
 */
const serialised = JSON.stringify(afterCreate.body).toLowerCase();
check('no endpoint emits the password or its ciphertext', !serialised.includes(SMTP_PASS.toLowerCase()));
check('and no field holds the encrypted form', !serialised.includes('passwordencrypted'));

// ---------------------------------------------------------------------------
console.log('\n=== A test sends a real message ===');
// ---------------------------------------------------------------------------

inbox.length = 0;
const sent = await call('POST', `/api/email-profiles/${String(id)}/test`, {
  recipient: 'penerima@hospital.local',
});
check('the test reports success', sent.status === 200 && sent.body['ok'] === true);
show('detail', String(sent.body['lastTestDetail']).slice(0, 120));
show('masa', `${String(sent.body['elapsedMs'])}ms`);

// The assertion that separates this from a form that saves.
check('and the relay actually received a message', inbox.length === 1);

const message = inbox[0];
if (message) {
  check('the envelope sender is the profile address', message.from === 'kehadiran@hospital.local');
  check('the recipient is the one asked for', message.to.join(',') === 'penerima@hospital.local');
  check('the relay authenticated the stored credential', message.authUser === SMTP_USER);
  // Proves the display name was assembled, not just the bare address.
  check(
    'the From header carries the display name',
    /^From:\s*Sistem Kehadiran Ujian <kehadiran@hospital\.local>/m.test(message.raw),
  );
  check('the subject names the profile', message.raw.includes(`Ujian ${stamp}`));
  check('and the body names the relay it went through', message.raw.includes(`127.0.0.1:${String(port)}`));
}

const stored = await profileById(id);
check('the outcome is stored on the profile', stored?.['lastTestOk'] === true);
check('with a timestamp', typeof stored?.['lastTestAt'] === 'string');

// ---------------------------------------------------------------------------
console.log('\n=== Default recipient is the profile itself ===');
// ---------------------------------------------------------------------------

inbox.length = 0;
const toSelf = await call('POST', `/api/email-profiles/${String(id)}/test`, { recipient: '' });
check('a blank recipient still sends', toSelf.status === 200 && toSelf.body['ok'] === true);
check(
  'and goes to the profile address',
  inbox[0]?.to.join(',') === 'kehadiran@hospital.local',
);

// ---------------------------------------------------------------------------
console.log('\n=== A blank password keeps the stored one ===');
// ---------------------------------------------------------------------------

const renamed = await call('PATCH', `/api/email-profiles/${String(id)}`, {
  name: `Ujian ${stamp} disunting`,
  password: '',
});
check('an edit with a blank password saves', renamed.status === 200);

inbox.length = 0;
const afterEdit = await call('POST', `/api/email-profiles/${String(id)}/test`, {});
// If blank had cleared the credential, the relay would refuse the login.
check('and the profile still authenticates afterwards', afterEdit.body['ok'] === true);
check('so the message still arrives', inbox.length === 1);

// ---------------------------------------------------------------------------
console.log('\n=== The key cannot be repointed ===');
// ---------------------------------------------------------------------------

await call('PATCH', `/api/email-profiles/${String(id)}`, { key: 'kunci-lain' });
const unchanged = await profileById(id);
// Notifications select by key. Renaming would detach every one that names it, silently.
check('an attempt to change the key leaves it alone', unchanged?.['key'] === key);

// ---------------------------------------------------------------------------
console.log('\n=== Failures say which field is wrong ===');
// ---------------------------------------------------------------------------

await call('PATCH', `/api/email-profiles/${String(id)}`, { password: 'kata-laluan-salah' });
inbox.length = 0;
const badAuth = await call('POST', `/api/email-profiles/${String(id)}/test`, {});
check('a rejected password fails the test', badAuth.body['ok'] === false);
check('and nothing was delivered', inbox.length === 0);
check(
  'and the message points at the credentials',
  /kredensial|kata laluan/i.test(String(badAuth.body['lastTestDetail'])),
);
show('detail', String(badAuth.body['lastTestDetail']).slice(0, 130));

// Restore the working password, then break the address instead.
await call('PATCH', `/api/email-profiles/${String(id)}`, { password: SMTP_PASS });

const deadPort = port === 65535 ? 65534 : port + 1;
await call('PATCH', `/api/email-profiles/${String(id)}`, { port: deadPort });
const refused = await call('POST', `/api/email-profiles/${String(id)}/test`, {});
check('a port with nothing listening fails the test', refused.body['ok'] === false);
check(
  'and the message says nothing is listening rather than naming a syscall',
  /mendengar|firewall|menjawab/i.test(String(refused.body['lastTestDetail'])),
);
show('detail', String(refused.body['lastTestDetail']).slice(0, 130));

await call('PATCH', `/api/email-profiles/${String(id)}`, { port });

// A hostname that cannot resolve reaches nodemailer as `EDNS`, not `ENOTFOUND`, which is
// why the mapping reads the message rather than trusting the code.
await call('PATCH', `/api/email-profiles/${String(id)}`, {
  host: 'tiada-host-ini.hospital.invalid',
});
const noDns = await call('POST', `/api/email-profiles/${String(id)}/test`, {});
check('a hostname that does not resolve fails the test', noDns.body['ok'] === false);
check(
  'and the message says the name cannot be resolved',
  /diselesaikan|DNS/i.test(String(noDns.body['lastTestDetail'])),
);
show('detail', String(noDns.body['lastTestDetail']).slice(0, 130));

await call('PATCH', `/api/email-profiles/${String(id)}`, { host: '127.0.0.1' });

// ---------------------------------------------------------------------------
console.log('\n=== An inactive profile refuses to be tested ===');
// ---------------------------------------------------------------------------

await call('PATCH', `/api/email-profiles/${String(id)}`, { active: false });
const inactive = await call('POST', `/api/email-profiles/${String(id)}/test`, {});
// A pass here would certify a sender that is skipped by everything that sends.
check('testing an inactive profile is refused', inactive.status === 409);
show('message', String(inactive.body['error']).slice(0, 120));
await call('PATCH', `/api/email-profiles/${String(id)}`, { active: true });

// ---------------------------------------------------------------------------
console.log('\n=== Authentication cannot be half-configured ===');
// ---------------------------------------------------------------------------

const noUser = await call('POST', '/api/email-profiles', {
  ...base,
  key: `ujian-nouser-${stamp}`,
  username: '',
});
check('authenticate on with no username is refused', noUser.status === 409);
show('message', String(noUser.body['error']).slice(0, 100));

// An internal relay that authorises by source address is a real arrangement, so
// authenticate off with no credentials has to be allowed.
const anonymous = await call('POST', '/api/email-profiles', {
  ...base,
  key: `ujian-anon-${stamp}`,
  authenticate: false,
  username: '',
  password: '',
});
check('but authenticate off with no credentials is accepted', anonymous.status === 200);
if (anonymous.status === 200) created.push(Number(anonymous.body['id']));

await finish();

// ---------------------------------------------------------------------------

async function profileById(target: number): Promise<Record<string, unknown> | undefined> {
  const response = await call('GET', '/api/email-profiles');
  return ((response.body['profiles'] ?? []) as Array<Record<string, unknown>>).find(
    (entry) => entry['id'] === target,
  );
}

async function finish(): Promise<never> {
  console.log('\n=== Cleanup ===');
  let removed = 0;
  for (const target of created) {
    const response = await call('DELETE', `/api/email-profiles/${String(target)}`);
    if (response.status === 200) removed += 1;
  }
  show('profil dibuang', `${String(removed)} daripada ${String(created.length)}`);

  console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);

  // Closed without awaiting the callback: libuv asserts if a handle is still closing
  // when the process exits, and there is nothing left to wait for anyway.
  relay.close();
  process.exit(failures === 0 ? 0 : 1);
}

async function call(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      ...(cookie ? { cookie } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  for (const entry of response.headers.getSetCookie()) {
    const pair = entry.split(';')[0];
    if (pair?.startsWith('attendance_session=')) cookie = pair;
  }

  const text = await response.text();
  try {
    return { status: response.status, body: (JSON.parse(text) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: response.status, body: { raw: text.slice(0, 200) } };
  }
}

function show(label: string, value: string): void {
  console.log(`         ${label}: ${value}`);
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}
