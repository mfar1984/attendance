/**
 * Reproduces the authentication failure seen from the sync worker.
 *
 * curl authenticates against the same terminal without trouble, so the fault is
 * in our client rather than the device or the credentials. This exercises the
 * two conditions the worker meets that a single curl call does not: a long run of
 * sequential requests on one cached challenge, and overlapping requests sharing
 * one client.
 */
import { HikvisionClient } from '@attendance/hik-isapi';

process.loadEnvFile('.env');

const options = {
  baseUrl: process.env['HIK_HOST'] as string,
  username: process.env['HIK_USERNAME'] as string,
  password: process.env['HIK_PASSWORD'] as string,
  verifyTls: false,
};

console.log('--- 1. Sequential requests on one client ---');
{
  const client = new HikvisionClient(options);
  let ok = 0;
  try {
    for (let index = 0; index < 12; index += 1) {
      await client.system.deviceInfo();
      ok += 1;
    }
    console.log(`  ${ok}/12 sequential requests succeeded`);
  } catch (error) {
    console.log(`  FAILED after ${ok} requests: ${message(error)}`);
  }
  await client.close();
}

console.log('\n--- 2. Concurrent requests on one client ---');
{
  const client = new HikvisionClient(options);
  const results = await Promise.allSettled([
    client.system.deviceInfo(),
    client.system.time(),
    client.persons.counts(),
    client.faces.libraries(),
    client.system.attendanceMode(),
  ]);
  const failed = results.filter((result) => result.status === 'rejected');
  console.log(`  ${results.length - failed.length}/${results.length} concurrent requests succeeded`);
  for (const result of failed) {
    if (result.status === 'rejected') console.log(`  rejected: ${message(result.reason)}`);
  }
  await client.close();
}

console.log('\n--- 3. Full event pull, the operation the worker performs ---');
{
  const client = new HikvisionClient(options);
  try {
    const events = await client.events.since(0);
    console.log(`  pulled ${events.length} events across multiple pages`);
  } catch (error) {
    console.log(`  FAILED: ${message(error)}`);
  }
  await client.close();
}

function message(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
