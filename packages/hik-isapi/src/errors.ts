/**
 * Error types for ISAPI communication.
 *
 * The distinction between these matters operationally: `DeviceLockedError`
 * must never be retried (retrying extends the lockout), while
 * `DeviceUnreachableError` is the one case where a backoff retry is correct.
 */

export class IsapiError extends Error {
  constructor(
    message: string,
    readonly host: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

/** Network-level failure: timeout, DNS, refused connection, TLS handshake. */
export class DeviceUnreachableError extends IsapiError {
  constructor(host: string, cause: unknown) {
    super(`Device ${host} unreachable: ${describeCause(cause)}`, host);
    this.cause = cause;
  }
}

/**
 * Credentials rejected. Hikvision firmware locks the account after roughly
 * five consecutive failures, so callers must surface this to an operator
 * rather than retrying in a loop.
 */
export class AuthenticationError extends IsapiError {
  constructor(host: string, username: string) {
    super(`Authentication rejected by ${host} for user "${username}"`, host);
  }
}

/**
 * The device answered 401 but offered no Digest challenge.
 *
 * Distinct from `AuthenticationError` because the credentials are not
 * necessarily wrong: this firmware also answers this way when it is out of
 * session slots or shedding load. Treating it as a bad password sends an
 * operator hunting for a credential problem that does not exist, and encourages
 * a retry loop that ends in a real lockout.
 */
export class AuthChallengeMissingError extends IsapiError {
  constructor(host: string, httpStatus: number) {
    super(
      `Device ${host} rejected the request with ${httpStatus} and no Digest challenge. ` +
        'Usually a transient session or connection limit rather than wrong credentials.',
      host,
    );
  }
}

/**
 * The device has temporarily locked the account after repeated failed logins.
 * Retrying before `unlockInSeconds` elapses keeps the lock alive.
 */
export class DeviceLockedError extends IsapiError {
  constructor(
    host: string,
    readonly unlockInSeconds: number | null,
  ) {
    super(
      unlockInSeconds === null
        ? `Device ${host} has locked this account after repeated failed logins`
        : `Device ${host} has locked this account; retry in ${unlockInSeconds}s`,
      host,
    );
  }
}

/**
 * The device answered, but rejected the operation. `subStatusCode` is the
 * field worth branching on - for example `deviceUserAlreadyExist` during an
 * upsert is an expected, ignorable outcome.
 */
export class IsapiStatusError extends IsapiError {
  constructor(
    host: string,
    readonly requestPath: string,
    readonly statusCode: number,
    readonly statusString: string,
    readonly subStatusCode: string | null,
    readonly errorMsg: string | null,
  ) {
    super(
      `${requestPath} failed on ${host}: ${statusString}` +
        (subStatusCode ? ` (${subStatusCode})` : ''),
      host,
    );
  }
}

/** The response body could not be parsed as either JSON or ISAPI XML. */
export class ResponseParseError extends IsapiError {
  constructor(
    host: string,
    readonly requestPath: string,
    readonly bodyPreview: string,
  ) {
    super(
      `Could not parse response from ${host}${requestPath}: ${bodyPreview}`,
      host,
    );
  }
}

function describeCause(cause: unknown): string {
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    return code ? `${code} ${cause.message}` : cause.message;
  }
  return String(cause);
}
