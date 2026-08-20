#!/usr/bin/env bash
# Install the Nexus→Qtech bridge on a Raspberry Pi (Raspberry Pi OS Bookworm).
#
#   sudo ./install.sh
#
# Idempotent: safe to re-run to deploy a new build.
set -euo pipefail

APP_DIR=/opt/nexus-qtech-bridge
ENV_FILE=/etc/nexus-qtech-bridge.env
SERVICE=nexus-qtech-bridge.service
RUN_USER=qtechbridge
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ $EUID -ne 0 ]]; then
  echo "Run with sudo." >&2
  exit 1
fi

# ── Node ────────────────────────────────────────────────────────────────────
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js is not installed. Install Node 20 LTS or newer, then re-run:" >&2
  echo "  curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -" >&2
  echo "  sudo apt-get install -y nodejs" >&2
  exit 1
fi

NODE_MAJOR="$(node -p 'process.versions.node.split(".")[0]')"
if (( NODE_MAJOR < 20 )); then
  echo "Node ${NODE_MAJOR} found; this bridge needs Node 20 or newer." >&2
  exit 1
fi

# ── Service account ─────────────────────────────────────────────────────────
if ! id -u "$RUN_USER" >/dev/null 2>&1; then
  echo "==> creating service user ${RUN_USER}"
  useradd --system --no-create-home --shell /usr/sbin/nologin "$RUN_USER"
fi

# ── Build ───────────────────────────────────────────────────────────────────
# Install everything (tsc is a devDependency), compile, then prune the build
# tools back out before deploying. Installing --omit=dev and adding tsc
# afterwards would leave the TypeScript compiler in the node_modules that gets
# copied to /opt — tens of MB of build tooling shipped to a runtime host.
echo "==> building"
cd "$SRC_DIR"
npm ci
npx tsc -p tsconfig.json
echo "==> pruning build tooling"
npm prune --omit=dev

# ── Deploy ──────────────────────────────────────────────────────────────────
echo "==> installing to ${APP_DIR}"
mkdir -p "$APP_DIR"
rm -rf "${APP_DIR:?}/dist" "${APP_DIR:?}/node_modules"
cp -r dist "$APP_DIR/"
cp -r node_modules "$APP_DIR/"
cp package.json "$APP_DIR/"
cp README.md "$APP_DIR/" 2>/dev/null || true
cp -r sql "$APP_DIR/" 2>/dev/null || true
cp -r docs "$APP_DIR/" 2>/dev/null || true
chown -R root:root "$APP_DIR"
chmod -R go-w "$APP_DIR"

# ── Credentials ─────────────────────────────────────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "==> writing credential template to ${ENV_FILE}"
  cp "$SRC_DIR/.env.example" "$ENV_FILE"
  echo "    EDIT IT before starting the service."
fi
chown root:"$RUN_USER" "$ENV_FILE"
chmod 0640 "$ENV_FILE"

# ── systemd ─────────────────────────────────────────────────────────────────
echo "==> installing ${SERVICE}"
cp "$SRC_DIR/systemd/${SERVICE}" "/etc/systemd/system/${SERVICE}"
systemctl daemon-reload
systemctl enable "$SERVICE"

cat <<MSG

Installed.

Next:
  1. Apply sql/001_qtech_bridge.sql to Supabase (once, from the SQL editor).
  2. sudo nano ${ENV_FILE}          # Supabase + Qtech credentials
  3. sudo systemctl restart ${SERVICE}
  4. journalctl -u ${SERVICE} -f    # watch it come up

Verify from Supabase:
  select bridge_id, state, heartbeat_age_seconds, sent_today, failed_today
  from qtech_bridge_status;
MSG
