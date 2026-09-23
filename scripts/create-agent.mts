/**
 * Creates an on-site connector and prints the command that installs it.
 *
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/create-agent.mts "Hospital Sibu"
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/create-agent.mts --list
 *   node --env-file=.env node_modules/tsx/dist/cli.mjs scripts/create-agent.mts --reissue 3
 *
 * Exists so a connector can be installed and tested on real hardware before the screens are
 * built. Real terminals surface problems that no amount of local testing finds, and waiting for
 * a UI to start looking is a week spent not knowing.
 *
 * The enrolment token is printed once, here, and nowhere else. It is single-use and expires
 * within the hour: it travels through a shell command, and therefore through shell history on the
 * machine it is typed on, so it is deliberately worth nothing by tomorrow.
 */
import { AgentStatus } from '@attendance/shared';

import { db, disconnectDb } from '../apps/server/src/db.js';
import {
  ENROL_TOKEN_TTL_MS,
  issueAgentKey,
  issueEnrolToken,
  reissueEnrolToken,
} from '../apps/server/src/devices/agents.js';
import { cloudOrigin } from '../apps/server/src/devices/agent-admin.js';

const args = process.argv.slice(2);

/**
 * Where the connector will be told to report.
 *
 * Shares `cloudOrigin()` with the connector screen rather than deriving its own, because the two
 * printed the same command and only one of them was fixed when the source turned out to be wrong.
 *
 * This ran from a shell, so there is no request to observe — `PUBLIC_URL` is the only source, and
 * an absent or unroutable one yields the placeholder. That is deliberate: the previous version
 * read `INGEST_PUBLIC_URL`, which on a cloud install holds a local address, and printed
 * `curl -fsSL http://127.0.0.1:8080/install-agent.sh` — a command that looks complete and cannot
 * work. An obviously incomplete address gets questioned; a loopback one gets pasted.
 */
function cloudUrl(): string {
  return cloudOrigin();
}

function printInstaller(token: string): void {
  const ttlMinutes = Math.round(ENROL_TOKEN_TTL_MS / 60_000);

  console.log('');
  console.log('  Jalankan ini pada Raspberry Pi di tapak itu:');
  console.log('');
  console.log(`    curl -fsSL ${cloudUrl()}/install-agent.sh | sudo bash -s -- \\`);
  console.log(`      --cloud ${cloudUrl()} \\`);
  console.log(`      --token ${token}`);
  console.log('');
  console.log(`  Token ini sekali guna dan luput dalam ${String(ttlMinutes)} minit.`);
  console.log('  Ia tidak akan dipaparkan lagi. Jana yang baharu dengan --reissue kalau hilang.');
  console.log('');
}

try {
  if (args[0] === '--list') {
    const rows = await db().deviceAgent.findMany({
      orderBy: { id: 'asc' },
      include: { _count: { select: { devices: true } } },
    });

    if (rows.length === 0) {
      console.log('Tiada connector didaftarkan.');
    } else {
      console.log('');
      for (const row of rows) {
        const seen = row.lastSeenAt === null ? 'belum pernah' : row.lastSeenAt.toISOString();
        console.log(`  #${String(row.id)}  ${row.name}`);
        console.log(`      status      : ${row.status}`);
        console.log(`      peranti     : ${String(row._count.devices)}`);
        console.log(`      dilihat     : ${seen}`);
        console.log(`      alamat LAN  : ${row.lanHost ?? '-'}:${String(row.lanPort ?? '-')}`);
        console.log(`      versi       : ${row.version ?? '-'}`);
        console.log('');
      }
    }
  } else if (args[0] === '--reissue') {
    const id = Number(args[1]);
    if (!Number.isInteger(id) || id <= 0) {
      console.error('Guna: --reissue <id>. Lihat --list untuk id.');
      process.exit(1);
    }

    const existing = await db().deviceAgent.findUnique({ where: { id } });
    if (!existing) {
      console.error(`Connector #${String(id)} tidak dijumpai.`);
      process.exit(1);
    }

    const issued = await reissueEnrolToken(id);

    console.log('');
    console.log(`Token pendaftaran baharu untuk #${String(id)} "${existing.name}".`);
    /*
     * Stated because it is the difference between a site that keeps working during a reinstall
     * and one that goes quiet. The credential already on the Pi stays valid until the new install
     * enrols, so attendance keeps flowing while somebody drives to the site.
     */
    console.log('Connector yang sudah dipasang terus berfungsi sampai yang baharu mendaftar.');
    printInstaller(issued.token);
  } else {
    const name = args[0]?.trim();
    if (!name) {
      console.error('Guna: create-agent.mts "<nama tapak>"  |  --list  |  --reissue <id>');
      process.exit(1);
    }

    const clash = await db().deviceAgent.findFirst({ where: { name } });
    if (clash) {
      /*
       * Refused rather than allowed with a suffix. Two connectors whose names differ only by a
       * number is how a device ends up assigned to the wrong site, and that is not visible on any
       * screen afterwards.
       */
      console.error(
        `Sudah ada connector bernama "${name}" (#${String(clash.id)}). Guna ` +
          `--reissue ${String(clash.id)} untuk memasang semula, atau pilih nama lain.`,
      );
      process.exit(1);
    }

    const token = issueEnrolToken();
    const created = await db().deviceAgent.create({
      data: {
        name,
        agentKey: issueAgentKey(),
        enrolTokenHash: token.tokenHash,
        enrolExpiresAt: token.expiresAt,
      },
    });

    console.log('');
    console.log(`Connector #${String(created.id)} "${created.name}" dicipta.`);
    console.log(`  agentKey : ${created.agentKey}`);
    console.log(`  status   : ${created.status} (menjadi ${AgentStatus.active} selepas mendaftar)`);
    printInstaller(token.token);
    console.log('  Selepas ia mendaftar, tambah peranti dan pilih connector ini padanya.');
    console.log('');
  }
} finally {
  await disconnectDb();
}
