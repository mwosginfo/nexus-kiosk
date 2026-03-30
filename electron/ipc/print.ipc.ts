import { ipcMain, BrowserWindow } from 'electron';
import { settingsStore } from '../services/settings-store';

interface TicketData {
  readonly queueNumber: string;
  readonly clientName: string;
  readonly serviceType: string;
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

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Queue Ticket</title>
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
  .divider {
    border-top: 1px dashed #000;
    margin: 3mm 0;
  }
  .queue-number {
    font-size: 56pt;
    font-weight: 900;
    margin: 4mm 0;
  }
  .service {
    font-size: 11pt;
    font-weight: 700;
    margin: 2mm 0;
  }
  .client {
    font-size: 10pt;
    font-weight: 600;
    margin: 1mm 0;
  }
  .datetime {
    font-size: 9pt;
    margin: 2mm 0;
  }
  .footer {
    font-size: 8pt;
    margin-top: 3mm;
    line-height: 1.4;
  }
</style>
</head>
<body>
  <div class="header">MIGRANT WORKERS OFFICE<br>SINGAPORE</div>
  <div class="divider"></div>
  <div class="queue-number">${data.queueNumber}</div>
  <div class="service">${data.serviceType.replace(/_/g, ' ')}</div>
  <div class="client">${data.clientName}</div>
  <div class="divider"></div>
  <div class="datetime">${dateStr}  ${timeStr}</div>
  <div class="footer">Please wait for your<br>number to be called.</div>
</body>
</html>`;
}

export function registerPrintHandlers(): void {
  ipcMain.handle('print-ticket', async (_event, data: TicketData) => {
    const printerName = (settingsStore.get('printerName') ?? '').trim();
    const html = buildReceiptHtml(data);

    // Use the main window to print — avoids hidden-window print cancellation issues
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

    // Create an offscreen window (not hidden — positioned off-screen)
    // This avoids the "print job canceled" bug with show:false on some Windows setups
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

    // Show the window off-screen (some printer drivers require a visible window)
    printWindow.showInactive();

    try {
      await printWindow.loadURL(
        `data:text/html;charset=utf-8,${encodeURIComponent(html)}`,
      );

      // Give the renderer a moment to layout/paint
      await new Promise<void>((r) => setTimeout(r, 500));

      return await new Promise<void>((resolve, reject) => {
        printWindow.webContents.print(
          {
            silent: true,
            printBackground: true,
            margins: { marginType: 'none' },
            pageSize: { width: 80000, height: 297000 }, // 80mm x auto (microns)
            ...(printerName ? { deviceName: printerName } : {}),
          },
          (success, failureReason) => {
            if (success) {
              console.log('[print] Ticket printed successfully');
              resolve();
            } else {
              console.error('[print] Print failed:', failureReason);
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
