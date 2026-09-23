import { connect } from 'node:net';

import { logger } from './logging.js';

/**
 * The address this machine is reachable on from its own LAN.
 *
 * ## Why this is detected rather than configured
 *
 * The installer writes `LAN_HOST` once, and that value is what gets typed into every terminal's
 * push configuration and shown on the devices screen. On a machine with a DHCP lease the address
 * changes, and then three things are wrong at once: the terminals push to an address nobody
 * answers, the screen reports the old one, and the reconcile pull keeps working — so attendance
 * still arrives, just late, with nothing anywhere saying why.
 *
 * Detecting it each heartbeat does not fix the terminals, which still hold the old address. What it
 * fixes is the *reporting*: the screen shows where this connector actually is, so the mismatch is
 * visible instead of being a stale value repeated confidently.
 *
 * A DHCP reservation is still the right answer. This makes its absence diagnosable.
 *
 * ## Why the route to the cloud, and not `os.networkInterfaces()`
 *
 * A machine with several interfaces — a second NIC, a VPN, WiFi alongside Ethernet — has several
 * non-internal addresses and nothing in that list says which one the terminals can reach. Opening a
 * socket towards the cloud and reading the local end asks the kernel's routing table the same
 * question the installer's `ip route get` asks, at runtime.
 *
 * It is the route to the *cloud*, which is an assumption worth naming: on the single-NIC machine
 * this runs on, that is also the route the terminals arrive by. On a machine where those genuinely
 * differ, `LAN_HOST` is the override and takes precedence.
 */
export async function detectLanHost(cloudUrl: string, timeoutMs = 2000): Promise<string | null> {
  let url: URL;
  try {
    url = new URL(cloudUrl);
  } catch {
    return null;
  }

  const port = url.port === '' ? (url.protocol === 'https:' ? 443 : 80) : Number(url.port);

  return new Promise((resolve) => {
    /*
     * Nothing is sent and nothing is read. The local address is known once the kernel has chosen a
     * route and completed the handshake, so the socket is closed immediately — this is a routing
     * question, not a health check, and the heartbeat already answers whether the cloud is up.
     */
    const socket = connect({ host: url.hostname, port, timeout: timeoutMs });

    const finish = (value: string | null): void => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };

    socket.once('connect', () => {
      const local = socket.localAddress;
      finish(local === undefined || local.length === 0 ? null : local.replace(/^::ffff:/, ''));
    });

    // Both are ordinary outcomes rather than faults: the cloud being unreachable is what the
    // heartbeat reports, and it should not also produce a log line from here every minute.
    socket.once('timeout', () => finish(null));
    socket.once('error', () => finish(null));
  });
}

/**
 * The address to report, preferring an explicit setting over detection.
 *
 * An operator who typed an address meant it — a machine behind NAT on its own LAN, or one where the
 * route to the cloud and the route from the terminals genuinely differ. Detection is what happens
 * when nobody has said.
 */
export async function resolveLanHost(
  configured: string | null,
  cloudUrl: string,
): Promise<string | null> {
  if (configured !== null && configured.length > 0) return configured;

  const detected = await detectLanHost(cloudUrl);
  if (detected === null) {
    logger().warn(
      'Could not determine which address this machine is reachable on. The devices screen will ' +
        'not be able to show where to point the terminals; set LAN_HOST to fix it.',
    );
  }
  return detected;
}
