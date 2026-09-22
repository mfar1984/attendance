/**
 * CSV writing, shared by every export in the application.
 *
 * Lifted out of `routes/reports.ts` when the payroll module needed to produce a file too. One
 * implementation on purpose: the BOM below is the difference between a Malay name surviving a
 * double-click in Excel and arriving as mojibake, and an export that quietly skipped it would
 * only be noticed by whoever opened the file.
 */

import type { FastifyReply } from 'fastify';

/** Minutes as decimal hours, which is what payroll systems consume. */
export function hours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

export function toCsvRow(values: string[]): string {
  return values
    .map((value) => (/[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value))
    .join(',');
}

/**
 * Sends CSV with a UTF-8 BOM.
 *
 * The BOM is what stops Excel mangling Malay names on open, the same reason the staff
 * import template carries one.
 *
 * Note for anybody writing a check against this: `Response.text()` strips the BOM while
 * decoding, so a test has to look at the bytes.
 */
export function sendCsv(reply: FastifyReply, name: string, content: string): FastifyReply {
  return reply
    .header('content-type', 'text/csv; charset=utf-8')
    .header('content-disposition', `attachment; filename="${name}.csv"`)
    .send(`\uFEFF${content}\r\n`);
}
