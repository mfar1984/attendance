#!/usr/bin/env bash
#
# Installs the on-site connector.
#
#   curl -fsSL https://<cloud>/install-agent.sh | sudo bash -s -- \
#     --cloud https://<cloud> \
#     --token hken_...
#
# Served from your own installation over TLS, and it only ever contacts that same host.
#
# What it does, in order: check the machine can run this at all, create a system user with no
# login, fetch and build the connector, write configuration readable only by root, install a
# systemd unit, start it, and then verify the connector actually enrolled before reporting
# success. The last step matters: a unit that starts and immediately fails still returns zero
# from `systemctl start`, so an installer that stopped there would report success on a site that
# records nothing.
#
# Re-running is safe. It updates the checkout, rebuilds, and restarts.

set -euo pipefail

CLOUD=""
TOKEN=""
BRANCH="main"
INSTALL_DIR="/opt/attendance"
STATE_DIR="/var/lib/attendance-agent"
CONFIG_DIR="/etc/attendance-agent"
SERVICE_USER="attendance-agent"
LISTEN_PORT="8080"
LAN_HOST=""
INGEST_USERNAME="hikpush"
INGEST_PASSWORD=""
REPO="https://github.com/mfar1984/attendance.git"

die() { printf '\n[gagal] %s\n\n' "$*" >&2; exit 1; }
note() { printf '  %s\n' "$*"; }
step() { printf '\n==> %s\n' "$*"; }

usage() {
  cat <<'EOF'
Guna:
  install-agent.sh --cloud <url> --token <hken_...> [pilihan]

Pilihan:
  --cloud <url>              Alamat pemasangan cloud. Wajib HTTPS kecuali alamat peribadi.
  --token <hken_...>         Token pendaftaran sekali guna dari skrin peranti.
  --lan-host <ip>            Alamat LAN yang terminal akan tuju. Dikesan automatik kalau kosong.
  --port <port>              Port pendengar pada Pi ini. Lalai 8080.
  --ingest-password <kata>   Kata laluan Digest yang terminal guna. Dijana kalau kosong.
  --ingest-username <nama>   Lalai hikpush.
  --branch <cawangan>        Cawangan git. Lalai main.
  --dir <laluan>             Lokasi klon. Lalai /opt/attendance.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --cloud) CLOUD="${2:-}"; shift 2 ;;
    --token) TOKEN="${2:-}"; shift 2 ;;
    --lan-host) LAN_HOST="${2:-}"; shift 2 ;;
    --port) LISTEN_PORT="${2:-}"; shift 2 ;;
    --ingest-password) INGEST_PASSWORD="${2:-}"; shift 2 ;;
    --ingest-username) INGEST_USERNAME="${2:-}"; shift 2 ;;
    --branch) BRANCH="${2:-}"; shift 2 ;;
    --dir) INSTALL_DIR="${2:-}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "Pilihan tidak dikenali: $1" ;;
  esac
done

# ---------------------------------------------------------------------------
step "Menyemak mesin ini"
# ---------------------------------------------------------------------------

[[ $EUID -eq 0 ]] || die "Jalankan dengan sudo."
[[ -n "$CLOUD" ]] || { usage; die "--cloud diperlukan."; }
[[ -n "$TOKEN" ]] || { usage; die "--token diperlukan."; }

case "$TOKEN" in
  hken_*) ;;
  hkag_*) die "Itu kredensial kerja, bukan token pendaftaran. Token bermula dengan hken_." ;;
  *) die "Token tidak kelihatan seperti token pendaftaran. Ia bermula dengan hken_." ;;
esac

command -v systemctl >/dev/null 2>&1 || die "Skrip ini memerlukan systemd."
for cmd in git curl; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' tiada. Pasang dahulu: apt install -y $cmd"
done
command -v node >/dev/null 2>&1 || die "Node.js tiada. Pasang Node 22 atau lebih baharu."
command -v npm >/dev/null 2>&1 || die "npm tiada."

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
[[ "$NODE_MAJOR" -ge 22 ]] || die "Node $(node --version) terlalu lama. Perlukan 22 atau lebih baharu."

# Tested rather than inferred from the version. The spool is SQLite built into Node, and a build
# without it produces a connector that starts and then cannot hold a single event — so this is
# checked here, where the message can say what to do, rather than at three in the morning.
node -e 'require("node:sqlite")' >/dev/null 2>&1 \
  || die "Node ini tiada modul node:sqlite terbina. Guna binari Node resmi 22.5+ atau 24."

note "node   : $(node --version)"
note "npm    : $(npm --version)"
note "arch   : $(uname -m)"
note "os     : $(. /etc/os-release 2>/dev/null && echo "${PRETTY_NAME:-unknown}" || echo unknown)"

# ---------------------------------------------------------------------------
step "Mengesahkan cloud boleh dihubungi"
# ---------------------------------------------------------------------------

# Checked before anything is installed. An unreachable cloud is almost always a firewall rule
# that has not been opened yet, and finding that out after building for four minutes wastes the
# visit.
if ! curl -fsS --max-time 15 "${CLOUD%/}/api/health" >/dev/null 2>&1; then
  die "Tidak dapat menghubungi ${CLOUD%/}/api/health.
  Semak: peraturan firewall keluar untuk mesin ini, DNS, dan alamat yang diberi."
fi
note "cloud  : ${CLOUD%/} menjawab"

# ---------------------------------------------------------------------------
step "Menyiapkan pengguna dan direktori"
# ---------------------------------------------------------------------------

if ! id -u "$SERVICE_USER" >/dev/null 2>&1; then
  # No login shell and no home: this account exists to own a process and a state directory.
  useradd --system --no-create-home --shell /usr/sbin/nologin "$SERVICE_USER"
  note "pengguna sistem '$SERVICE_USER' dicipta"
else
  note "pengguna sistem '$SERVICE_USER' sudah ada"
fi

install -d -m 0755 "$(dirname "$INSTALL_DIR")"
# 0700: the state directory holds the cloud credential. Nothing but this service and root reads it.
install -d -m 0700 -o "$SERVICE_USER" -g "$SERVICE_USER" "$STATE_DIR"
install -d -m 0750 "$CONFIG_DIR"

# ---------------------------------------------------------------------------
step "Mengambil kod"
# ---------------------------------------------------------------------------

if [[ -d "$INSTALL_DIR/.git" ]]; then
  git -C "$INSTALL_DIR" fetch --depth 1 origin "$BRANCH"
  git -C "$INSTALL_DIR" checkout -f "$BRANCH"
  git -C "$INSTALL_DIR" reset --hard "origin/$BRANCH"
  note "klon dikemas kini ke origin/$BRANCH"
else
  git clone --depth 1 --branch "$BRANCH" "$REPO" "$INSTALL_DIR"
  note "diklon ke $INSTALL_DIR"
fi

# ---------------------------------------------------------------------------
step "Memasang kebergantungan"
# ---------------------------------------------------------------------------

# `--ignore-scripts`, and this is a deliberate choice rather than caution.
#
# The lockfile covers the whole monorepo, including the server's Prisma client. The connector uses
# none of it: its dependencies are fastify, pino, undici and zod, all pure JavaScript. Letting
# lifecycle scripts run would download tens of megabytes of database engines for this
# architecture and add a failure mode for a package the connector never imports.
#
# `--omit=dev` is NOT used: TypeScript itself is a dev dependency and the build below needs it.
( cd "$INSTALL_DIR" && npm ci --ignore-scripts --no-audit --no-fund )

# ---------------------------------------------------------------------------
step "Membina"
# ---------------------------------------------------------------------------

# Packages first through project references, then the connector. Compiled JavaScript, not tsx: a
# syntax error becomes a build failure here rather than a crash at request time on a machine
# nobody is watching.
( cd "$INSTALL_DIR" && npx tsc --build )
( cd "$INSTALL_DIR" && npm run build:prod --workspace @attendance/agent )

[[ -f "$INSTALL_DIR/apps/agent/dist/main.js" ]] \
  || die "Bina selesai tetapi apps/agent/dist/main.js tiada."

chown -R "$SERVICE_USER":"$SERVICE_USER" "$INSTALL_DIR"

# ---------------------------------------------------------------------------
step "Menulis konfigurasi"
# ---------------------------------------------------------------------------

if [[ -z "$LAN_HOST" ]]; then
  # The address on the route that reaches the cloud, which on a single-NIC Pi is the LAN address
  # the terminals will also use. Reported to the cloud and shown on the devices screen, so a wrong
  # value produces a terminal configured to push somewhere unreachable.
  LAN_HOST="$(ip route get 1.1.1.1 2>/dev/null | sed -n 's/.* src \([0-9.]*\).*/\1/p' | head -1 || true)"
fi
[[ -n "$LAN_HOST" ]] || die "Tidak dapat mengesan alamat LAN. Beri --lan-host <ip>."

GENERATED_PASSWORD=0
if [[ -z "$INGEST_PASSWORD" ]]; then
  # Firmware caps this at 16 characters, so it is generated inside that limit rather than
  # truncated later where the mismatch would only show as a terminal that cannot authenticate.
  INGEST_PASSWORD="$(head -c 24 /dev/urandom | base64 | tr -dc 'A-Za-z0-9' | head -c 14)"
  GENERATED_PASSWORD=1
fi

ENV_FILE="$CONFIG_DIR/agent.env"

# The enrolment token is written only if there is no credential yet. Leaving a spent token in the
# file achieves nothing and puts a secret on disk for no reason.
NEEDS_ENROL=1
[[ -s "$STATE_DIR/credential" ]] && NEEDS_ENROL=0

umask 077
{
  echo "# Ditulis oleh install-agent.sh. Kredensial kerja TIDAK di sini -"
  echo "# ia dalam $STATE_DIR/credential pada 0600, ditulis oleh connector selepas mendaftar."
  echo "NODE_ENV=production"
  echo "CLOUD_URL=${CLOUD%/}"
  echo "STATE_DIR=$STATE_DIR"
  echo "LISTEN_HOST=0.0.0.0"
  echo "LISTEN_PORT=$LISTEN_PORT"
  echo "LAN_HOST=$LAN_HOST"
  echo "INGEST_USERNAME=$INGEST_USERNAME"
  echo "INGEST_PASSWORD=$INGEST_PASSWORD"
  echo "LOG_LEVEL=info"
  if [[ "$NEEDS_ENROL" -eq 1 ]]; then
    echo "ENROL_TOKEN=$TOKEN"
  fi
} > "$ENV_FILE"
# 0600, root only. systemd reads `EnvironmentFile` as root while setting the unit up, before it
# drops to the service user, so the service account never needs to read this itself. Granting it
# group access would widen who can read the ingest password for no gain.
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
note "konfigurasi : $ENV_FILE (0600, root sahaja)"

# ---------------------------------------------------------------------------
step "Memasang servis"
# ---------------------------------------------------------------------------

cat > /etc/systemd/system/attendance-agent.service <<UNIT
[Unit]
Description=Attendance on-site connector
Documentation=https://github.com/mfar1984/attendance
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
Group=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
EnvironmentFile=$ENV_FILE
# The warning is silenced rather than tolerated: node:sqlite prints an experimental notice on every
# start, and a journal that opens with a warning on every boot teaches whoever reads it to skip the
# top of the log.
ExecStart=/usr/bin/env node --disable-warning=ExperimentalWarning $INSTALL_DIR/apps/agent/dist/main.js
Restart=always
RestartSec=5

# The connector reads one directory and writes one. Nothing else on this machine is its business.
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$STATE_DIR

[Install]
WantedBy=multi-user.target
UNIT

systemctl daemon-reload
systemctl enable attendance-agent >/dev/null 2>&1
systemctl restart attendance-agent

# ---------------------------------------------------------------------------
step "Mengesahkan ia benar-benar mendaftar"
# ---------------------------------------------------------------------------

# `systemctl restart` returns zero for a unit that starts and immediately exits, so success is
# judged on the credential file appearing — which only happens after the cloud accepted the
# enrolment.
ENROLLED=0
for _ in $(seq 1 30); do
  if [[ -s "$STATE_DIR/credential" ]]; then ENROLLED=1; break; fi
  if ! systemctl is-active --quiet attendance-agent; then break; fi
  sleep 2
done

if [[ "$ENROLLED" -ne 1 ]]; then
  printf '\n[gagal] Connector tidak mendaftar.\n\n'
  printf 'Log terakhir:\n\n'
  journalctl -u attendance-agent -n 30 --no-pager || true
  printf '\nSebab yang biasa: token sudah diguna atau luput (ia sah sejam sahaja),\n'
  printf 'atau cloud menolak kredensial. Jana token baharu dan jalankan semula.\n\n'
  exit 1
fi

# The token is removed once spent. It is worth nothing now, and a secret left on disk for no
# reason is still a secret on disk.
sed -i '/^ENROL_TOKEN=/d' "$ENV_FILE"
systemctl restart attendance-agent

# ---------------------------------------------------------------------------
printf '\n==> Siap\n\n'
note "servis    : systemctl status attendance-agent"
note "log       : journalctl -u attendance-agent -f"
note "keadaan   : $STATE_DIR"
note "pendengar : http://$LAN_HOST:$LISTEN_PORT"
printf '\n'
printf 'Tuding terminal di tapak ini ke:\n\n'
printf '    http://%s:%s/hik/events\n\n' "$LAN_HOST" "$LISTEN_PORT"
printf '  Nama pengguna Digest : %s\n' "$INGEST_USERNAME"
if [[ "$GENERATED_PASSWORD" -eq 1 ]]; then
  printf '  Kata laluan Digest   : %s\n\n' "$INGEST_PASSWORD"
  printf '  Kata laluan ini dijana dan dipaparkan sekali di sini. Ia ada dalam %s\n' "$ENV_FILE"
  printf '  kalau diperlukan semula.\n'
else
  printf '  Kata laluan Digest   : (yang anda berikan)\n'
fi
printf '\nSeterusnya: tambah peranti pada skrin dan pilih connector ini padanya.\n\n'
