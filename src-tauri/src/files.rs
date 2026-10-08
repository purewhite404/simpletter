//! The notes folder's files. Every call gets the folder (an absolute path the
//! folder bar produced) and a file name inside it — never a path that leads
//! somewhere else. Errors are Japanese: the UI shows them as they are.

use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub is_directory: bool,
    /// When it was last changed, in ms since 1970 (0 if unknown).
    pub modified_at: u64,
}

/// `dir` + `name`, if `name` is one plain file name (no separators, no "..", not absolute).
pub fn inside(dir: &str, name: &str) -> Result<PathBuf, String> {
    let dir = Path::new(dir);
    if !dir.is_absolute() {
        return Err(format!("フォルダの指定が正しくありません: {}", dir.display()));
    }
    let mut components = Path::new(name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) if !name.contains(['/', '\\']) => Ok(dir.join(name)),
        _ => Err(format!("フォルダの外にはアクセスできません: {name}")),
    }
}

pub fn list(dir: &str) -> Result<Vec<FileEntry>, String> {
    let entries = fs::read_dir(dir).map_err(|e| format!("フォルダを読めません: {dir}（{e}）"))?;
    Ok(entries
        .filter_map(|entry| entry.ok())
        .map(|entry| {
            // Follows symlinks, like Node's statSync in Brighterm.
            let meta = fs::metadata(entry.path()).ok();
            FileEntry {
                name: entry.file_name().to_string_lossy().into_owned(),
                is_directory: meta.as_ref().is_some_and(|m| m.is_dir()),
                modified_at: meta
                    .and_then(|m| m.modified().ok())
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map_or(0, |d| d.as_millis() as u64),
            }
        })
        .collect())
}

pub fn read(dir: &str, name: &str) -> Result<String, String> {
    let path = inside(dir, name)?;
    let bytes = fs::read(&path).map_err(|e| format!("読み込めません: {name}（{e}）"))?;
    // NUL bytes near the start = not text (images, video, zip…). Reading those as UTF-8 only yields garbage.
    if bytes.iter().take(8000).any(|&b| b == 0) {
        return Err(format!("テキストではないファイルは開けません: {name}"));
    }
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

pub fn write(dir: &str, name: &str, content: &str) -> Result<(), String> {
    let path = inside(dir, name)?;
    fs::write(&path, content).map_err(|e| format!("保存できません: {name}（{e}）"))
}

pub fn delete(dir: &str, name: &str) -> Result<(), String> {
    let path = inside(dir, name)?;
    fs::remove_file(&path).map_err(|e| format!("削除できません: {name}（{e}）"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("simpletter-files-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_plain_names() {
        let dir = std::env::temp_dir();
        let dir = dir.to_str().unwrap();
        assert!(inside(dir, "note.md").is_ok());
        assert!(inside(dir, "note (2).md").is_ok());
        for bad in ["..", ".", "", "../x.md", "a/b.md", "a\\b.md", "/etc/passwd", "C:\\x.md"] {
            assert!(inside(dir, bad).is_err(), "{bad:?} must be refused");
        }
        // "C:x.md" = x.md in drive C's current folder, i.e. somewhere else.
        #[cfg(windows)]
        assert!(inside(dir, "C:x.md").is_err());
        assert!(inside("relative", "a.md").is_err());
    }

    #[test]
    fn write_read_list_delete() {
        let dir = temp_dir("rw");
        let d = dir.to_str().unwrap();
        write(d, "メモ.md", "# こんにちは\n").unwrap();
        fs::create_dir(dir.join("sub")).unwrap();
        assert_eq!(read(d, "メモ.md").unwrap(), "# こんにちは\n");
        let mut listed = list(d).unwrap();
        listed.sort_by(|a, b| a.name.cmp(&b.name));
        assert_eq!(listed.len(), 2);
        assert_eq!(listed[0].name, "sub");
        assert!(listed[0].is_directory);
        assert_eq!(listed[1].name, "メモ.md");
        assert!(!listed[1].is_directory);
        assert!(listed[1].modified_at > 1_600_000_000_000);
        delete(d, "メモ.md").unwrap();
        assert!(!dir.join("メモ.md").exists());
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn binary_is_refused() {
        let dir = temp_dir("bin");
        let d = dir.to_str().unwrap();
        fs::write(dir.join("a.png"), [0x89, b'P', b'N', b'G', 0, 0]).unwrap();
        assert!(read(d, "a.png").unwrap_err().starts_with("テキストではない"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
