//! simpletter's native side: a handful of commands for the notes folder.
//! The UI (src/) is the same code that runs as Brighterm's Notes plugin;
//! src/standalone/tauriHost.ts maps its Host API onto these commands.

mod files;
mod folder_input;
mod open_file;

use serde::Serialize;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, State, WebviewUrl, WebviewWindowBuilder};
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

/// A file to open from outside: its folder (as the folder bar would give it) and its name there.
#[derive(Serialize)]
struct OpenedFile {
    folder: FolderHandle,
    name: String,
}

/// The file this process was started with (a double-click in Explorer), until the UI takes it.
struct InitialFile(Mutex<Option<PathBuf>>);

/// The file given at launch, once (null afterwards, or if there was none).
#[tauri::command]
fn initial_file(state: State<'_, InitialFile>) -> Option<String> {
    let path = state.0.lock().ok()?.take()?;
    Some(path.to_string_lossy().into_owned())
}

/// A file's absolute path → its folder handle + name, if it's a file whose folder we can read.
#[tauri::command]
async fn open_path(app: AppHandle, path: String) -> Result<OpenedFile, String> {
    let (dir, name) = open_file::split(Path::new(&path))?;
    let dir = folder_input::open_folder(&dir.to_string_lossy(), &home(&app))?;
    Ok(OpenedFile {
        folder: FolderHandle { label: folder_input::label(&dir), id: dir.to_string_lossy().into_owned() },
        name,
    })
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
/// SIMPLETTER_TEST_CDP_PORT = where Playwright connects. The window shows off screen, without
/// taking the focus and without a taskbar button (`show_off_screen`): the user's typing never lands
/// in a test, and tests never cover the user's windows.
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
            .visible(false)
            .focused(false)
            .skip_taskbar(true);
    }
    let window = window.build()?;
    if test_mode().is_some() {
        show_off_screen(&window)?;
    }
    Ok(())
}

/// Shows the (hidden) test window past the right edge of every display, without activating it.
/// Not the builder's `.position()`: tao drops a position that is on no monitor and creates the
/// window at Windows' default place instead — on screen, in front. Not `show()`: once the window
/// exists tao forgets `focused(false)` and shows with SW_SHOW, which takes the focus.
/// Moving after creation (SetWindowPos) isn't clamped; called from `setup` (the main thread),
/// `set_position` is done before `ShowWindow`.
#[cfg(windows)]
fn show_off_screen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    #[link(name = "user32")]
    extern "system" {
        fn ShowWindow(hwnd: *mut std::ffi::c_void, cmd: i32) -> i32;
    }
    const SW_SHOWNOACTIVATE: i32 = 4;

    let monitors = window.available_monitors()?;
    let right = monitors.iter().map(|m| m.position().x + m.size().width as i32).max().unwrap_or(0);
    let top = monitors.iter().map(|m| m.position().y).min().unwrap_or(0);
    window.set_position(tauri::PhysicalPosition::new(right + 100, top))?;
    unsafe {
        ShowWindow(window.hwnd()?.0, SW_SHOWNOACTIVATE);
    }
    Ok(())
}

#[cfg(not(windows))]
fn show_off_screen(window: &tauri::WebviewWindow) -> tauri::Result<()> {
    window.show()
}

/// Another launch (a second double-click in Explorer) while this one runs: its file goes to
/// this window (the UI calls `open_path` with it) and the window comes to the front.
fn on_second_launch(app: &AppHandle, args: Vec<String>, cwd: String) {
    if let Some(path) = open_file::from_args(args, Path::new(&cwd)) {
        let _ = app.emit("open-file", path.to_string_lossy().into_owned());
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let cwd = std::env::current_dir().unwrap_or_default();
    let initial = open_file::from_args(std::env::args_os(), &cwd);

    let mut builder = tauri::Builder::default();
    // One window for every double-clicked file. Not in e2e tests: their exe would hand its
    // arguments to the user's running simpletter and quit (the plugin goes by the app's identifier).
    if test_mode().is_none() {
        builder = builder.plugin(tauri_plugin_single_instance::init(on_second_launch));
    }
    builder
        .manage(InitialFile(Mutex::new(initial)))
        .setup(|app| Ok(create_main_window(app)?))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .invoke_handler(tauri::generate_handler![
            open_folder,
            initial_file,
            open_path,
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
