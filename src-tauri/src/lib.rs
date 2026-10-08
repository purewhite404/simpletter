//! simpletter's native side: a handful of commands for the notes folder.
//! The UI (src/) is the same code that runs as Brighterm's Notes plugin;
//! src/standalone/tauriHost.ts maps its Host API onto these commands.

mod files;
mod folder_input;

use serde::Serialize;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_clipboard_manager::ClipboardExt;

/// What the UI keeps for a folder (Brighterm's `{ id, label }` handle; here the id is the path).
#[derive(Serialize)]
struct FolderHandle {
    id: String,
    label: String,
}

fn home(app: &AppHandle) -> PathBuf {
    app.path().home_dir().unwrap_or_default()
}

/// A typed / pasted / picked folder path → the folder, if it's one we can read.
#[tauri::command]
async fn open_folder(app: AppHandle, input: String) -> Result<FolderHandle, String> {
    let path = folder_input::open_folder(&input, &home(&app))?;
    Ok(FolderHandle { label: folder_input::label(&path), id: path.to_string_lossy().into_owned() })
}

/// Subfolders completing what's typed in the folder bar.
#[tauri::command]
async fn suggest_folders(app: AppHandle, input: String) -> Vec<String> {
    folder_input::suggest(&input, &home(&app))
}

#[tauri::command]
async fn list_files(dir: String) -> Result<Vec<files::FileEntry>, String> {
    files::list(&dir)
}

#[tauri::command]
async fn read_file(dir: String, name: String) -> Result<String, String> {
    files::read(&dir, &name)
}

#[tauri::command]
async fn write_file(dir: String, name: String, content: String) -> Result<(), String> {
    files::write(&dir, &name, &content)
}

#[tauri::command]
async fn delete_file(dir: String, name: String) -> Result<(), String> {
    files::delete(&dir, &name)
}

/// Puts the file's full path on the clipboard (works without window focus, unlike navigator.clipboard).
#[tauri::command]
async fn copy_path(app: AppHandle, dir: String, name: String) -> Result<(), String> {
    let path = files::inside(&dir, &name)?;
    app.clipboard()
        .write_text(path.to_string_lossy().into_owned())
        .map_err(|e| format!("クリップボードに書き込めません（{e}）"))
}

/// e2e tests (tests/e2e/) drive the real app over the Chrome DevTools Protocol. Debug builds only:
/// SIMPLETTER_TEST_DATA_DIR = a WebView2 profile of its own (settings, localStorage),
/// SIMPLETTER_TEST_CDP_PORT = where Playwright connects. The window opens off screen
/// without taking the focus, so the user's typing never lands in a test.
struct TestMode {
    data_dir: PathBuf,
    cdp_port: u16,
}

fn test_mode() -> Option<TestMode> {
    if !cfg!(debug_assertions) {
        return None;
    }
    Some(TestMode {
        data_dir: std::env::var_os("SIMPLETTER_TEST_DATA_DIR")?.into(),
        cdp_port: std::env::var("SIMPLETTER_TEST_CDP_PORT").ok()?.parse().ok()?,
    })
}

fn create_main_window(app: &tauri::App) -> tauri::Result<()> {
    let mut window = WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
        .title("simpletter")
        .inner_size(960.0, 680.0)
        .min_inner_size(320.0, 240.0);
    if let Some(test) = test_mode() {
        window = window
            .data_directory(test.data_dir)
            // wry's defaults (replaced by any args given) + CDP + no "hidden" while off screen.
            .additional_browser_args(&format!(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection,CalculateNativeWinOcclusion \
                 --remote-debugging-port={}",
                test.cdp_port
            ))
            .position(30000.0, 0.0)
            .focused(false);
    }
    window.build()?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| Ok(create_main_window(app)?))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            open_folder,
            suggest_folders,
            list_files,
            read_file,
            write_file,
            delete_file,
            copy_path
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
