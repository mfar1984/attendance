import { asArray, asBoolean, asNumber, asString, dig, requireString } from '../coerce.js';
import { newSearchId, type IsapiCore } from '../core.js';
import { isAlreadyExists } from '../parse.js';
import {
  DEVICE_LIMITS,
  type Person,
  type PersonCounts,
  type PersonSearchPage,
} from '../types.js';

export interface PersonDraft {
  employeeNo: string;
  name: string;
  userType?: 'normal' | 'visitor' | 'blackList';
  validFrom?: Date;
  validTo?: Date;
  /** Door PIN. Stored in cleartext on the device, so never reuse an app password. */
  password?: string;
  gender?: 'male' | 'female' | 'unknown';
  doorNo?: number;
  planTemplateNo?: string;
}

export class PersonsModule {
  constructor(private readonly core: IsapiCore) {}

  async counts(): Promise<PersonCounts> {
    const body = await this.core.get('/ISAPI/AccessControl/UserInfo/Count?format=json');
    const counts = dig(body, 'UserInfoCount');
    return {
      userNumber: asNumber(dig(counts, 'userNumber')) ?? 0,
      bindFaceUserNumber: asNumber(dig(counts, 'bindFaceUserNumber')) ?? 0,
      bindFingerprintUserNumber: asNumber(dig(counts, 'bindFingerprintUserNumber')) ?? 0,
      bindCardUserNumber: asNumber(dig(counts, 'bindCardUserNumber')) ?? 0,
    };
  }

  async page(searchId: string, position: number, filter?: PersonFilter): Promise<PersonSearchPage> {
    const condition: Record<string, unknown> = {
      searchID: searchId,
      searchResultPosition: position,
      maxResults: DEVICE_LIMITS.searchPageSize,
    };
    if (filter?.fuzzySearch) condition['fuzzySearch'] = filter.fuzzySearch;
    if (filter?.hasFace !== undefined) condition['hasFace'] = filter.hasFace;
    if (filter?.hasCard !== undefined) condition['hasCard'] = filter.hasCard;
    if (filter?.hasFingerprint !== undefined) condition['hasFingerprint'] = filter.hasFingerprint;

    const body = await this.core.post('/ISAPI/AccessControl/UserInfo/Search?format=json', {
      UserInfoSearchCond: condition,
    });
    const result = dig(body, 'UserInfoSearch');

    return {
      searchID: asString(dig(result, 'searchID')) ?? searchId,
      responseStatusStrg: asString(dig(result, 'responseStatusStrg')) ?? 'OK',
      numOfMatches: asNumber(dig(result, 'numOfMatches')) ?? 0,
      totalMatches: asNumber(dig(result, 'totalMatches')) ?? 0,
      persons: asArray(dig(result, 'UserInfo') as unknown[]).map(mapPerson),
    };
  }

  /** Walks the whole roster, 30 records per request. */
  async *iterate(filter?: PersonFilter): AsyncGenerator<Person> {
    const searchId = newSearchId('persons');
    let position = 0;

    for (;;) {
      const page = await this.page(searchId, position, filter);
      for (const person of page.persons) {
        yield person;
      }
      if (page.numOfMatches === 0) return;
      position += page.numOfMatches;
      if (page.responseStatusStrg.toUpperCase() !== 'MORE') return;
    }
  }

  async find(employeeNo: string): Promise<Person | null> {
    for await (const person of this.iterate({ fuzzySearch: employeeNo })) {
      if (person.employeeNo === employeeNo) return person;
    }
    return null;
  }

  async create(draft: PersonDraft): Promise<void> {
    assertDraft(draft);
    await this.core.post('/ISAPI/AccessControl/UserInfo/Record?format=json', {
      UserInfo: buildPayload(draft),
    });
  }

  async update(draft: PersonDraft): Promise<void> {
    assertDraft(draft);
    await this.core.put('/ISAPI/AccessControl/UserInfo/Modify?format=json', {
      UserInfo: buildPayload(draft),
    });
  }

  /**
   * Creates the person, falling back to a modify when the record already exists.
   *
   * The device reports `deviceUserAlreadyExist` for a duplicate `employeeNo`,
   * which is an expected outcome while re-syncing a roster and must not abort a
   * bulk operation.
   */
  async upsert(draft: PersonDraft): Promise<'created' | 'updated'> {
    try {
      await this.create(draft);
      return 'created';
    } catch (error) {
      if (!isAlreadyExists(error)) throw error;
      await this.update(draft);
      return 'updated';
    }
  }

  async remove(employeeNos: string[]): Promise<void> {
    if (employeeNos.length === 0) return;
    // The device caps a delete list at the same size as a search page.
    for (const batch of chunk(employeeNos, DEVICE_LIMITS.searchPageSize)) {
      await this.core.put('/ISAPI/AccessControl/UserInfo/Delete?format=json', {
        UserInfoDelCond: {
          EmployeeNoList: batch.map((employeeNo) => ({ employeeNo })),
        },
      });
    }
  }
}

export interface PersonFilter {
  fuzzySearch?: string;
  hasFace?: boolean;
  hasCard?: boolean;
  hasFingerprint?: boolean;
}

function assertDraft(draft: PersonDraft): void {
  const { employeeNoMaxLength, nameMaxLength, passwordLength } = DEVICE_LIMITS;

  if (draft.employeeNo.length === 0 || draft.employeeNo.length > employeeNoMaxLength) {
    throw new RangeError(
      `employeeNo must be 1-${employeeNoMaxLength} characters, received ${draft.employeeNo.length}`,
    );
  }
  if (draft.name.length > nameMaxLength) {
    throw new RangeError(
      `name must be at most ${nameMaxLength} characters, received ${draft.name.length}`,
    );
  }
  if (
    draft.password !== undefined &&
    (draft.password.length < passwordLength.min || draft.password.length > passwordLength.max)
  ) {
    throw new RangeError(
      `Door PIN must be ${passwordLength.min}-${passwordLength.max} digits, received ${draft.password.length}`,
    );
  }
}

function buildPayload(draft: PersonDraft): Record<string, unknown> {
  const doorNo = draft.doorNo ?? 1;
  const payload: Record<string, unknown> = {
    employeeNo: draft.employeeNo,
    name: draft.name,
    userType: draft.userType ?? 'normal',
    Valid: {
      enable: true,
      beginTime: formatDeviceTime(draft.validFrom ?? new Date()),
      // Firmware accepts validity up to 2037-12-31 and rejects anything later.
      endTime: formatDeviceTime(draft.validTo ?? new Date('2037-12-31T23:59:59')),
      timeType: 'local',
    },
    doorRight: String(doorNo),
    RightPlan: [{ doorNo, planTemplateNo: draft.planTemplateNo ?? '1' }],
  };
  if (draft.password !== undefined) payload['password'] = draft.password;
  if (draft.gender !== undefined) payload['gender'] = draft.gender;
  return payload;
}

function mapPerson(raw: unknown): Person {
  const person: Person = {
    employeeNo: requireString(dig(raw, 'employeeNo'), 'employeeNo'),
    name: asString(dig(raw, 'name')) ?? '',
    userType: asString(dig(raw, 'userType')) ?? 'normal',
    Valid: {
      enable: asBoolean(dig(raw, 'Valid', 'enable')) ?? false,
      beginTime: asString(dig(raw, 'Valid', 'beginTime')) ?? '',
      endTime: asString(dig(raw, 'Valid', 'endTime')) ?? '',
    },
  };

  const numOfCard = asNumber(dig(raw, 'numOfCard'));
  const numOfFP = asNumber(dig(raw, 'numOfFP'));
  const numOfFace = asNumber(dig(raw, 'numOfFace'));
  const faceUrl = asString(dig(raw, 'faceURL'));
  const gender = asString(dig(raw, 'gender'));
  const password = asString(dig(raw, 'password'));

  if (numOfCard !== undefined) person.numOfCard = numOfCard;
  if (numOfFP !== undefined) person.numOfFP = numOfFP;
  if (numOfFace !== undefined) person.numOfFace = numOfFace;
  if (faceUrl !== undefined) person.faceURL = faceUrl;
  if (gender !== undefined) person.gender = gender as Person['gender'];
  if (password !== undefined) person.password = password;

  return person;
}

/** `YYYY-MM-DDTHH:mm:ss`, no offset - the device interprets it as local time. */
function formatDeviceTime(when: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}` +
    `T${pad(when.getHours())}:${pad(when.getMinutes())}:${pad(when.getSeconds())}`
  );
}

function chunk<T>(items: T[], size: number): T[][] {
  const batches: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    batches.push(items.slice(index, index + size));
  }
  return batches;
}
