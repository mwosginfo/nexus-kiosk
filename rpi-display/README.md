# Nexus RPi Queue Display

A **very simple** kiosk app that projects the MWO — OWWA queue onto the
office LED panel via a Raspberry Pi. No accounts, no UI on the Pi itself —
everything is controlled from **Nexus → Admin → RPi Queue Display**.

## What runs on the Pi

- **Chromium in `--kiosk` mode** pointed at `http://127.0.0.1:8080/`.
- **A tiny Python static server** (`server.py`) that serves the wrapper
  HTML/CSS/JS from `public/` and exposes the Pi's `nexusUrl` to the browser.
- **Two systemd units** so both start at boot and restart on crash.

Everything else — mode (`LOCAL` vs `ONLINE`), the online URL, refresh
interval — is fetched from Nexus every few seconds and applied without
restarting anything.

## Layout

- **Fixed 640 × 1080 stage:** the queue UI is pinned to a 640×1080 box
  anchored at the **top-left** of whatever resolution the Pi outputs, with
  black everywhere else. On a real 640×1080 panel it fills the screen
  edge to edge. Do not make the layout fluid — the capture-crop workflow
  below depends on the fixed stage.
- **Layout:** 1 header, 1 column-header, **5 called rows**, 1 missed row,
  1 footer — matching the AWS S3 mockup.

## Feeding a video mixer (Resolume) via HDMI-USB capture

When the LED wall is driven by a media server (e.g. Resolume) instead of
being plugged into the Pi directly:

```
Pi HDMI0 ──micro-HDMI→HDMI──► HDMI-USB capture dongle ──► Resolume PC ──► wall
```

- The dongle presents itself as a 1920×1080 monitor; the Pi renders the
  stage in the top-left corner of that output, black elsewhere.
- In Resolume: Sources → Capture Devices → the dongle → **crop the input
  to x:0 y:0 w:640 h:1080** → map onto the wall. No scaling needed.
- The Resolume PC needs no network access — the Pi does all the rendering
  and needs LAN to Nexus (LOCAL mode) / internet (ONLINE mode).
- Skip any screen-rotation setup in this configuration; the portrait
  geometry lives inside the stage.

## Modes

| Mode | What renders |
|---|---|
| `LOCAL` | The wrapper page polls `GET /api/rpi-display/queue` on Nexus every few seconds and renders the 5 latest called numbers + the missed row. This is the intended default when the office LAN and Nexus are up. |
| `ONLINE` | The wrapper page loads the AWS S3 public queue page (`http://mwoowwaqueue.s3-website-ap-southeast-1.amazonaws.com/`) in a full-screen iframe. Useful fallback when Nexus is unreachable but the office still has internet. |

A mode change from Nexus takes effect on the next poll (~5 s by default) —
no Chromium restart, no page reload.

## Install (on the Pi)

```bash
git clone <this repo> ~/nexus-kiosk
cd ~/nexus-kiosk/rpi-display
sudo ./install.sh
```

The installer:
1. Installs `chromium-browser`, `python3`, `unclutter`, `curl` if missing.
2. Copies `public/` and `server.py` to `/opt/rpi-display/`.
3. Writes a default `/opt/rpi-display/config.json` if none exists.
4. Installs and enables the two systemd units.

After install:

```bash
sudo nano /opt/rpi-display/config.json      # set nexusUrl
sudo reboot
```

## Config on the Pi

Only one setting lives on the Pi. Everything else is controlled from Nexus.

`/opt/rpi-display/config.json`:

```json
{
  "nexusUrl": "http://nexus.local:3000"
}
```

- `nexusUrl` — the base URL where Nexus's backend is reachable on the LAN.
  Do **not** include a trailing slash or an `/api` suffix.

## Config in Nexus

`Admin → RPi Queue Display` writes to `system_config['rpi_display.config']`:

| Field | Default | Notes |
|---|---|---|
| `mode` | `LOCAL` | `LOCAL` or `ONLINE`. |
| `onlineUrl` | AWS S3 URL | The URL loaded in the iframe when `mode = ONLINE`. |
| `refreshSec` | `5` | How often the Pi polls config and re-pulls the queue. Range 2–60. |

The Pi picks up changes on the next poll. No restart, no login on the Pi.

## Backing endpoints

| Method | Path | Auth |
|---|---|---|
| `GET` | `/api/rpi-display/config` | Public — the Pi polls this. |
| `GET` | `/api/rpi-display/queue` | Public — the Pi polls this in `LOCAL` mode. Returns 5 called rows + missed numbers. No PII. |
| `PUT` | `/api/rpi-display/config` | `ADMIN` — the Nexus admin page. |

## Layout of the display

```
┌────────────────────────────┐
│    MWO - OWWA QUEUE        │ ← header
├────────────────────────────┤
│  NOW SERVING     COUNTER   │ ← column headers
├────────────────────────────┤
│   9011                  8  │
│   6009                  6  │
│   A004                  3  │  ← 5 called rows
│   6006                  6  │
│   6005                  7  │
├────────────────────────────┤
│  MISSED    RE-INSTATE      │ ← missed header
│   6001, 6002, 6003         │ ← missed numbers (or "None")
├────────────────────────────┤
│  MWO Singapore   09:43:15  │ ← footer + clock
└────────────────────────────┘
```

The most-recently-called row pulses red for 5 seconds after each new call.

## Logs

```bash
journalctl -u rpi-display.service -f          # static server
journalctl -u rpi-display-chromium.service -f # Chromium kiosk
```

## Uninstall

```bash
sudo systemctl disable --now rpi-display.service rpi-display-chromium.service
sudo rm /etc/systemd/system/rpi-display*.service
sudo rm -rf /opt/rpi-display
sudo systemctl daemon-reload
```
