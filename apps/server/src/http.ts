import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';

/** An error with an intended HTTP status and a message safe to show a user. */
export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const badRequest = (message: string, code?: string): HttpError =>
  new HttpError(400, message, code);
export const unauthorized = (message = 'Sesi tidak sah atau telah tamat'): HttpError =>
  new HttpError(401, message, 'unauthorized');
export const forbidden = (message = 'Tiada kebenaran untuk tindakan ini'): HttpError =>
  new HttpError(403, message, 'forbidden');
export const notFound = (message = 'Rekod tidak dijumpai'): HttpError =>
  new HttpError(404, message, 'not_found');
export const conflict = (message: string, code?: string): HttpError =>
  new HttpError(409, message, code);

/**
 * Validates a payload, converting failures into a 400 with per-field messages.
 *
 * Uses the same schemas as the web client so the two cannot drift apart and
 * start disagreeing about what is acceptable.
 */
export function parseBody<S extends z.ZodType>(schema: S, payload: unknown): z.infer<S> {
  const result = schema.safeParse(payload);
  if (result.success) return result.data;

  const fieldErrors = z.flattenError(result.error).fieldErrors as Record<
    string,
    string[] | undefined
  >;
  const parts = Object.entries(fieldErrors).map(
    ([field, messages]) => `${field}: ${messages?.[0] ?? 'tidak sah'}`,
  );

  /**
   * Root-level issues are named too, not collapsed into "data tidak sah".
   *
   * An unrecognised key sits at the root rather than on a field, so a strict schema used to
   * answer with a message that told the caller nothing about which key to drop. That
   * matters most where strictness is the point: the profile route is strict so an attempt
   * to write a payroll-owned field is refused visibly rather than silently stripped, and a
   * refusal that will not say which field defeats the purpose.
   */
  for (const issue of result.error.issues) {
    if (issue.path.length > 0) continue;
    parts.push(
      issue.code === 'unrecognized_keys'
        ? `kunci tidak dibenarkan: ${issue.keys.join(', ')}`
        : issue.message,
    );
  }

  throw badRequest(parts.length > 0 ? parts.join('; ') : 'Data yang dihantar tidak sah', 'validation');
}

/**
 * Turns a create schema into an update schema: every field optional, no defaults.
 *
 * `schema.partial()` on its own is not enough, and the difference is not cosmetic.
 * Zod's `.partial()` makes a key optional but leaves its `.default()` in place, so an
 * absent key still parses to the default. A `PATCH` carrying only a name therefore
 * arrives at the handler with every other field populated from the create defaults, and
 * the handler — which cannot tell a supplied value from a manufactured one — writes them
 * all. Renaming a terminal moved it to port 443; renaming a shift reactivated it.
 *
 * Unwrapping the default is what makes an absent key stay absent, which is the only way
 * "only update what was sent" can hold.
 */
export function forUpdate<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): z.ZodObject<{ [K in keyof Shape]: z.ZodOptional<Shape[K]> }> {
  const shape: Record<string, z.ZodTypeAny> = {};
  const source = schema.shape as unknown as Record<string, z.ZodTypeAny>;

  for (const key of Object.keys(source)) {
    const field = source[key];
    if (field !== undefined) shape[key] = stripDefault(field).optional();
  }

  return z.object(shape) as unknown as z.ZodObject<{
    [K in keyof Shape]: z.ZodOptional<Shape[K]>;
  }>;
}

/** Peels `.default()` wrappers, including one nested inside an `.optional()`. */
function stripDefault(field: z.ZodTypeAny): z.ZodTypeAny {
  let current = field;

  while (true) {
    if (current instanceof z.ZodDefault) {
      current = (current as unknown as { def: { innerType: z.ZodTypeAny } }).def.innerType;
      continue;
    }
    if (current instanceof z.ZodOptional) {
      const inner = (current as unknown as { def: { innerType: z.ZodTypeAny } }).def.innerType;
      if (inner instanceof z.ZodDefault) {
        current = inner;
        continue;
      }
    }
    return current;
  }
}

/** Best-effort client address, honouring a proxy header when present. */
export function clientIp(request: FastifyRequest): string | undefined {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim();
  }
  return request.ip;
}

export function userAgent(request: FastifyRequest): string | undefined {
  const value = request.headers['user-agent'];
  return typeof value === 'string' ? value.slice(0, 255) : undefined;
}

export function sendError(reply: FastifyReply, error: unknown): FastifyReply {
  if (error instanceof HttpError) {
    return reply.status(error.status).send({ error: error.message, code: error.code });
  }
  // Anything unrecognised is a bug; the detail belongs in the log, not the
  // response, so an internal message never reaches a browser.
  reply.log.error({ err: error }, 'Unhandled route error');
  return reply.status(500).send({ error: 'Ralat dalaman pelayan', code: 'internal' });
}
