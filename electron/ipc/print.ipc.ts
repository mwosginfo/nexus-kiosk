import { ipcMain, BrowserWindow } from 'electron';
import { settingsStore } from '../services/settings-store';

interface TicketData {
  readonly queueNumber: string;
  readonly clientName: string;
  readonly serviceType: string;
}

interface QrTicketData {
  readonly title: string;          // "URGENT FRA REGISTRATION"
  readonly qrDataUrl: string;      // PNG data URL of the QR code
  readonly pra: string;
  readonly fra: string;
  readonly contractCount: number;
  readonly instructions: string;   // multi-line string
}

/**
 * Canonical ticket service labels.
 *
 * The kiosk receives a variety of representations for the same service
 * (enum `SKILLED_CV`, slug `skilled-cv`, friendly `Skilled Worker - CV`,
 * pickup-tagged `PICKUP - DH`, suffixed `FRA Registration (Lost Booking)`).
 * The thermal ticket must always render the public-facing label that
 * matches the Nexus repo:
 *
 *   skilled-cv, mdw-cv  → CONTRACT VERIFICATION
 *   dh                  → DIRECT HIRE
 *   owwa                → OWWA
 *   accreditation       → ACCREDITATION
 *   fra-registration    → FRA REGISTRATION
 */
const SERVICE_LABEL_MAP: Readonly<Record<string, string>> = {
  // Enums
  SKILLED_CV: 'CONTRACT VERIFICATION',
  MDW_CV: 'CONTRACT VERIFICATION',
  DH: 'DIRECT HIRE',
  OWWA: 'OWWA',
  FRA_REGISTRATION: 'FRA REGISTRATION',
  ACCREDITATION: 'ACCREDITATION',
  // Slugs
  'skilled-cv': 'CONTRACT VERIFICATION',
  'mdw-cv': 'CONTRACT VERIFICATION',
  dh: 'DIRECT HIRE',
  owwa: 'OWWA',
  'fra-registration': 'FRA REGISTRATION',
  accreditation: 'ACCREDITATION',
  // Friendly display labels (what resolveServiceLabel returns)
  'Skilled Worker - CV': 'CONTRACT VERIFICATION',
  'MDW - Contract Verification': 'CONTRACT VERIFICATION',
  'Direct Hire': 'DIRECT HIRE',
  'FRA Registration': 'FRA REGISTRATION',
  Accreditation: 'ACCREDITATION',
};

/**
 * Normalize whatever the React layer passes into the canonical ticket label.
 * Preserves a leading PICKUP prefix and any parenthetical suffix
 * (e.g. "FRA Registration (Lost Booking)" → "FRA REGISTRATION (LOST BOOKING)").
 */
function normalizeServiceLabel(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();

  // PICKUP - <something>
  const pickupMatch = trimmed.match(/^PICKUP\s*-\s*(.+)$/i);
  if (pickupMatch && pickupMatch[1]) {
    return `PICKUP - ${normalizeServiceLabel(pickupMatch[1])}`;
  }

  // <base> (<suffix>) — e.g. "FRA Registration (Lost Booking)" or "Direct Hire (Pickup)"
  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch && parenMatch[1] && parenMatch[2]) {
    const base = normalizeServiceLabel(parenMatch[1]);
    return `${base} (${parenMatch[2].trim().toUpperCase()})`;
  }

  // Direct hit
  const direct = SERVICE_LABEL_MAP[trimmed];
  if (direct) return direct;

  // Case-insensitive hit
  const upper = trimmed.toUpperCase();
  for (const [key, value] of Object.entries(SERVICE_LABEL_MAP)) {
    if (key.toUpperCase() === upper) return value;
  }

  // Fallback: uppercase, replace underscores with spaces. Keeps tickets
  // legible for any service the kiosk doesn't yet map explicitly.
  return trimmed.toUpperCase().replace(/_/g, ' ');
}

function buildReceiptHtml(data: TicketData): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-SG', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-SG', {
    hour: '2-digit',
    minute: '2-digit',
  });
  const service = normalizeServiceLabel(data.serviceType);

  // CSS mirrors apps/frontend/src/lib/thermal-print.ts in the Nexus repo so
  // the kiosk and the in-Nexus print path produce identical tickets.
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Queue Ticket</title>
<style>
  @page { size: 80mm auto; margin: 0; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    width: 72mm;
    margin: 0 auto;
    text-align: center;
    padding: 3mm 2mm;
    -webkit-print-color-adjust: exact;
  }
  .header { font-size: 10pt; font-weight: 700; margin-bottom: 2mm; line-height: 1.2; text-transform: uppercase; }
  .divider { border-top: 1px dashed #000; margin: 2mm 0; }
  .queue-number { font-size: 56pt; font-weight: 900; letter-spacing: 1mm; margin: 3mm 0; line-height: 1; }
  .service { font-size: 11pt; font-weight: 700; margin: 2mm 0; text-transform: uppercase; }
  .client { font-size: 10pt; font-weight: 600; margin: 2mm 0; text-transform: uppercase; }
  .datetime { font-size: 9pt; margin: 2mm 0; }
  .footer { font-size: 8pt; margin-top: 3mm; }
</style>
</head>
<body>
  <div class="header">Migrant Workers Office<br>Singapore</div>
  <div class="divider"></div>
  <div class="queue-number">${data.queueNumber}</div>
  <div class="service">${service}</div>
  <div class="client">${data.clientName}</div>
  <div class="divider"></div>
  <div class="datetime">${dateStr} ${timeStr}</div>
  <div class="footer">Please wait for your number to be called.</div>
</body>
</html>`;
}

function buildQrTicketHtml(data: QrTicketData): string {
  const now = new Date();
  const dateStr = now.toLocaleDateString('en-SG', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
  const timeStr = now.toLocaleTimeString('en-SG', { hour: '2-digit', minute: '2-digit' });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Urgent FRA QR</title>
<style>
  @page { size: 80mm auto; margin: 2mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    width: 72mm;
    text-align: center;
    padding: 4mm 2mm;
  }
  .header {
    font-size: 11pt;
    font-weight: bold;
    line-height: 1.4;
  }
  .title {
    font-size: 13pt;
    font-weight: 900;
    margin: 3mm 0 2mm;
  }
  .divider {
    border-top: 1px dashed #000;
    margin: 3mm 0;
  }
  .qr-container {
    margin: 4mm 0;
  }
  .qr-container img {
    width: 60mm;
    height: 60mm;
    display: block;
    margin: 0 auto;
  }
  .meta {
    font-size: 9pt;
    text-align: left;
    margin: 2mm 0;
    line-height: 1.4;
  }
  .meta strong { font-weight: 700; }
  .instructions {
    font-size: 8.5pt;
    line-height: 1.5;
    margin-top: 3mm;
    text-align: left;
  }
  .instructions ol {
    padding-left: 4mm;
  }
  .datetime {
    font-size: 8pt;
    margin-top: 3mm;
  }
</style>
</head>
<body>
  <div class="header">MIGRANT WORKERS OFFICE<br>SINGAPORE</div>
  <div class="title">${data.title}</div>
  <div class="divider"></div>
  <div class="qr-container">
    <img src="${data.qrDataUrl}" alt="QR Code" />
  </div>
  <div class="divider"></div>
  <div class="meta">
    <div><strong>PRA:</strong> ${data.pra}</div>
    <div><strong>FRA:</strong> ${data.fra}</div>
    <div><strong>Contracts:</strong> ${data.contractCount}</div>
  </div>
  <div class="divider"></div>
  <div class="instructions">${data.instructions}</div>
  <div class="divider"></div>
  <div class="datetime">${dateStr}  ${timeStr}</div>
</body>
</html>`;
}

async function printHtmlOnPrinter(html: string): Promise<void> {
  const printerName = (settingsStore.get('printerName') ?? '').trim();

  const mainWindow = BrowserWindow.getAllWindows()[0];
  if (!mainWindow) {
    throw new Error('No window available for printing');
  }

  // Validate printer exists
  if (printerName) {
    const printers = mainWindow.webContents.getPrintersAsync
      ? await mainWindow.webContents.getPrintersAsync()
      : [];
    const match = printers.find((p) => p.name === printerName);
    if (!match) {
      const available = printers.map((p) => p.name).join(', ');
      throw new Error(
        `Printer "${printerName}" not found. Available: ${available || '(none)'}`,
      );
    }
  }

  const printWindow = new BrowserWindow({
    show: false,
    width: 400,
    height: 800,
    x: -10000,
    y: -10000,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  printWindow.showInactive();

  try {
    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
    );

    // Wait for full render (QR images need extra time to decode)
    await new Promise<void>((r) => setTimeout(r, 800));

    return await new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          margins: { marginType: 'none' },
          pageSize: { width: 80000, height: 297000 },
          ...(printerName ? { deviceName: printerName } : {}),
        },
        (success, failureReason) => {
          if (success) {
            resolve();
          } else {
            reject(
              new Error(
                failureReason ?? 'Print job canceled — check printer is online and paper is loaded',
              ),
            );
          }
        },
      );
    });
  } finally {
    printWindow.close();
  }
}

export function registerPrintHandlers(): void {
  ipcMain.handle('print-ticket', async (_event, data: TicketData) => {
    const html = buildReceiptHtml(data);
    return printHtmlOnPrinter(html);
  });

  ipcMain.handle('print-qr-ticket', async (_event, data: QrTicketData) => {
    const html = buildQrTicketHtml(data);
    return printHtmlOnPrinter(html);
  });

  ipcMain.handle('get-printers', async () => {
    const windows = BrowserWindow.getAllWindows();
    const win = windows[0];
    if (!win) return [];

    const printers = win.webContents.getPrintersAsync
      ? await win.webContents.getPrintersAsync()
      : [];

    return printers.map((p) => ({
      name: p.name,
      isDefault: p.isDefault,
    }));
  });
}
