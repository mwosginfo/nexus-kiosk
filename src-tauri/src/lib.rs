mod print;
mod window_ctl;

use tauri::Emitter;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

fn shortcut_toggle_settings() -> Shortcut {
    Shortcut::new(
        Some(Modifiers::CONTROL.union(Modifiers::SHIFT)),
        Code::KeyS,
    )
}

fn shortcut_quit() -> Shortcut {
    Shortcut::new(
        Some(Modifiers::CONTROL.union(Modifiers::SHIFT)),
        Code::KeyQ,
    )
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    let mods = Modifiers::CONTROL.union(Modifiers::SHIFT);
                    if shortcut.matches(mods, Code::KeyS) {
                        let _ = app.emit("toggle-settings", ());
                    } else if shortcut.matches(mods, Code::KeyQ) {
                        let _ = window_ctl::confirm_and_quit(app.clone());
                    }
                })
                .build(),
        )
        .invoke_handler(tauri::generate_handler![
            print::print_ticket,
            print::print_qr_ticket,
            print::get_printers,
            window_ctl::apply_kiosk_lock,
            window_ctl::confirm_and_quit,
        ])
        .setup(|app| {
            let gs = app.global_shortcut();
            gs.register(shortcut_toggle_settings())
                .expect("register toggle-settings shortcut");
            gs.register(shortcut_quit()).expect("register quit shortcut");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
