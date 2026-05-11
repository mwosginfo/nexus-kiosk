//! Window state for kiosk vs receptionist mode.
//!
//! When `enabled` is true, the window enters fullscreen and drops decorations
//! and resizing — the kiosk hardware lock per CLAUDE.md §6.

use tauri::WebviewWindow;

#[tauri::command]
pub fn apply_kiosk_lock(window: WebviewWindow, enabled: bool) -> Result<(), String> {
    window.set_fullscreen(enabled).map_err(|e| e.to_string())?;
    window.set_decorations(!enabled).map_err(|e| e.to_string())?;
    window.set_resizable(!enabled).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn confirm_and_quit(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
    let app_handle = app.clone();
    app.dialog()
        .message("Are you sure you want to quit?")
        .title("Quit Nexus Kiosk")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Quit".to_string(),
            "Cancel".to_string(),
        ))
        .show(move |answer| {
            if answer {
                app_handle.exit(0);
            }
        });
    Ok(())
}
