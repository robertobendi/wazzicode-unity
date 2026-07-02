pub mod bridge;
pub mod claude;
pub mod commands;
pub mod error;
pub mod mcpconfig;
pub mod pathutil;
pub mod proc;
pub mod state;
pub mod store;

use crate::state::AppState;
use crate::store::{config_dir, settings};

/// Wrap the default panic hook so any panic — including ones inside
/// `spawn_blocking` workers or PTY reader threads (added in later phases) —
/// lands in the log file (and stderr, for early-startup panics before the
/// logger is set up).
fn install_panic_hook() {
    let default = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        let backtrace = std::backtrace::Backtrace::force_capture();
        log::error!("panic: {info}\nbacktrace:\n{backtrace}");
        eprintln!("panic: {info}\nbacktrace:\n{backtrace}");
        default(info);
    }));
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    install_panic_hook();

    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(
            tauri_plugin_log::Builder::default()
                // File under ~/Library/Logs/<id>/ (macOS), %LOCALAPPDATA% (Win),
                // ~/.local/share/<id>/logs/ (Linux) — Tauri's app_log_dir.
                .targets([
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::LogDir {
                        file_name: None,
                    }),
                    tauri_plugin_log::Target::new(tauri_plugin_log::TargetKind::Stdout),
                ])
                .level(if cfg!(debug_assertions) {
                    log::LevelFilter::Debug
                } else {
                    log::LevelFilter::Info
                })
                .max_file_size(5 * 1024 * 1024)
                .rotation_strategy(tauri_plugin_log::RotationStrategy::KeepAll)
                .build(),
        )
        .setup(|app| {
            use tauri::Manager;
            let cfg_dir = config_dir().expect("could not create config dir");
            let initial = settings::load(&cfg_dir).unwrap_or_default();
            app.manage(AppState::new(cfg_dir, initial));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::settings::get_settings,
            commands::settings::update_settings,
            commands::settings::ping,
            commands::project::validate_unity_project,
            commands::project::set_current_project,
            commands::chat::chat_send,
            commands::chat::chat_cancel,
            commands::status::status_start,
            commands::status::status_stop,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
