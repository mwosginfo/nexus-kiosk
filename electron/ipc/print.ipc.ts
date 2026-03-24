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

  const paperWidth = settingsStore.get('paperWidth') ?? '80mm';
  const contentWidth = paperWidth === '58mm' ? '54mm' : '76mm';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Queue Ticket</title>
<style>
  @page { size: ${paperWidth} auto; margin: 2mm; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: 'Courier New', monospace;
    width: ${contentWidth};
    text-align: center;
    padding: 4mm 2mm;
  }
  .header {
    font-size: 11pt;
    font-weight: bold;
    margin-bottom: 3mm;
    line-height: 1.3;
  }
  .divider {
    border-top: 1px dashed #000;
    margin: 3mm 0;
  }
  .queue-number {
    font-size: 48pt;
    font-weight: bold;
    letter-spacing: 2mm;
    margin: 4mm 0;
  }
  .service {
    font-size: 12pt;
    font-weight: bold;
    margin: 2mm 0;
  }
  .client {
    font-size: 10pt;
    margin: 2mm 0;
  }
  .datetime {
    font-size: 9pt;
    color: #333;
    margin: 2mm 0;
  }
  .footer {
    font-size: 8pt;
    color: #666;
    margin-top: 4mm;
  }
</style>
</head>
<body>
  <div class="header">Migrant Workers Office<br>Singapore</div>
  <div class="divider"></div>
  <div class="queue-number">${data.queueNumber}</div>
  <div class="service">${data.serviceType.replace(/_/g, ' ')}</div>
  <div class="client">${data.clientName}</div>
  <div class="divider"></div>
  <div class="datetime">${dateStr} ${timeStr}</div>
  <div class="footer">Please wait for your number to be called.</div>
</body>
</html>`;
}

export function registerPrintHandlers(): void {
  ipcMain.handle('print-ticket', async (_event, data: TicketData) => {
    const printerName = settingsStore.get('printerName') ?? '';
    const html = buildReceiptHtml(data);

    // Create a hidden window to render and print the receipt
    const printWindow = new BrowserWindow({
      show: false,
      width: 400,
      height: 600,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    await printWindow.loadURL(
      `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
    );

    return new Promise<void>((resolve, reject) => {
      printWindow.webContents.print(
        {
          silent: true,
          printBackground: true,
          ...(printerName ? { deviceName: printerName } : {}),
        },
        (success, failureReason) => {
          printWindow.close();
          if (success) {
            resolve();
          } else {
            reject(new Error(failureReason ?? 'Print failed'));
          }
        }
      );
    });
  });

  ipcMain.handle('get-printers', async () => {
    // We need a window reference to get printers
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
