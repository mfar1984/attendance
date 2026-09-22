import { access, constants, mkdir, writeFile, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { LABELS, type LabelKey } from '@attendance/shared';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { invalidateApiSettings } from '../api/guard.js';
import { requirePermission } from '../auth/plugin.js';
import { db } from '../db.js';
import { releaseAllClients } from '../devices/registry.js';
import { loadEnv } from '../env.js';
import { unauthorized } from '../http.js';
import { invalidateLogPolicy, recordActivity } from '../logging/activity.js';
import { invalidateMaintenance, maintenanceState } from '../maintenance/mode.js';
import { invalidatePolicy } from '../security/policy.js';
import { listBackups, loadBackupPolicy } from './backup.js';
import { orphanedBrandingFiles } from './branding.js';

/**
 * Operational actions for the Maintenance tab.
 *
 * Three things live here: clearing the caches, trimming the activity log, and reporting
 * what the system currently thinks its own state is. None of them change configuration —
 * that goes through `/api/settings` — so they are actions rather than settings, and each
 * one is a permission of its own.
 */

/** How long the activity log is kept when nothing has been chosen. */
const DEFAULT_LOG_RETENTION_DAYS = 90;

export async function maintenanceRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  /**
   * Clears the in-memory caches.
   *
   * Worth being straight about what this achieves. The configuration caches hold values
   * for one to thirty seconds, so clearing them is close to waiting. The part that
   * actually does something is releasing the terminal clients: each holds an
   * authenticated session with a device, and a terminal that has been rebooted or had its
   * credentials changed keeps failing until that handshake is redone.
   *
   * Three caches are deliberately left alone. The public-API rate counters, because
   * clearing them would let a caller reset their own limit by asking an administrator to
   * press a button. The Digest nonce store, because emptying it reopens the replay window
   * on the ingest path. And the bulk-import job map, because an import in progress would
   * lose its position and resume from the beginning.
   */
  app.post(
    '/api/maintenance/cache',
    { preHandler: requirePermission('settings.maintenance', 'clearCache') },
    async (request) => {
      const body = z
        .object({ scope: z.enum(['config', 'devices', 'all']).default('all') })
        .parse(request.body ?? {});

      // Keys, not words: the response is read by a screen that resolves them per reader.
      // The activity-log detail below is a stored historical record, so that one is
      // written in the source wording through `LABELS`.
      const cleared: LabelKey[] = [];

      if (body.scope === 'config' || body.scope === 'all') {
        invalidateApiSettings();
        invalidatePolicy();
        invalidateMaintenance();
        invalidateLogPolicy();
        cleared.push(
          'maintenance.cache.item.apiConfig',
          'maintenance.cache.item.securityPolicy',
          'maintenance.cache.item.maintenanceMode',
          'maintenance.cache.item.logLevel',
        );
      }

      if (body.scope === 'devices' || body.scope === 'all') {
        await releaseAllClients();
        cleared.push('maintenance.cache.item.deviceClients');
      }

      await recordActivity({
        request,
        action: 'maintenance.cache_clear',
        category: 'system',
        detail: cleared.map((key) => LABELS[key]).join(', '),
      });

      return {
        cleared,
        noteKey: (body.scope === 'config'
          ? 'maintenance.cache.note.config'
          : 'maintenance.cache.note.devices') satisfies LabelKey,
      };
    },
  );

  /**
   * Trims the activity log.
   *
   * The audit log is not touched and that is the point of having two tables. The activity
   * log is a running commentary — every request, every API call — and it grows without
   * bound. The audit log is the record of what changed, and it is kept.
   */
  app.post(
    '/api/maintenance/trim-logs',
    { preHandler: requirePermission('settings.maintenance', 'purge') },
    async (request) => {
      if (!request.user) throw unauthorized();

      const days = await logRetentionDays();
      const cutoff = new Date(Date.now() - days * 86_400_000);

      const outcome = await db().activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });

      await recordActivity({
        request,
        action: 'maintenance.trim_logs',
        category: 'system',
        level: 'warn',
        detail: `${String(outcome.count)} entri sebelum ${cutoff.toISOString()} dibuang · simpanan ${String(days)} hari`,
      });

      return {
        deleted: outcome.count,
        cutoff: cutoff.toISOString(),
        retentionDays: days,
        noteKey: 'maintenance.retention.trim.note' satisfies LabelKey,
      };
    },
  );

  /**
   * What the system believes about itself.
   *
   * Each line is measured rather than assumed: the database is checked with a query, the
   * storage directory with a real write, the backup with the file's own timestamp. A
   * health panel that reports what the configuration says instead of what is true is a
   * panel that stays green through an outage.
   */
  app.get(
    '/api/maintenance/health',
    { preHandler: requirePermission('settings.maintenance', 'view') },
    async () => {
      const [database, storage, mode, backups, backupPolicy] = await Promise.all([
        checkDatabase(),
        checkStorage(resolve(process.cwd(), env.STORAGE_DIR)),
        maintenanceState(),
        listBackups().catch(() => []),
        loadBackupPolicy(),
      ]);

      const [emailProfiles, activityRows, auditRows, oldestActivity, orphans] = await Promise.all([
        db().emailProfile.count({ where: { active: true } }).catch(() => 0),
        db().activityLog.count().catch(() => 0),
        db().auditLog.count().catch(() => 0),
        db()
          .activityLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } })
          .catch(() => null),
        orphanedBrandingFiles().catch(() => 0),
      ]);

      const memory = process.memoryUsage();
      const newest = backups[0];

      return {
        database,
        storage,
        maintenanceMode: { active: mode.enabled, allowList: mode.allowIps.length > 0 },
        backup: {
          count: backups.length,
          lastAt: newest?.createdAt ?? null,
          lastBytes: newest?.bytes ?? null,
          scheduled: backupPolicy.enabled,
          // The figure that matters: a schedule switched on is not evidence it ran.
          staleDays:
            newest === undefined
              ? null
              : Math.floor((Date.now() - new Date(newest.createdAt).getTime()) / 86_400_000),
        },
        email: { activeProfiles: emailProfiles },
        logs: {
          activityRows,
          auditRows,
          oldestActivityAt: oldestActivity?.createdAt.toISOString() ?? null,
          retentionDays: await logRetentionDays(),
        },
        branding: { orphanedFiles: orphans },
        process: {
          heapUsedBytes: memory.heapUsed,
          heapTotalBytes: memory.heapTotal,
          rssBytes: memory.rss,
          uptimeSeconds: Math.floor(process.uptime()),
          nodeVersion: process.version,
        },
      };
    },
  );
}

export async function logRetentionDays(): Promise<number> {
  const row = await db()
    .setting.findUnique({ where: { key: 'logging.retentionDays' } })
    .catch(() => null);
  const value = Number(row?.value);
  return Number.isInteger(value) && value >= 7 ? value : DEFAULT_LOG_RETENTION_DAYS;
}

/**
 * Trims the activity log on a schedule.
 *
 * Called from the retention worker's tick rather than getting an interval of its own:
 * it is the same daily rhythm and one timer is easier to reason about than two that can
 * drift apart.
 */
export async function trimActivityLogIfDue(): Promise<number> {
  const days = await logRetentionDays();
  const cutoff = new Date(Date.now() - days * 86_400_000);

  const outcome = await db().activityLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return outcome.count;
}

async function checkDatabase(): Promise<{ ok: boolean; latencyMs: number | null; detail: string }> {
  const startedAt = Date.now();
  try {
    await db().$queryRaw`SELECT 1`;
    return { ok: true, latencyMs: Date.now() - startedAt, detail: 'Bersambung' };
  } catch (error) {
    return {
      ok: false,
      latencyMs: null,
      detail: error instanceof Error ? error.message.slice(0, 200) : 'Tidak dapat disambung',
    };
  }
}

/** Actually writes and removes a file, because a directory can exist and be read-only. */
async function checkStorage(directory: string): Promise<{ ok: boolean; path: string; detail: string }> {
  try {
    await mkdir(directory, { recursive: true });
    await access(directory, constants.W_OK);

    const probe = join(directory, '.write-probe');
    await writeFile(probe, 'ok');
    await unlink(probe);

    return { ok: true, path: directory, detail: 'Boleh ditulis' };
  } catch (error) {
    return {
      ok: false,
      path: directory,
      detail: error instanceof Error ? error.message.slice(0, 200) : 'Tidak boleh ditulis',
    };
  }
}
