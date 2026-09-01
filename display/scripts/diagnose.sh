#!/usr/bin/env bash
# Nexus→Qtech bridge — on-Pi diagnostics.
#
#   cd ~/nexus-kiosk/display && sudo ./scripts/diagnose.sh
#
# Checks everything the bridge needs and prints a report safe to paste into a
# chat: it reports whether each secret is SET, never what it is.
set -uo pipefail

ENV_FILE=${ENV_FILE:-/etc/nexus-qtech-bridge.env}
APP_DIR=${APP_DIR:-/opt/nexus-qtech-bridge}
SERVICE=nexus-qtech-bridge.service

pass() { printf '  \033[32m✓\033[0m %s\n' "$1"; }
fail() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAILED=$((FAILED+1)); }
warn() { printf '  \033[33m!\033[0m %s\n' "$1"; }
head_() { printf '\n\033[1m%s\033[0m\n' "$1"; }
FAILED=0

printf '\n\033[1mNexus→Qtech bridge — diagnostics\033[0m\n'
printf 'host %s   %s\n' "$(hostname)" "$(date -Is)"

# ── 1. Runtime ──────────────────────────────────────────────────────────────
head_ '1. Runtime'
if command -v node >/dev/null 2>&1; then
  NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]' 2>/dev/null || echo 0)
  if [ "$NODE_MAJOR" -ge 22 ]; then pass "node $(node -v)"
  else fail "node $(node -v) — needs 22 or newer (supabase-js needs a native WebSocket; on older Node the bridge crash-loops with 'native WebSocket not found')"; fi
else
  fail 'node is not installed'
fi
[ -f "$APP_DIR/dist/src/index.js" ] && pass "build present at $APP_DIR" \
  || fail "no build at $APP_DIR/dist/src/index.js — run: sudo ./install.sh"

# ── 2. Service ──────────────────────────────────────────────────────────────
head_ '2. Service'
if systemctl list-unit-files "$SERVICE" >/dev/null 2>&1; then
  systemctl is-enabled --quiet "$SERVICE" && pass 'enabled at boot' || warn 'not enabled at boot'
  if systemctl is-active --quiet "$SERVICE"; then
    pass "running (since $(systemctl show -p ActiveEnterTimestamp --value "$SERVICE"))"
  else
    fail "not running — state: $(systemctl show -p SubState --value "$SERVICE")"
    printf '      exit: %s / %s\n' \
      "$(systemctl show -p ExecMainStatus --value "$SERVICE")" \
      "$(systemctl show -p Result --value "$SERVICE")"
  fi
  RESTARTS=$(systemctl show -p NRestarts --value "$SERVICE")
  [ "${RESTARTS:-0}" -gt 3 ] && warn "restarted $RESTARTS times — likely a crash loop"
else
  fail "$SERVICE is not installed"
fi

# ── 3. Configuration ────────────────────────────────────────────────────────
head_ '3. Configuration'
if [ -f "$ENV_FILE" ]; then
  pass "$ENV_FILE exists ($(stat -c '%a %U:%G' "$ENV_FILE"))"
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE" 2>/dev/null; set +a
  for key in SUPABASE_URL SUPABASE_KEY QTECH_TCP_HOST QTECH_TCP_PORT QTECH_AUTH_TOKEN QTECH_BRANCH_UUID; do
    if [ -n "${!key:-}" ]; then
      case "$key" in
        *KEY|*TOKEN) pass "$key is set (value hidden)" ;;
        *)           pass "$key = ${!key}" ;;
      esac
    else
      fail "$key is not set"
    fi
  done
  [ -n "${SUPABASE_URL:-}" ] && case "$SUPABASE_URL" in
    https://*) pass 'SUPABASE_URL uses https' ;;
    *) fail 'SUPABASE_URL must be https — the bridge refuses to start otherwise' ;;
  esac
  [ "${NODE_TLS_REJECT_UNAUTHORIZED:-}" = "0" ] && \
    fail 'NODE_TLS_REJECT_UNAUTHORIZED=0 is set — the bridge refuses to start'
else
  fail "$ENV_FILE not found"
fi

# Let the bridge's own parser judge it — this reproduces the startup check.
if [ -f "$APP_DIR/dist/src/config.js" ]; then
  if OUT=$(node -e "import('$APP_DIR/dist/src/config.js').then(m=>{m.loadConfig();console.log('ok')}).catch(e=>{console.error(e.message);process.exit(1)})" 2>&1); then
    pass 'config parses'
  else
    fail 'config rejected:'
    printf '%s\n' "$OUT" | sed 's/^/      /' | head -20
  fi
fi

# ── 4. Qtech endpoint (PE network) ──────────────────────────────────────────
head_ '4. Qtech endpoint'
if [ -n "${QTECH_TCP_HOST:-}" ]; then
  PORT=${QTECH_TCP_PORT:-4009}
  if node -e "
    const net=require('net');const s=net.connect({host:'$QTECH_TCP_HOST',port:$PORT});
    s.setTimeout(5000);
    s.on('connect',()=>{console.log('connected');s.destroy();process.exit(0)});
    s.on('timeout',()=>{console.error('timed out after 5s');process.exit(1)});
    s.on('error',e=>{console.error(e.code||e.message);process.exit(1)});
  " >/dev/null 2>&1; then
    pass "TCP $QTECH_TCP_HOST:$PORT reachable"
  else
    REASON=$(node -e "
      const net=require('net');const s=net.connect({host:'$QTECH_TCP_HOST',port:$PORT});
      s.setTimeout(5000);
      s.on('connect',()=>{s.destroy();process.exit(0)});
      s.on('timeout',()=>{console.log('timed out');process.exit(1)});
      s.on('error',e=>{console.log(e.code||e.message);process.exit(1)});
    " 2>&1)
    fail "TCP $QTECH_TCP_HOST:$PORT — $REASON"
    printf '      ping: '; ping -c1 -W2 "$QTECH_TCP_HOST" >/dev/null 2>&1 \
      && printf 'host responds\n' || printf 'no reply (may just be ICMP blocked)\n'
  fi
fi

# ── 5. Supabase ─────────────────────────────────────────────────────────────
head_ '5. Supabase'
if [ -n "${SUPABASE_URL:-}" ]; then
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "apikey: ${SUPABASE_KEY:-}" -H "Authorization: Bearer ${SUPABASE_KEY:-}" \
    "${SUPABASE_URL}/rest/v1/kiosk_checkins?select=id&limit=1" 2>/dev/null)
  case "$CODE" in
    200) pass 'can read kiosk_checkins' ;;
    401|403) fail "auth rejected (HTTP $CODE) — check SUPABASE_KEY and its grants" ;;
    000) fail 'no response — DNS, firewall, or no internet on this network' ;;
    *) fail "unexpected HTTP $CODE" ;;
  esac
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 10 \
    -H "apikey: ${SUPABASE_KEY:-}" -H "Authorization: Bearer ${SUPABASE_KEY:-}" \
    "${SUPABASE_URL}/rest/v1/qtech_bridge_status?select=state" 2>/dev/null)
  case "$CODE" in
    200) pass 'health view reachable' ;;
    404) fail 'qtech_bridge_status missing — apply sql/001_qtech_bridge.sql' ;;
    *) warn "health view returned HTTP $CODE" ;;
  esac
fi

# ── 6. Recent errors ────────────────────────────────────────────────────────
head_ '6. Recent errors'
ERRS=$(journalctl -u "$SERVICE" -p err -n 15 --no-pager -o cat 2>/dev/null)
if [ -z "$ERRS" ]; then pass 'no errors in the journal'
else printf '%s\n' "$ERRS" | sed 's/^/      /'; fi

# ── 7. Host ─────────────────────────────────────────────────────────────────
head_ '7. Host'
printf '      disk  %s\n' "$(df -h / | awk 'NR==2{print $4" free of "$2}')"
printf '      time  %s\n' "$(timedatectl show -p NTPSynchronized --value 2>/dev/null | grep -q yes && echo 'NTP synced' || echo 'NOT synced')"

printf '\n'
[ "$FAILED" -eq 0 ] && printf '\033[32mNothing failed — if the bridge still misbehaves, send the journal.\033[0m\n\n' \
  || printf '\033[31m%d check(s) failed — see above.\033[0m\n\n' "$FAILED"
exit 0
