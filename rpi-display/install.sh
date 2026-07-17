#!/bin/bash
#
# Install the Nexus RPi Queue Display on a Raspberry Pi (Raspberry Pi OS).
#
# Prereqs (installed if missing): chromium-browser, python3, unclutter, curl.
#
# Usage:
#   sudo ./install.sh
#
# After install, edit /opt/rpi-display/config.json to point at your Nexus:
#
#   { "nexusUrl": "http://nexus.local:3000" }
#
# Then reboot. The Pi will open Chromium in kiosk mode at boot and poll
# Nexus for mode changes. Everything else is controlled from
# Nexus → Admin → RPi Queue Display.

set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "install.sh must be run as root (use sudo)" >&2
  exit 1
fi

SRC_DIR="$(cd "$(dirname "$0")" && pwd)"
TARGET_DIR=/opt/rpi-display
KIOSK_USER="${KIOSK_USER:-pi}"

echo "[1/6] Installing OS packages…"
apt-get update -y
apt-get install -y --no-install-recommends python3 unclutter curl
# The Chromium package is named `chromium` on Raspberry Pi OS Bookworm and
# `chromium-browser` on older releases. Install whichever the distro offers.
if apt-get install -y --no-install-recommends chromium; then
  echo "  installed 'chromium'"
elif apt-get install -y --no-install-recommends chromium-browser; then
  echo "  installed 'chromium-browser'"
else
  echo "  ERROR: could not install chromium or chromium-browser" >&2
  exit 1
fi

echo "[2/6] Copying app to ${TARGET_DIR}…"
mkdir -p "${TARGET_DIR}"
cp -R "${SRC_DIR}/public" "${TARGET_DIR}/"
cp "${SRC_DIR}/server.py" "${TARGET_DIR}/"
chmod +x "${TARGET_DIR}/server.py"

echo "[3/6] Ensuring config.json exists…"
if [[ ! -f "${TARGET_DIR}/config.json" ]]; then
  cat > "${TARGET_DIR}/config.json" <<'JSON'
{
  "nexusUrl": "http://nexus.local:3000"
}
JSON
  echo "  wrote default config.json — edit it to point at your Nexus."
else
  echo "  config.json already present, leaving as-is."
fi

echo "[4/6] Fixing ownership…"
chown -R "${KIOSK_USER}:${KIOSK_USER}" "${TARGET_DIR}"

echo "[5/6] Installing systemd units…"
install -m 0644 "${SRC_DIR}/systemd/rpi-display.service"          /etc/systemd/system/
install -m 0644 "${SRC_DIR}/systemd/rpi-display-chromium.service" /etc/systemd/system/
# If KIOSK_USER != pi, patch User= line in the units.
if [[ "${KIOSK_USER}" != "pi" ]]; then
  sed -i "s/^User=pi/User=${KIOSK_USER}/" /etc/systemd/system/rpi-display.service
  sed -i "s/^User=pi/User=${KIOSK_USER}/" /etc/systemd/system/rpi-display-chromium.service
  sed -i "s|/home/pi/.Xauthority|/home/${KIOSK_USER}/.Xauthority|" /etc/systemd/system/rpi-display-chromium.service
fi
systemctl daemon-reload
systemctl enable rpi-display.service rpi-display-chromium.service

echo "[6/6] Starting the static server (Chromium will auto-start at boot)…"
systemctl restart rpi-display.service

cat <<EOF

Done.

Next steps:
  1. Edit ${TARGET_DIR}/config.json — set "nexusUrl" to your Nexus host.
  2. Reboot the Pi: sudo reboot
  3. Control mode/URL from Nexus → Admin → RPi Queue Display.

Log tails:
  journalctl -u rpi-display.service -f
  journalctl -u rpi-display-chromium.service -f
EOF
