import type { FastifyInstance } from 'fastify';

import { requireAuth } from '../auth/plugin.js';
import { can } from '../auth/service.js';
import { db, jsonSafe } from '../db.js';
import { loadEnv } from '../env.js';
import { unauthorized } from '../http.js';

/**
 * What currently needs somebody's attention.
 *
 * There is no notification table and this does not pretend to be an inbox. Nothing here is
 * marked as read, because nothing here is a message — each item is a live count of a
 * condition that is either true right now or is not. An unread flag would let somebody
 * dismiss an offline terminal and have the badge go quiet while the terminal stayed
 * offline, which is worse than no badge.
 *
 * Filtered by permission, so the bell never counts something the person cannot open. A
 * badge that leads to a 403 teaches people to ignore the badge.
 */

export type AlertTone = 'danger' | 'warn' | 'info';

export interface Alert {
  id: string;
  tone: AlertTone;
  title: string;
  detail: string;
  count: number;
  /** Where the badge takes you. Always a screen the caller may open. */
  to: string;
}

export async function alertRoutes(app: FastifyInstance): Promise<void> {
  const env = loadEnv();

  app.get('/api/alerts', { preHandler: requireAuth }, async (request) => {
    if (!request.user) throw unauthorized();
    const user = request.user;

    const alerts: Alert[] = [];
    const prisma = db();

    if (can(user, 'settings.devices', 'view')) {
      const devices = await prisma.device.findMany({
        select: { name: true, status: true, clockDriftS: true, clockMode: true },
      });

      const offline = devices.filter((device) => device.status === 'offline');
      if (offline.length > 0) {
        alerts.push({
          id: 'device.offline',
          tone: 'danger',
          title: offline.length === 1 ? 'Satu terminal offline' : `${String(offline.length)} terminal offline`,
          // Said in terms of the consequence, not the status. "Offline" is a state; losing
          // scans is what the person reading this needs to act on.
          detail: `Scan semasa tidak diterima sehingga sambungan kembali: ${offline
            .map((device) => device.name)
            .join(', ')}`,
          count: offline.length,
          to: '/tetapan/peranti',
        });
      }

      const drifting = devices.filter(
        (device) =>
          device.clockDriftS !== null && Math.abs(device.clockDriftS) > env.CLOCK_DRIFT_WARN_SECONDS,
      );
      if (drifting.length > 0) {
        alerts.push({
          id: 'device.drift',
          tone: 'danger',
          title:
            drifting.length === 1 ? 'Jam terminal tersasar' : `${String(drifting.length)} jam terminal tersasar`,
          /**
           * The one fault that corrupts every record while producing no error anywhere.
           * The terminal keeps working, scans keep arriving, and the timestamps are simply
           * wrong — so it is stated first and in full.
           */
          detail:
            'Rekod yang dibuat sekarang mewarisi kesilapan ini. ' +
            drifting
              .map((device) => `${device.name} (${String(device.clockDriftS)}s${device.clockMode === 'manual' ? ', manual' : ''})`)
              .join(', '),
          count: drifting.length,
          to: '/tetapan/peranti',
        });
      }
    }

    if (can(user, 'attendance.exceptions', 'view')) {
      const unresolved = await prisma.attendanceException.count({ where: { resolvedAt: null } });
      if (unresolved > 0) {
        alerts.push({
          id: 'attendance.exceptions',
          tone: 'warn',
          title: `${String(unresolved)} pengecualian belum selesai`,
          detail: 'Hari yang enjin tidak dapat selesaikan. Setiap satu adalah gaji yang belum boleh dikira.',
          count: unresolved,
          to: '/kehadiran/pengecualian',
        });
      }
    }

    if (can(user, 'schedule.leave', 'view')) {
      const pending = await prisma.leaveRequest.count({ where: { status: 'pending' } });
      if (pending > 0) {
        alerts.push({
          id: 'leave.pending',
          tone: 'warn',
          title: `${String(pending)} permohonan cuti menunggu`,
          detail: 'Cuti yang belum diluluskan tidak ditulis ke roster, jadi hari itu masih dikira sebagai kerja.',
          count: pending,
          to: '/jadual/permohonan',
        });
      }
    }

    if (can(user, 'staff.biometrics', 'view')) {
      const missing = await prisma.staff.count({
        where: { active: true, numOfFace: 0, numOfFp: 0, numOfCard: 0 },
      });
      if (missing > 0) {
        alerts.push({
          id: 'staff.biometrics',
          tone: 'info',
          title: `${String(missing)} staf tanpa kredensial`,
          detail: 'Ada dalam sistem tetapi tidak boleh scan pada mana-mana terminal.',
          count: missing,
          to: '/staf/biometrik',
        });
      }
    }

    if (can(user, 'settings.backup', 'view')) {
      const { listBackups } = await import('./backup.js');
      const files = await listBackups().catch(() => []);
      const newest = files[0];
      const ageDays =
        newest === undefined
          ? null
          : Math.floor((Date.now() - new Date(newest.createdAt).getTime()) / 86_400_000);

      if (newest === undefined) {
        alerts.push({
          id: 'backup.missing',
          tone: 'danger',
          title: 'Tiada backup',
          detail:
            'Pangkalan data ini satu-satunya tempat sejarah kehadiran wujud, dan ia yang mengira gaji.',
          count: 1,
          to: '/tetapan/umum',
        });
      } else if (ageDays !== null && ageDays > 7) {
        alerts.push({
          id: 'backup.stale',
          tone: 'warn',
          title: `Backup berumur ${String(ageDays)} hari`,
          detail: 'Kalau pangkalan data hilang hari ini, itulah jumlah kerja yang hilang bersamanya.',
          count: 1,
          to: '/tetapan/umum',
        });
      }
    }

    return jsonSafe({
      alerts,
      // Counted as conditions, not as rows: five offline terminals is one thing to go and
      // deal with, and a badge reading "47" for the same fault is a badge people stop
      // reading.
      total: alerts.length,
      worst: alerts.some((alert) => alert.tone === 'danger')
        ? 'danger'
        : alerts.some((alert) => alert.tone === 'warn')
          ? 'warn'
          : alerts.length > 0
            ? 'info'
            : null,
      generatedAt: new Date().toISOString(),
    });
  });
}
