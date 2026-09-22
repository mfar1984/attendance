import { randomUUID } from 'node:crypto';

import { DigestHttpClient, type DigestHttpOptions } from './digest.js';
import { assertOk, decodeBody } from './parse.js';

export interface MultipartPart {
  name: string;
  contentType: string;
  data: Buffer | string;
}

/**
 * Request/response plumbing shared by every ISAPI module.
 *
 * Responsibilities stop at transport and envelope checking; payload shaping
 * lives in the individual modules.
 */
export class IsapiCore {
  private readonly http: DigestHttpClient;

  constructor(options: DigestHttpOptions) {
    this.http = new DigestHttpClient(options);
  }

  get host(): string {
    return this.http.host;
  }

  async close(): Promise<void> {
    await this.http.close();
  }

  async get(path: string): Promise<unknown> {
    const response = await this.http.request({ method: 'GET', path });
    const body = decodeBody(response, path, this.host);
    assertOk(body, path, this.host, response.status);
    return body;
  }

  /** Fetches a binary resource such as an event snapshot or enrolled face. */
  async getBinary(path: string): Promise<Buffer> {
    const response = await this.http.request({ method: 'GET', path });
    if (response.status >= 400) {
      // Error replies are textual even on binary endpoints, so decode to
      // surface the device's reason rather than returning a broken buffer.
      const body = decodeBody(response, path, this.host);
      assertOk(body, path, this.host, response.status);
    }
    return response.body;
  }

  async sendJson(method: 'POST' | 'PUT', path: string, payload: unknown): Promise<unknown> {
    const serialised = JSON.stringify(payload);
    const response = await this.http.request({
      method,
      path,
      headers: {
        'content-type': 'application/json',
        'content-length': String(Buffer.byteLength(serialised)),
      },
      body: serialised,
    });
    const body = decodeBody(response, path, this.host);
    assertOk(body, path, this.host, response.status);
    return body;
  }

  post(path: string, payload: unknown): Promise<unknown> {
    return this.sendJson('POST', path, payload);
  }

  put(path: string, payload: unknown): Promise<unknown> {
    return this.sendJson('PUT', path, payload);
  }

  async putXml(path: string, xml: string): Promise<unknown> {
    const response = await this.http.request({
      method: 'PUT',
      path,
      headers: {
        'content-type': 'application/xml',
        'content-length': String(Buffer.byteLength(xml)),
      },
      body: xml,
    });
    const body = decodeBody(response, path, this.host);
    assertOk(body, path, this.host, response.status);
    return body;
  }

  /**
   * Sends a multipart body with the part order preserved exactly as given.
   *
   * Order is significant on this firmware: face enrolment fails if the JSON
   * metadata part does not precede the image part. Each part also carries an
   * explicit Content-Length, which the device expects.
   */
  async postMultipart(path: string, parts: MultipartPart[]): Promise<unknown> {
    const boundary = `----hik${randomUUID().replace(/-/g, '')}`;
    const CRLF = '\r\n';
    const chunks: Buffer[] = [];

    for (const part of parts) {
      const data = Buffer.isBuffer(part.data) ? part.data : Buffer.from(part.data, 'utf8');
      const header =
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="${part.name}";${CRLF}` +
        `Content-Type: ${part.contentType}${CRLF}` +
        `Content-Length: ${data.length}${CRLF}${CRLF}`;
      chunks.push(Buffer.from(header, 'utf8'), data, Buffer.from(CRLF, 'utf8'));
    }
    chunks.push(Buffer.from(`--${boundary}--${CRLF}`, 'utf8'));

    const body = Buffer.concat(chunks);
    const response = await this.http.request({
      method: 'POST',
      path,
      headers: {
        'content-type': `multipart/form-data; boundary=${boundary}`,
        'content-length': String(body.length),
      },
      body,
    });
    const decoded = decodeBody(response, path, this.host);
    assertOk(decoded, path, this.host, response.status);
    return decoded;
  }
}

/** Search IDs must stay stable across pages of one logical search. */
export function newSearchId(prefix: string): string {
  // The device caps searchID at 64 characters.
  return `${prefix}-${randomUUID()}`.slice(0, 64);
}
