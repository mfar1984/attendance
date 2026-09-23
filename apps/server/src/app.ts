import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';

import { AGENT_PATH, agentRoutes } from './agent/routes.js';
import { agentAdminRoutes } from './devices/agent-admin.js';
import { alertRoutes } from './routes/alerts.js';
import { authRoutes } from './auth/routes.js';
import { registerAuthHooks } from './auth/plugin.js';
import { deviceRoutes } from './devices/routes.js';
import { deviceTerminalRoutes } from './devices/terminal.js';
import { loadEnv } from './env.js';
import { HttpError, sendError } from './http.js';
import { identityRoutes } from './identity/routes.js';
import { ICLOCK_PATH, iclockRoutes } from './ingest/iclock.js';
import { ingestRoutes, INGEST_PATH } from './ingest/routes.js';
import { loggerOptions } from './logger.js';
import { registerMaintenanceHook } from './maintenance/mode.js';
import { backupRoutes } from './routes/backup.js';
import { brandingRoutes } from './routes/branding.js';
import { maintenanceRoutes } from './routes/maintenance.js';
import { profileRoutes } from './routes/profile.js';
import { translationRoutes } from './routes/translations.js';
import { dashboardRoutes } from './routes/dashboard.js';
import { operationsRoutes } from './routes/operations.js';
import { orgRoutes } from './routes/org.js';
import { publicApiRoutes } from './api/public.js';
import { apiAdminRoutes } from './routes/api-admin.js';
import { channelRoutes } from './routes/channels.js';
import { emailProfileRoutes } from './routes/email-profiles.js';
import {
  expenseReceiptRoutes,
  hrReceiptRoutes,
  leaveDocumentRoutes,
} from './routes/hr-receipts.js';
import { claimRoutes, expenseRoutes } from './routes/claims.js';
import { hrSettingsRoutes } from './routes/hr-settings.js';
import { justificationRoutes } from './routes/justifications.js';
import { kpiRoutes } from './routes/kpi.js';
import { payrollRoutes } from './routes/payroll.js';
import { recruitmentRoutes } from './routes/recruitment.js';
import { leaveRoutes } from './routes/leave.js';
import { overtimeRoutes } from './routes/overtime.js';
import { reportsRoutes } from './routes/reports.js';
import { scheduleRoutes } from './routes/schedule.js';
import { selfRoutes } from './routes/self.js';
import { settingsRoutes } from './routes/settings.js';
import { streamRoutes } from './routes/stream.js';
import { staffRoutes } from './staff/routes.js';

/**
 * Liveness probe. Named rather than inlined so the rate limiter and the route cannot disagree
 * about the path — which is how the exemption came to be documented but absent.
 */
const HEALTH_PATH = '/api/health';

export async function buildApp(): Promise<FastifyInstance> {
  const env = loadEnv();

  const app = Fastify({
    logger: loggerOptions(),
    // Terminals identify themselves by MAC in the body; trusting the proxy header
    // only matters for operator requests behind a reverse proxy.
    trustProxy: env.NODE_ENV === 'production',
    bodyLimit: 2 * 1024 * 1024,
  });

  await app.register(helmet, {
    // The UI is served from the same origin and loads no third-party assets, so
    // a strict default-src costs nothing and closes off injected remote scripts.
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'blob:'],
        styleSrc: ["'self'", "'unsafe-inline'"],
        scriptSrc: ["'self'"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    // Disabled because the LAN deployment is reached over plain HTTP on an
    // internal address, where HSTS would pin browsers to a scheme the server
    // does not answer on.
    hsts: env.NODE_ENV === 'production',
  });

  await app.register(cookie, { secret: env.SESSION_SECRET });

  await app.register(rateLimit, {
    max: 300,
    timeWindow: '1 minute',
    // Terminals push one request per scan plus a heartbeat every 30 seconds. A
    // busy morning across several doors would otherwise trip the limiter and
    // silently drop attendance.
    //
    // A callback terminal is heavier still: it polls for queued work on a timer whether or not
    // anybody scans, so three sites of them would burn the global allowance on liveness traffic
    // alone and the limiter would start refusing real attendance.
    //
    // A connector is the same argument one level up: it heartbeats and asks for commands on a
    // timer for a whole site, so fifteen terminals' worth of liveness arrives as one caller's
    // traffic. It carries its own credential and is scoped to its own devices, which is the
    // control here — the limiter was never what stopped an unauthorised site.
    //
    // `/api/health` is exempt because a monitoring probe hitting it every few seconds would
    // otherwise spend the shared per-address allowance that real requests need. This was
    // documented as already true and was not; the deployment steering described this line
    // rather than the line that existed.
    allowList: (request) =>
      request.url.startsWith(INGEST_PATH) ||
      request.url.startsWith(ICLOCK_PATH) ||
      request.url.startsWith(AGENT_PATH) ||
      request.url.startsWith(HEALTH_PATH),
  });

  registerAuthHooks(app);

  // After the auth hooks, so the maintenance check can exempt an allowed address and
  // still let the settings route through — that route is how the mode gets switched off.
  registerMaintenanceHook(app);

  app.setErrorHandler((error: FastifyError, _request, reply) => {
    if (error instanceof HttpError) return sendError(reply, error);
    // Fastify's own 4xx (rate limit, malformed body) already carry a safe
    // message; anything 500 and above is routed through sendError so the detail
    // stays in the log rather than reaching the browser.
    if (error.statusCode !== undefined && error.statusCode < 500) {
      return reply.status(error.statusCode).send({ error: error.message });
    }
    return sendError(reply, error);
  });

  app.get(HEALTH_PATH, async () => ({
    ok: true,
    mode: env.CONNECTOR_MODE,
    time: new Date().toISOString(),
  }));

  await app.register(authRoutes);
  await app.register(deviceRoutes);
  await app.register(deviceTerminalRoutes);
  await app.register(dashboardRoutes);
  await app.register(operationsRoutes);
  await app.register(orgRoutes);
  await app.register(scheduleRoutes);
  await app.register(leaveRoutes);
  await app.register(overtimeRoutes);
  await app.register(claimRoutes);
  await app.register(expenseRoutes);
  await app.register(recruitmentRoutes);
  await app.register(kpiRoutes);
  await app.register(justificationRoutes);
  // Reached with a session and no screen permission: the subject is the caller. Same rule as
  // profileRoutes, and this plus that is the whole surface an Android client needs.
  await app.register(selfRoutes);
  await app.register(payrollRoutes);
  await app.register(hrSettingsRoutes);
  await app.register(reportsRoutes);
  await app.register(emailProfileRoutes);
  await app.register(channelRoutes);
  await app.register(apiAdminRoutes);
  // Its own guard rather than the session hooks: these are reached with a token, by
  // callers who have no session and must never be handed one.
  await app.register(publicApiRoutes);
  // Same reasoning again, one topology further out: a connector authenticates with its own
  // credential, is scoped to its own terminals, and must never be handed a session.
  await app.register(agentRoutes);
  // The operator side of the same feature, and an ordinary session route: whoever may add a
  // terminal may add the machine that reaches it.
  await app.register(agentAdminRoutes);
  await app.register(settingsRoutes);
  await app.register(backupRoutes);
  await app.register(maintenanceRoutes);
  await app.register(alertRoutes);
  await app.register(translationRoutes);

  /**
   * Multipart is registered in a scope of its own, holding only the branding upload.
   *
   * It installs a parser for `multipart/form-data`, and the ingest route installs its own
   * raw parser for the same type — the terminal attaches snapshots that way and the
   * firmware's content-type handling cannot be relied on. Two parsers for one type is a
   * boot failure, so this one is encapsulated where the ingest route cannot see it.
   *
   * The limit is repeated inside the route: this one is the transport ceiling, and the
   * route needs to answer with a sentence rather than a bare 413.
   */
  await app.register(async (scope) => {
    /*
     * The transport ceiling is the largest any route in this scope allows, which is the claim
     * receipt at 4 MB. Each route re-checks its own smaller limit so it can answer with a
     * sentence rather than a bare 413 — a logo refused at 1 MB should say so.
     */
    await scope.register(multipart, { limits: { fileSize: 4 * 1024 * 1024, files: 1, fields: 4 } });
    await scope.register(brandingRoutes);
    // Shares the scope because it shares the reason: an avatar upload is multipart too.
    await scope.register(profileRoutes);
    // And claim and expense receipts, which are scanned documents rather than images.
    await scope.register(hrReceiptRoutes);
    await scope.register(expenseReceiptRoutes);
    // And leave supporting documents — a medical certificate arrives the same way a receipt does.
    await scope.register(leaveDocumentRoutes);
  });
  await app.register(streamRoutes);
  await app.register(staffRoutes);
  await app.register(identityRoutes);
  await app.register(ingestRoutes);
  /**
   * Registered as its own plugin, which gives it an encapsulated content-type parser.
   *
   * It needs `text/plain` and so does the Hikvision ingest route, and two parsers claiming one
   * content type on the same scope is a boot failure rather than a runtime one.
   */
  await app.register(iclockRoutes);

  // Serving the built bundle from the same process keeps the LAN deployment to a
  // single thing that can fail, and keeps session cookies same-origin.
  if (env.WEB_DIST_DIR) {
    const { default: fastifyStatic } = await import('@fastify/static');
    await app.register(fastifyStatic, { root: env.WEB_DIST_DIR, wildcard: false });
    app.setNotFoundHandler(async (request, reply) => {
      if (
        request.url.startsWith('/api') ||
        request.url.startsWith(INGEST_PATH) ||
        request.url.startsWith(ICLOCK_PATH) ||
        // Without this, a connector that called a path with a typo would receive the web
        // bundle with a 200, and `response.ok` on its side would read that as success.
        request.url.startsWith(AGENT_PATH)
      ) {
        return reply.status(404).send({ error: 'Not found' });
      }
      return reply.sendFile('index.html');
    });
  }

  return app;
}
