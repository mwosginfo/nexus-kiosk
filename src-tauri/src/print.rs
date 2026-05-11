//! ESC/POS thermal printing for 80mm queue tickets.
//!
//! Layout mirrors the legacy Electron HTML print (80mm @page, 72mm content):
//!   header (1x bold)
//!   ──────────── divider 42ch ─────────────
//!   QUEUE NUMBER  (6x6 bold — matches the 56pt headline in HTML)
//!   service type  (2x bold)
//!   client name   (1x bold)
//!   ──────────── divider 42ch ─────────────
//!   date · time   (1x)
//!   footer        (1x)
//!
//! Bytes are crafted by hand (escape sequences are simple enough that pulling
//! in a builder crate isn't worth the dependency) and sent to the configured
//! Windows printer via the `printers` crate, which wraps winspool RAW jobs.

use chrono::{FixedOffset, Utc};
use printers::common::base::job::PrinterJobOptions;
use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketData {
    pub queue_number: String,
    pub client_name: String,
    pub service_type: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QrTicketData {
    pub title: String,
    pub qr_text: String,
    pub pra: String,
    pub fra: String,
    pub contract_count: u32,
    pub instructions: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PrinterInfo {
    pub name: String,
    pub is_default: bool,
}

const INIT: &[u8] = &[0x1B, 0x40];
const ALIGN_LEFT: &[u8] = &[0x1B, 0x61, 0x00];
const ALIGN_CENTER: &[u8] = &[0x1B, 0x61, 0x01];
const BOLD_ON: &[u8] = &[0x1B, 0x45, 0x01];
const BOLD_OFF: &[u8] = &[0x1B, 0x45, 0x00];
const SIZE_NORMAL: &[u8] = &[0x1D, 0x21, 0x00];
const FEED_AND_CUT: &[u8] = &[0x1D, 0x56, 0x42, 0x05];

/// 42-char divider — fills the printable width on a standard 80mm Epson/Star
/// thermal printer at default font A (12x24).
const DIVIDER: &[u8] = b"------------------------------------------\n";

fn size_cmd(width: u8, height: u8) -> [u8; 3] {
    let w = (width.saturating_sub(1)).min(7);
    let h = (height.saturating_sub(1)).min(7);
    let n = (w << 4) | h;
    [0x1D, 0x21, n]
}

fn sgt_now() -> (String, String) {
    let sgt = FixedOffset::east_opt(8 * 3600).expect("valid offset");
    let now = Utc::now().with_timezone(&sgt);
    (now.format("%d %b %Y").to_string(), now.format("%H:%M").to_string())
}

fn write_qr(out: &mut Vec<u8>, text: &str) {
    let bytes = text.as_bytes();
    let len = bytes.len() + 3;
    let pl = (len & 0xFF) as u8;
    let ph = ((len >> 8) & 0xFF) as u8;
    // Model 2
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00]);
    // Module size 8 dots
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x43, 0x08]);
    // Error correction level M (0x31)
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x45, 0x31]);
    // Store data
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, pl, ph, 0x31, 0x50, 0x30]);
    out.extend_from_slice(bytes);
    // Print
    out.extend_from_slice(&[0x1D, 0x28, 0x6B, 0x03, 0x00, 0x31, 0x51, 0x30]);
}

fn build_ticket(data: &TicketData) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(384);
    let (date, time) = sgt_now();

    out.extend_from_slice(INIT);
    out.extend_from_slice(ALIGN_CENTER);

    // Header — small bold (1x), matches the 11pt header in the Electron layout
    out.extend_from_slice(BOLD_ON);
    out.extend_from_slice(b"MIGRANT WORKERS OFFICE\n");
    out.extend_from_slice(b"SINGAPORE\n");
    out.extend_from_slice(BOLD_OFF);

    out.extend_from_slice(DIVIDER);

    // Queue number — 6x6 bold (~56pt-equivalent on a 180dpi 80mm printer)
    out.extend_from_slice(b"\n");
    out.extend_from_slice(&size_cmd(6, 6));
    out.extend_from_slice(BOLD_ON);
    out.extend_from_slice(data.queue_number.as_bytes());
    out.extend_from_slice(b"\n");
    out.extend_from_slice(SIZE_NORMAL);
    out.extend_from_slice(BOLD_OFF);
    out.extend_from_slice(b"\n");

    // Service type — 2x bold uppercase (mirrors .service in HTML)
    out.extend_from_slice(&size_cmd(2, 2));
    out.extend_from_slice(BOLD_ON);
    let service = data.service_type.replace('_', " ");
    out.extend_from_slice(service.as_bytes());
    out.extend_from_slice(b"\n");
    out.extend_from_slice(SIZE_NORMAL);
    out.extend_from_slice(BOLD_OFF);

    // Client name — 1x bold (mirrors .client)
    if !data.client_name.is_empty() {
        out.extend_from_slice(BOLD_ON);
        out.extend_from_slice(data.client_name.as_bytes());
        out.extend_from_slice(b"\n");
        out.extend_from_slice(BOLD_OFF);
    }

    out.extend_from_slice(DIVIDER);

    // Date / time — 1x
    out.extend_from_slice(format!("{date}   {time}\n", ).as_bytes());
    out.extend_from_slice(b"\n");

    // Footer
    out.extend_from_slice(b"Please wait for your number\n");
    out.extend_from_slice(b"to be called.\n");
    out.extend_from_slice(b"\n\n\n");
    out.extend_from_slice(FEED_AND_CUT);

    out
}

fn build_qr_ticket(data: &QrTicketData) -> Vec<u8> {
    let mut out: Vec<u8> = Vec::with_capacity(640);
    let (date, time) = sgt_now();

    out.extend_from_slice(INIT);
    out.extend_from_slice(ALIGN_CENTER);

    // Header
    out.extend_from_slice(BOLD_ON);
    out.extend_from_slice(b"MIGRANT WORKERS OFFICE\n");
    out.extend_from_slice(b"SINGAPORE\n");
    out.extend_from_slice(BOLD_OFF);

    // Title — 2x bold (e.g. "URGENT FRA REGISTRATION")
    out.extend_from_slice(&size_cmd(2, 2));
    out.extend_from_slice(BOLD_ON);
    out.extend_from_slice(data.title.as_bytes());
    out.extend_from_slice(b"\n");
    out.extend_from_slice(BOLD_OFF);
    out.extend_from_slice(SIZE_NORMAL);

    out.extend_from_slice(DIVIDER);
    out.extend_from_slice(b"\n");

    // Native QR
    write_qr(&mut out, &data.qr_text);
    out.extend_from_slice(b"\n");

    out.extend_from_slice(DIVIDER);

    // Meta block, left-aligned
    out.extend_from_slice(ALIGN_LEFT);
    out.extend_from_slice(BOLD_ON);
    out.extend_from_slice(format!("PRA:        {}\n", data.pra).as_bytes());
    out.extend_from_slice(format!("FRA:        {}\n", data.fra).as_bytes());
    out.extend_from_slice(format!("Contracts:  {}\n", data.contract_count).as_bytes());
    out.extend_from_slice(BOLD_OFF);
    out.extend_from_slice(b"\n");

    out.extend_from_slice(DIVIDER);

    // Instructions
    out.extend_from_slice(data.instructions.as_bytes());
    out.extend_from_slice(b"\n\n");

    // Footer datetime
    out.extend_from_slice(ALIGN_CENTER);
    out.extend_from_slice(format!("{date}   {time}\n", ).as_bytes());
    out.extend_from_slice(b"\n\n\n");
    out.extend_from_slice(FEED_AND_CUT);

    out
}

fn send_bytes(printer_name: &str, bytes: &[u8]) -> Result<(), String> {
    let target = if printer_name.trim().is_empty() {
        printers::get_default_printer()
            .ok_or_else(|| "No default printer configured on this system".to_string())?
    } else {
        printers::get_printer_by_name(printer_name)
            .ok_or_else(|| format!("Printer \"{printer_name}\" not found"))?
    };
    let opts = PrinterJobOptions {
        name: Some("Nexus Kiosk Ticket"),
        ..PrinterJobOptions::none()
    };
    target
        .print(bytes, opts)
        .map_err(|e| format!("Print failed: {e:?}"))?;
    Ok(())
}

#[tauri::command]
pub fn print_ticket(data: TicketData, printer_name: String) -> Result<(), String> {
    let bytes = build_ticket(&data);
    send_bytes(&printer_name, &bytes)
}

#[tauri::command]
pub fn print_qr_ticket(data: QrTicketData, printer_name: String) -> Result<(), String> {
    let bytes = build_qr_ticket(&data);
    send_bytes(&printer_name, &bytes)
}

#[tauri::command]
pub fn get_printers() -> Vec<PrinterInfo> {
    printers::get_printers()
        .into_iter()
        .map(|p| PrinterInfo {
            name: p.name.clone(),
            is_default: p.is_default,
        })
        .collect()
}
