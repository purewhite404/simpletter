//! What the user types into the folder bar → an absolute folder path, and the
//! subfolders offered while typing. Ported from Brighterm's
//! `src/main/plugins/folderInput.ts` + `folderSuggest.ts`. Errors are Japanese:
//! the bar shows them as they are.

use std::fs;
use std::path::{Component, Path, PathBuf};

/// Only a guard against huge folders — the list scrolls, and every subfolder must be reachable.
const MAX_SUGGESTIONS: usize = 500;

const CASE_INSENSITIVE: bool = cfg!(any(windows, target_os = "macos"));
const SEP: char = std::path::MAIN_SEPARATOR;

fn is_sep(c: u8) -> bool {
    c == b'\\' || c == b'/'
}

fn is_bare_drive(text: &str) -> bool {
    let b = text.as_bytes();
    b.len() == 2 && b[0].is_ascii_alphabetic() && b[1] == b':'
}

/// Trims, drops the quotes Explorer's「パスのコピー」adds, expands "~" and a bare drive ("C:").
fn expand(input: &str, home: &Path) -> String {
    let mut text = input.trim();
    let bytes = text.as_bytes();
    if bytes.len() >= 2 && (bytes[0] == b'"' || bytes[0] == b'\'') && bytes[bytes.len() - 1] == bytes[0] {
        text = text[1..text.len() - 1].trim();
    }
    if text == "~" {
        return home.to_string_lossy().into_owned();
    }
    if text.starts_with("~/") || (cfg!(windows) && text.starts_with("~\\")) {
        return home.join(&text[2..]).to_string_lossy().into_owned();
    }
    if cfg!(windows) && is_bare_drive(text) {
        return format!("{text}\\");
    }
    text.to_string()
}

/// Absolute, and on Windows with a drive or a UNC share (not "\foo", which means "on the current drive").
fn is_full_path(text: &str) -> bool {
    let b = text.as_bytes();
    if cfg!(windows) {
        let drive = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && is_sep(b[2]);
        let unc = b.len() >= 3 && is_sep(b[0]) && is_sep(b[1]) && !is_sep(b[2]);
        drive || unc
    } else {
        text.starts_with('/')
    }
}

/// Drops "." and trailing separators, resolves ".." (never above the root) — without touching the disk.
fn clean(path: &Path) -> PathBuf {
    let mut out = PathBuf::new();
    for component in path.components() {
        match component {
            Component::CurDir => {}
            Component::ParentDir => {
                out.pop();
            }
            other => out.push(other.as_os_str()),
        }
    }
    out
}

/// The absolute folder path the input means; Err (in Japanese) if it can't be one.
pub fn normalize(input: &str, home: &Path) -> Result<PathBuf, String> {
    let text = expand(input, home);
    if text.is_empty() {
        return Err("フォルダのパスを入力してください".into());
    }
    if !is_full_path(&text) {
        let example = if cfg!(windows) { "C:\\Users\\名前\\Documents" } else { "/home/名前/Documents" };
        return Err(format!("フォルダは「{example}」のように、先頭からのパスで入力してください（~ はホームフォルダ）"));
    }
    Ok(clean(Path::new(&text)))
}

/// `normalize`, then checks it's a folder this app can read.
pub fn open_folder(input: &str, home: &Path) -> Result<PathBuf, String> {
    let path = normalize(input, home)?;
    let shown = path.display();
    let meta = fs::metadata(&path).map_err(|_| format!("フォルダが見つかりません: {shown}"))?;
    if !meta.is_dir() {
        return Err(format!("ファイルではなくフォルダを指定してください: {shown}"));
    }
    fs::read_dir(&path).map_err(|_| format!("このフォルダは開けません（アクセスが許可されていません）: {shown}"))?;
    Ok(path)
}

/// The folder's own name, as the handle's label ("C:\" for a drive).
pub fn label(path: &Path) -> String {
    path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| path.to_string_lossy().into_owned())
}

/// Where to look for completions: the folder typed so far and the start of the next name.
fn suggestion_query(input: &str, home: &Path) -> Option<(PathBuf, String)> {
    let text = expand(input, home);
    if text.is_empty() || !is_full_path(&text) {
        return None;
    }
    let cleaned = clean(Path::new(&text));
    if text.ends_with(['\\', '/']) || Path::new(&text) == home {
        return Some((cleaned, String::new()));
    }
    let prefix = cleaned.file_name()?.to_string_lossy().into_owned();
    Some((cleaned.parent()?.to_path_buf(), prefix))
}

/// Whether a folder name should be offered for the typed prefix (dot folders only when asked for).
fn matches_prefix(name: &str, prefix: &str) -> bool {
    if name.starts_with('.') && !prefix.starts_with('.') {
        return false;
    }
    if CASE_INSENSITIVE {
        name.to_lowercase().starts_with(&prefix.to_lowercase())
    } else {
        name.starts_with(prefix)
    }
}

/// A suggestion as the bar fills it in: the full path plus a separator, so the next Tab lists its subfolders.
fn with_trailing_separator(path: &Path) -> String {
    let mut text = path.to_string_lossy().into_owned();
    if !text.ends_with(SEP) {
        text.push(SEP);
    }
    text
}

/// What folder names sort by: natural-ish, case-insensitive ("2" before "10"), ties by the name itself.
fn sort_key(name: &str) -> (Vec<(u8, String, u64)>, String) {
    let mut parts = Vec::new();
    let mut chars = name.chars().peekable();
    while let Some(&c) = chars.peek() {
        let digits = c.is_ascii_digit();
        let mut run = String::new();
        while let Some(&d) = chars.peek() {
            if d.is_ascii_digit() != digits {
                break;
            }
            run.extend(d.to_lowercase());
            chars.next();
        }
        parts.push(if digits { (0, String::new(), run.parse().unwrap_or(u64::MAX)) } else { (1, run, 0) });
    }
    (parts, name.to_string())
}

/// Subfolders completing what's typed, as full paths ending in a separator. Called on
/// every keystroke, so it only reads names. Anything unreadable just yields nothing.
pub fn suggest(input: &str, home: &Path) -> Vec<String> {
    if input.trim().is_empty() {
        return vec![with_trailing_separator(home)];
    }
    let Some((dir, prefix)) = suggestion_query(input, home) else {
        return Vec::new();
    };
    let Ok(entries) = fs::read_dir(&dir) else {
        return Vec::new();
    };
    let mut names: Vec<String> = entries
        .filter_map(|entry| entry.ok())
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if !matches_prefix(&name, &prefix) {
                return None;
            }
            let file_type = entry.file_type().ok()?;
            let is_dir = file_type.is_dir() || (file_type.is_symlink() && entry.path().is_dir());
            is_dir.then_some(name)
        })
        .collect();
    names.sort_by_cached_key(|name| sort_key(name)); // each key built once, not per comparison
    names.truncate(MAX_SUGGESTIONS);
    names.into_iter().map(|name| with_trailing_separator(&dir.join(name))).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("simpletter-test-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn empty_input_is_an_error() {
        assert_eq!(normalize("   ", Path::new("/h")).unwrap_err(), "フォルダのパスを入力してください");
    }

    #[test]
    fn relative_input_is_explained() {
        assert!(normalize("Documents", Path::new("/h")).unwrap_err().contains("先頭からのパス"));
    }

    #[test]
    fn natural_order() {
        let mut names = vec!["note10", "Note2", "note1", "b"];
        names.sort_by_cached_key(|name| sort_key(name));
        assert_eq!(names, vec!["b", "note1", "Note2", "note10"]);
    }

    #[test]
    fn dot_folders_only_when_asked() {
        assert!(!matches_prefix(".git", ""));
        assert!(matches_prefix(".git", ".g"));
        assert!(matches_prefix("Notes", "No"));
    }

    #[test]
    fn open_folder_rejects_files_and_missing() {
        let dir = temp_dir("open");
        let file = dir.join("a.md");
        fs::write(&file, "x").unwrap();
        let home = Path::new("/");
        assert!(open_folder(&file.to_string_lossy(), home).unwrap_err().starts_with("ファイルではなくフォルダ"));
        let missing = dir.join("missing");
        assert!(open_folder(&missing.to_string_lossy(), home).unwrap_err().starts_with("フォルダが見つかりません"));
        let quoted = format!("\"{}\"", dir.display());
        assert_eq!(open_folder(&quoted, home).unwrap(), clean(&dir));
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn suggests_subfolders_only() {
        let dir = temp_dir("suggest");
        fs::create_dir(dir.join("Notes")).unwrap();
        fs::create_dir(dir.join("notes2")).unwrap();
        fs::create_dir(dir.join(".hidden")).unwrap();
        fs::write(dir.join("Notes.md"), "").unwrap();
        let typed = format!("{}{}no", dir.display(), SEP);
        let found = suggest(&typed, Path::new("/"));
        let names: Vec<String> = found.iter().map(|p| label(Path::new(p.trim_end_matches(SEP)))).collect();
        if CASE_INSENSITIVE {
            assert_eq!(names, vec!["Notes", "notes2"]);
        } else {
            assert_eq!(names, vec!["notes2"]);
        }
        assert!(found.iter().all(|p| p.ends_with(SEP)));
        let all = suggest(&format!("{}{}", dir.display(), SEP), Path::new("/"));
        assert_eq!(all.len(), 2, "no dot folders, no files: {all:?}");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn nothing_typed_offers_home() {
        let home = Path::new(if cfg!(windows) { "C:\\Users\\me" } else { "/home/me" });
        assert_eq!(suggest("", home), vec![with_trailing_separator(home)]);
    }

    #[cfg(windows)]
    #[test]
    fn windows_paths() {
        let home = Path::new("C:\\Users\\me");
        assert_eq!(normalize("C:", home).unwrap(), PathBuf::from("C:\\"));
        assert_eq!(normalize("~\\Notes\\", home).unwrap(), PathBuf::from("C:\\Users\\me\\Notes"));
        assert_eq!(normalize("C:/Users/me/./a/../Notes", home).unwrap(), PathBuf::from("C:\\Users\\me\\Notes"));
        assert_eq!(normalize("'C:\\x'", home).unwrap(), PathBuf::from("C:\\x"));
        assert!(normalize("\\foo", home).is_err(), "no drive");
        assert_eq!(label(Path::new("C:\\")), "C:\\");
        assert_eq!(label(Path::new("C:\\Users\\me\\Notes")), "Notes");
    }

    #[cfg(not(windows))]
    #[test]
    fn posix_paths() {
        let home = Path::new("/home/me");
        assert_eq!(normalize("~/Notes/", home).unwrap(), PathBuf::from("/home/me/Notes"));
        assert_eq!(normalize("/a/./b/../c", home).unwrap(), PathBuf::from("/a/c"));
    }
}
