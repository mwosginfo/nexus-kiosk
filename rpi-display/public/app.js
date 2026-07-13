/* Nexus RPi Queue Display — client-side controller.
 *
 * This page is loaded by Chromium in kiosk mode. It polls the Nexus backend
 * for the current mode (LOCAL vs ONLINE) and either renders the local queue
 * rows or embeds the online AWS S3 page in an iframe. All logic lives in
 * this single file so admin mode-switches from Nexus take effect without
 * restarting the browser.
 *
 * Configuration comes from a small JSON file the operator writes on the Pi:
 *
 *   /opt/rpi-display/config.json
 *   { "nexusUrl": "http://nexus.local:3000" }
 *
 * The static server on the Pi (server.py) serves that file at /nexus-url.json.
 */

const CURTAIN = document.getElementById('curtain');
const CURTAIN_MSG = document.getElementById('curtain-msg');
const LOCAL = document.getElementById('local');
const ONLINE = document.getElementById('online-frame');
const ROWS = document.getElementById('rows');
const MISSED = document.getElementById('missed');
const CLOCK = document.getElementById('clock');

const DEFAULT_REFRESH_SEC = 5;
const MIN_REFRESH_SEC = 2;
const MAX_REFRESH_SEC = 60;
const FAIL_BACKOFF_MS = 8000;

let nexusUrl = null;         // resolved from /nexus-url.json on boot
let currentMode = null;      // 'LOCAL' | 'ONLINE'
let currentOnlineUrl = null; // last URL sent to the iframe
let refreshSec = DEFAULT_REFRESH_SEC;
let configTimer = null;
let queueTimer = null;
let queueFailStreak = 0;

// ─── Boot ─────────────────────────────────────────────────────────

async function boot() {
  showCurtain('Loading…');
  try {
    const res = await fetch('/nexus-url.json', { cache: 'no-store' });
    if (!res.ok) throw new Error('nexus-url.json missing');
    const data = await res.json();
    if (typeof data?.nexusUrl !== 'string' || !data.nexusUrl) {
      throw new Error('nexusUrl not set in config');
    }
    nexusUrl = data.nexusUrl.replace(/\/+$/, '');
  } catch (err) {
    showCurtain('Config missing — set nexusUrl in /opt/rpi-display/config.json');
    console.error(err);
    return;
  }
  tick();
  startClock();
}

function scheduleConfigTick() {
  clearTimeout(configTimer);
  configTimer = setTimeout(tick, refreshSec * 1000);
}

async function tick() {
  try {
    const cfg = await fetchJSON(`${nexusUrl}/api/rpi-display/config`);
    const nextRefresh = clamp(Number(cfg.refreshSec) || DEFAULT_REFRESH_SEC, MIN_REFRESH_SEC, MAX_REFRESH_SEC);
    if (nextRefresh !== refreshSec) {
      refreshSec = nextRefresh;
      restartQueuePolling();
    }
    applyMode(cfg);
    hideCurtain();
  } catch (err) {
    console.error('config fetch failed', err);
    if (!currentMode) showCurtain('Cannot reach Nexus — retrying…');
  } finally {
    scheduleConfigTick();
  }
}

// ─── Mode switching ───────────────────────────────────────────────

function applyMode(cfg) {
  const mode = cfg?.mode === 'ONLINE' ? 'ONLINE' : 'LOCAL';
  if (mode === 'ONLINE') {
    const url = String(cfg.onlineUrl || '');
    if (currentMode !== 'ONLINE' || currentOnlineUrl !== url) {
      ONLINE.src = url;
      currentOnlineUrl = url;
    }
    ONLINE.hidden = false;
    LOCAL.hidden = true;
    stopQueuePolling();
  } else {
    ONLINE.hidden = true;
    LOCAL.hidden = false;
    if (currentMode !== 'LOCAL') startQueuePolling();
  }
  currentMode = mode;
}

// ─── Local queue rendering ────────────────────────────────────────

function startQueuePolling() {
  stopQueuePolling();
  void pullQueue();
  queueTimer = setInterval(() => { void pullQueue(); }, refreshSec * 1000);
}

function stopQueuePolling() {
  if (queueTimer) { clearInterval(queueTimer); queueTimer = null; }
}

function restartQueuePolling() {
  if (currentMode === 'LOCAL') startQueuePolling();
}

async function pullQueue() {
  try {
    const data = await fetchJSON(`${nexusUrl}/api/rpi-display/queue`);
    queueFailStreak = 0;
    renderRows(Array.isArray(data.called) ? data.called : []);
    renderMissed(Array.isArray(data.missed) ? data.missed : []);
  } catch (err) {
    queueFailStreak += 1;
    console.error('queue fetch failed', err);
    // Occasional failures are silent; a sustained outage shows the curtain.
    if (queueFailStreak >= 3) showCurtain('Live queue unavailable — reconnecting…');
  }
}

function renderRows(called) {
  const rows = [];
  for (let i = 0; i < 5; i++) {
    const row = called[i];
    if (row) {
      const secondsSince = row.calledAt
        ? Math.floor((Date.now() - new Date(row.calledAt).getTime()) / 1000)
        : 999;
      const pulse = secondsSince <= 5 ? ' pulse' : '';
      const counterHTML = row.counterNumber != null
        ? `<div class="counter${pulse}">${escapeHtml(String(row.counterNumber))}</div>`
        : `<div class="counter empty">—</div>`;
      rows.push(
        `<div class="row"><div class="num${pulse}">${escapeHtml(row.queueNumber)}</div>${counterHTML}</div>`,
      );
    } else {
      rows.push('<div class="row"><div class="num">&nbsp;</div><div class="counter">&nbsp;</div></div>');
    }
  }
  ROWS.innerHTML = rows.join('');
}

function renderMissed(missed) {
  if (!missed.length) {
    MISSED.className = 'missed empty';
    MISSED.textContent = 'None';
    return;
  }
  MISSED.className = 'missed';
  MISSED.textContent = missed.map(String).join(', ');
}

// ─── Clock ────────────────────────────────────────────────────────

function startClock() {
  const paint = () => {
    const now = new Date();
    const s = now.toLocaleTimeString('en-SG', {
      timeZone: 'Asia/Singapore',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
    CLOCK.textContent = s;
  };
  paint();
  setInterval(paint, 1000);
}

// ─── Utilities ────────────────────────────────────────────────────

async function fetchJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

function clamp(n, lo, hi) { return Math.max(lo, Math.min(hi, n)); }

function escapeHtml(s) {
  return String(s)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function showCurtain(msg) {
  CURTAIN_MSG.textContent = msg;
  CURTAIN.classList.remove('hidden');
}
function hideCurtain() {
  CURTAIN.classList.add('hidden');
}

// Retry loop against transient network hiccups on the Pi.
window.addEventListener('online', () => { void tick(); });

boot().catch((err) => {
  console.error('boot failed', err);
  showCurtain('Startup failed. Check /opt/rpi-display/config.json');
});
