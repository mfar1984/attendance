/**
 * Entry point for managed hosts that start the application themselves.
 *
 * cPanel's Node.js Selector runs Phusion Passenger, which executes one startup file from
 * the application root rather than an npm script. So `npm start` and its
 * `--env-file` flag never apply; `apps/server/src/bootstrap.ts` loads `.env` from inside
 * the process for exactly that reason.
 *
 * This file only redirects. Keeping the real entry at `apps/server/dist/main.js` means
 * there is one server and one startup path, whoever launched it — a second copy of the
 * boot sequence written for one host is a second thing to keep in step, and the one that
 * drifts is the one nobody runs locally.
 *
 * `import()` rather than `require()`: the root package has no `"type": "module"`, so this
 * file is CommonJS, while the compiled server is ESM. Dynamic import bridges the two
 * without committing the repository root to either.
 *
 * The failure is printed and rethrown. Passenger reports a startup crash as a bare 503
 * with the reason only in its own log, so a boot that fails on a missing `ENCRYPTION_KEY`
 * otherwise looks identical to one that fails on a missing database.
 */
import('./apps/server/dist/main.js').catch((error) => {
  console.error('Attendance server failed to start:', error);
  process.exit(1);
});
