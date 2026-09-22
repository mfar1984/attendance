/**
 * Read-only verification of the ISAPI client against a live terminal.
 *
 * Nothing here writes to the device. Findings are compared against values
 * captured by hand with curl so that a regression in the client shows up as a
 * mismatch rather than as plausible-looking output.
 *
 *   npm run probe
 */
import {
  CAPABILITY_DOCUMENTS,
  DeviceLockedError,
  HikvisionClient,
  isIdentifiedPunch,
  isSyntheticCardNo,
} from '@attendance/hik-isapi';

process.loadEnvFile('.env');

const host = requireEnv('HIK_HOST');
const client = new HikvisionClient({
  baseUrl: host,
  username: requireEnv('HIK_USERNAME'),
  password: requireEnv('HIK_PASSWORD'),
  verifyTls: process.env['HIK_VERIFY_TLS'] === 'true',
});

let failures = 0;

/**
 * The AcsCfg fields the device editor's door tab reads.
 *
 * These are the names V4.38.0 actually uses. The ISAPI reference calls two of them
 * `showCapPic` and `showUserInfo`; this firmware has neither, and the editor was written
 * against the reference until this probe said otherwise. Keeping the list here means the
 * next firmware that renames one is caught by a warning rather than by a switch that
 * silently stops doing anything.
 */
const DOOR_TAB_ACS_FIELDS = [
  'remoteCheckDoorEnabled',
  'checkChannelType',
  'remoteCheckTimeout',
  'showPicture',
  'showEmployeeNo',
  'showName',
  'desensitiseEmployeeNo',
  'desensitiseName',
  'voicePrompt',
] as const;

/**
 * Lines printed per capability document.
 *
 * Capped because one of these can run to hundreds of fields, and a probe whose output
 * scrolls past the terminal buffer is a probe nobody reads the top of. The full document
 * is on the Diagnostics tab.
 */
const CAPABILITY_LINE_CAP = Number(process.env['HIK_CAPABILITY_LINES'] ?? '80');

try {
  await section('Device identity', async () => {
    const info = await client.system.deviceInfo();
    print('model', info.model);
    print('firmware', info.firmwareVersion);
    print('serial', info.serialNumber);
    print('mac', info.macAddress);
    check('model is DS-K1T342MFX-E1', info.model === 'DS-K1T342MFX-E1');
    check('firmware is V4.38.0', info.firmwareVersion === 'V4.38.0');
  });

  await section('Clock', async () => {
    const drift = await client.system.clockDrift();
    print('device time', drift.deviceTime.toISOString());
    print('server time', drift.serverTime.toISOString());
    print('drift', `${drift.driftSeconds}s`);
    print('time zone', drift.timeZone);
    print('mode', drift.manualClock ? 'manual (NTP not driving the clock)' : 'NTP');
    warn(
      Math.abs(drift.driftSeconds) > 30,
      `Clock is off by ${drift.driftSeconds}s. Every attendance record inherits this error.`,
    );
    warn(drift.manualClock, 'timeMode is manual, so the drift will keep growing.');

    const ntp = await client.system.ntpServers();
    for (const server of ntp) {
      print('ntp', `${server.ipAddress ?? server.hostName}:${server.portNo} every ${server.synchronizeInterval}m`);
    }
    warn(
      ntp.some((s) => s.ipAddress === '192.0.0.64'),
      'NTP still points at the factory placeholder 192.0.0.64, which never responds.',
    );
  });

  await section('Enrolled people', async () => {
    const counts = await client.persons.counts();
    print('total', String(counts.userNumber));
    print('with face', String(counts.bindFaceUserNumber));
    print('with fingerprint', String(counts.bindFingerprintUserNumber));
    print('with card', String(counts.bindCardUserNumber));

    let listed = 0;
    for await (const person of client.persons.iterate()) {
      listed += 1;
      const credentials = [
        person.numOfFace ? 'face' : null,
        person.numOfFP ? 'fp' : null,
        person.numOfCard ? 'card' : null,
      ].filter(Boolean);
      print(
        `  #${person.employeeNo}`,
        `${person.name || '(no name)'} — ${credentials.length ? credentials.join('+') : 'NO CREDENTIALS'}`,
      );
    }
    check('paginated list matches the reported count', listed === counts.userNumber);
  });

  await section('Face library', async () => {
    const libraries = await client.faces.libraries();
    for (const library of libraries) {
      print(`FDID ${library.FDID}`, library.faceLibType);
    }
    const capacity = await client.faces.capacity();
    print('capacity', `${capacity.maxRecords} faces`);
    check('enrolment library present', libraries.some((l) => l.faceLibType === 'blackFD'));
  });

  await section('Attendance mode', async () => {
    const mode = await client.system.attendanceMode();
    print('mode', mode.mode);
    warn(
      mode.mode === 'disable',
      'Mode is disabled, so events carry no attendanceStatus. IN/OUT must be derived from scan order.',
    );
  });

  /**
   * The whole AcsCfg object.
   *
   * The health check reads this and keeps one flag out of it, so every other field the
   * firmware reports has never been looked at. Printing all of it is what turns "the door
   * tab has no control for X" into an answerable question.
   */
  await section('Terminal-wide flags (AcsCfg)', async () => {
    const config = await client.system.acsConfig();
    const fields = flatten(config);
    print('fields reported', String(fields.length));
    for (const field of fields) print(`  ${field.path}`, field.value);
    check('AcsCfg is readable', fields.length > 0);

    // The five the device editor binds switches to. A missing one means that switch shows
    // as off when the terminal has no such setting at all, which is a different thing.
    for (const name of DOOR_TAB_ACS_FIELDS) {
      warn(
        !(name in config),
        `AcsCfg has no "${name}"; the door tab switch for it will read as off rather than as absent.`,
      );
    }
    warn(
      config['remoteCheckDoorEnabled'] === true,
      `Remote verification is on (channel=${String(config['checkChannelType'])}, ` +
        `timeout=${String(config['remoteCheckTimeout'])}s). If the channel does not answer, ` +
        'that timeout is added to every single scan.',
    );
  });

  /**
   * Door and reader configuration, which is where the authentication requirement lives.
   *
   * An absent endpoint is reported and not counted as a failure. Whether this firmware
   * implements them is the question being asked, so answering "no" is a result — the
   * device editor renders those groups as unsupported and the rest of the tab still works.
   *
   * `RemoteControl/door` is deliberately not exercised. It opens the door.
   */
  await section('Door and reader configuration', async () => {
    const doorNo = Number(process.env['HIK_DOOR_NO'] ?? '1');

    const door = await client.access.doorParam(doorNo);
    if (door === null) {
      print(`Door/param/${doorNo}`, 'NOT SUPPORTED on this firmware');
      print('  consequence', 'open duration and magnet sensor must be set at the keypad');
    } else {
      print('door name', door.doorName ?? '(not reported)');
      print('open duration', door.openDuration === null ? '(not reported)' : `${door.openDuration}s`);
      print('extended duration', door.disabledOpenDuration === null ? '(not reported)' : `${door.disabledOpenDuration}s`);
      print('held-open alarm', door.magneticAlarmTimeout === null ? '(not reported)' : `${door.magneticAlarmTimeout}s`);
      print('magnet type', door.magneticType ?? '(not reported)');
      print('exit button type', door.openButtonType ?? '(not reported)');
      print('raw fields', String(Object.keys(door.raw).length));
      for (const field of flatten(door.raw)) print(`  ${field.path}`, field.value);
      // Read-modify-write depends on this: the merge sends `raw` back with the patch on
      // top, so a door that reports nothing would be written back as an empty object.
      check('door parameters carry a readable object for read-modify-write', Object.keys(door.raw).length > 0);
    }

    const reader = await client.access.cardReaderConfig(1);
    if (reader === null) {
      print('CardReaderCfg/1', 'NOT SUPPORTED on this firmware');
      print('  consequence', 'authentication mode must be set at the keypad');
    } else {
      print('reader enabled', reader.enabled === null ? '(not reported)' : String(reader.enabled));
      print('default verify mode', reader.defaultVerifyMode ?? '(not reported)');
      print('active modules', reader.functions.length > 0 ? reader.functions.join(' + ') : '(none reported)');
      print('face threshold 1:N', reader.faceMatchThresholdN === null ? '(not reported)' : String(reader.faceMatchThresholdN));
      print('liveness detection', reader.livingBodyDetect === null ? '(not reported)' : String(reader.livingBodyDetect));
      print('liveness level', reader.liveDetLevel ?? '(not reported)');
      print('fingerprint level', reader.fingerprintLevel === null ? '(not reported)' : String(reader.fingerprintLevel));
      print('raw fields', String(Object.keys(reader.raw).length));
      for (const field of flatten(reader.raw)) print(`  ${field.path}`, field.value);
      check('reader configuration carries a readable object for read-modify-write', Object.keys(reader.raw).length > 0);
      warn(
        reader.defaultVerifyMode === null,
        'The reader reports no defaultVerifyMode, so the authentication control has nothing to bind to.',
      );
      // Not a tuning knob. Without it a matched face is only an image that scored high
      // enough, so a photograph held up to the reader opens the door and is recorded as
      // that person's attendance.
      warn(
        reader.livingBodyDetect === false,
        'Liveness detection is OFF. A photograph held in front of the reader can open the ' +
          "door and be recorded as that person's attendance.",
      );
      warn(
        reader.defaultVerifyMode !== null && reader.defaultVerifyMode.includes('Pw'),
        `Default verify mode is "${reader.defaultVerifyMode}", which accepts a PIN alone. ` +
          'A PIN can be shared, so attendance recorded that way proves only that the number was known.',
      );
    }
  });

  /**
   * Capability documents.
   *
   * These decide what the editor can offer. The authentication mode list is read from the
   * device rather than hardcoded, so if `verifyMode` has no `opt` attribute here, that
   * control falls back to displaying the current value and nothing else — and this section
   * is what says so before somebody goes looking for the bug.
   */
  await section('Capability documents', async () => {
    for (const [name, path] of Object.entries(CAPABILITY_DOCUMENTS)) {
      const document = await client.access.capabilities(path);
      if (document === null) {
        print(name, 'NOT SUPPORTED on this firmware');
        continue;
      }
      const fields = flatten(document);
      print(name, `${fields.length} fields`);
      for (const field of fields.slice(0, CAPABILITY_LINE_CAP)) {
        print(`  ${field.path}`, field.value);
      }
      if (fields.length > CAPABILITY_LINE_CAP) {
        print('  …', `${fields.length - CAPABILITY_LINE_CAP} more fields not printed`);
      }
    }

    /**
     * The option lists the door tab builds its controls from.
     *
     * `defaultVerifyMode` is expected to be absent on V4.38.0: the firmware holds a value
     * for it but publishes no `opt` list, so the editor falls back to a documented list
     * marked as unverified. Printed rather than asserted, because a firmware that starts
     * publishing it is an improvement and not a regression.
     */
    const sets = await client.access.optionSets(CAPABILITY_DOCUMENTS.cardReader, [
      'defaultVerifyMode',
      'fingerPrintCheckLevel',
      'liveDetLevelSet',
      'cardReaderFunction',
    ]);

    for (const field of ['defaultVerifyMode', 'fingerPrintCheckLevel', 'liveDetLevelSet'] as const) {
      const values = sets[field];
      print(`${field} opt`, values === undefined ? 'not published' : values.join(', '));
    }
    warn(
      sets['defaultVerifyMode'] === undefined,
      'The reader publishes no option list for defaultVerifyMode, so the authentication ' +
        'control offers a documented list that this unit may reject. A refused value fails ' +
        'loudly rather than saving silently.',
    );
    check(
      'the fingerprint level control has a device-supplied option list',
      sets['fingerPrintCheckLevel'] !== undefined,
    );
  });

  await section('Event log', async () => {
    const latest = await client.events.latestSerialNo();
    print('latest serialNo', String(latest));
    check('serial cursor is readable', latest > 0);

    const recent = await client.events.since(Math.max(0, latest - 10), { includePictures: true });
    print('events after cursor', String(recent.length));

    for (const event of recent) {
      const who = isIdentifiedPunch(event) ? `${event.employeeNo} ${event.name ?? ''}`.trim() : '—';
      print(
        `  #${event.serialNo}`,
        `${event.time}  major=${event.major} minor=${event.minor}  ${who}`,
      );
      if (isSyntheticCardNo(event.cardNo)) {
        print('    note', `cardNo ${event.cardNo} is the face-auth sentinel, not a real card`);
      }
      if (event.remoteCheckResult) {
        print('    note', `remoteCheckResult=${event.remoteCheckResult}`);
      }
    }
    check(
      'serial numbers come back in ascending order',
      recent.every((event, index) => index === 0 || event.serialNo > recent[index - 1]!.serialNo),
    );
  });

  await section('Push notification slots', async () => {
    const hosts = await client.notifications.hosts();
    for (const slot of hosts) {
      const address = slot.hostName || slot.ipAddress || '(unset)';
      print(
        `slot ${slot.id}`,
        `${slot.protocolType} ${address}:${slot.portNo}${slot.url} auth=${slot.httpAuthenticationMethod}`,
      );
    }
    warn(
      hosts.some((slot) => slot.httpAuthenticationMethod === 'none' && slot.portNo !== 0),
      'A configured slot posts without authentication; anyone reachable could forge punches.',
    );
  });
} catch (error) {
  if (error instanceof DeviceLockedError) {
    console.error(`\n  Account locked. Do not retry for ${error.unlockInSeconds ?? '?'}s.`);
  } else {
    console.error('\n  Probe aborted:', error instanceof Error ? error.message : error);
  }
  failures += 1;
} finally {
  await client.close();
}

console.log(failures === 0 ? '\nAll checks passed.\n' : `\n${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);

async function section(title: string, run: () => Promise<void>): Promise<void> {
  console.log(`\n=== ${title} ===`);
  await run();
}

function print(label: string, value: string): void {
  console.log(`  ${label.padEnd(22)} ${value}`);
}

/**
 * Turns a device document into one `path = value` line per leaf.
 *
 * Flattened rather than pretty-printed as JSON so the output is greppable: the question
 * these sections answer is "does this firmware report field X", and `grep verifyMode` has
 * to be able to answer it from a saved log.
 *
 * Attribute keys arrive prefixed with `@` from the XML parser, and `@opt` is how ISAPI
 * encodes an enumeration — so those lines are the ones worth reading.
 */
function flatten(node: unknown, prefix = ''): Array<{ path: string; value: string }> {
  if (node === null || node === undefined) {
    return [{ path: prefix || '(root)', value: '(null)' }];
  }

  if (Array.isArray(node)) {
    return node.flatMap((entry, index) => flatten(entry, `${prefix}[${String(index)}]`));
  }

  if (typeof node === 'object') {
    const entries = Object.entries(node as Record<string, unknown>);
    if (entries.length === 0) return [{ path: prefix || '(root)', value: '(empty object)' }];
    return entries.flatMap(([key, value]) =>
      flatten(value, prefix === '' ? key : `${prefix}.${key}`),
    );
  }

  return [{ path: prefix || '(root)', value: String(node) }];
}

function check(description: string, passed: boolean): void {
  console.log(`  ${passed ? '[ok]  ' : '[FAIL]'} ${description}`);
  if (!passed) failures += 1;
}

function warn(condition: boolean, message: string): void {
  if (condition) console.log(`  [warn] ${message}`);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing ${name} in .env`);
  return value;
}
