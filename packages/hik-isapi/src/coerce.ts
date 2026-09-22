/**
 * Value coercion helpers.
 *
 * The XML parser is configured to leave every value as a raw string so that
 * identifiers like `cardNo` are never silently converted to a lossy number.
 * JSON replies, by contrast, already carry real booleans and numbers. These
 * helpers accept either representation so callers do not have to branch on the
 * transport format.
 */

export function asString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }
  if (typeof value === 'number' || typeof value === 'bigint') return String(value);
  return undefined;
}

export function requireString(value: unknown, field: string): string {
  const result = asString(value);
  if (result === undefined) {
    throw new TypeError(`Expected a string for "${field}", received ${JSON.stringify(value)}`);
  }
  return result;
}

export function asNumber(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.length === 0) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

export function requireNumber(value: unknown, field: string): number {
  const result = asNumber(value);
  if (result === undefined) {
    throw new TypeError(`Expected a number for "${field}", received ${JSON.stringify(value)}`);
  }
  return result;
}

export function asBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (normalised === 'true' || normalised === '1' || normalised === 'yes') return true;
    if (normalised === 'false' || normalised === '0' || normalised === 'no') return false;
  }
  if (typeof value === 'number') return value !== 0;
  return undefined;
}

/**
 * Normalises a field that may arrive as a single object or an array.
 *
 * ISAPI omits array wrappers when a collection holds exactly one item, so a
 * caller reading `InfoList` gets an object for one event and an array for two.
 */
export function asArray<T>(value: T | T[] | undefined | null): T[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Walks a nested path, returning undefined instead of throwing on a gap. */
export function dig(source: unknown, ...path: string[]): unknown {
  let cursor: unknown = source;
  for (const key of path) {
    if (!isRecord(cursor)) return undefined;
    cursor = cursor[key];
  }
  return cursor;
}
