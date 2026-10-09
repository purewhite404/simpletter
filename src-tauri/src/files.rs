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

/// Saves `content` as `name`. Never leaves a half-written note behind (a crash, a full disk, power lost):
/// the text goes to a temporary file next to it, which then takes the note's place in one step.
pub fn write(dir: &str, name: &str, content: &str) -> Result<(), String> {
    let path = inside(dir, name)?;
    let failed = |e: std::io::Error| format!("保存できません: {name}（{e}）");
    // A symlink would become a plain file: write through it, as before.
    if fs::symlink_metadata(&path).is_ok_and(|m| m.file_type().is_symlink()) {
        return fs::write(&path, content).map_err(failed);
    }
    let temp = temp_path(&path);
    if let Err(e) = write_new(&temp, content) {
        let _ = fs::remove_file(&temp);
        return Err(failed(e));
    }
    replace(&path, &temp).map_err(|e| {
        if path.exists() {
            let _ = fs::remove_file(&temp);
            failed(e)
        } else {
            // Half-way through a failed replace the note may be gone: then the temporary file is the only copy.
            format!("保存できません: {name}（{e}）。内容は {} にあります", temp.display())
        }
    })
}

/// A name next to `path` no other save uses (a hidden-ish dot name, not listed: it isn't .md/.csv/.tsv).
fn temp_path(path: &Path) -> PathBuf {
    use std::sync::atomic::{AtomicU32, Ordering};
    static COUNT: AtomicU32 = AtomicU32::new(0);
    let n = COUNT.fetch_add(1, Ordering::Relaxed);
    let name = path.file_name().unwrap_or_default().to_string_lossy();
    path.with_file_name(format!(".{name}.simpletter-{}-{n}.tmp", std::process::id()))
}

fn write_new(path: &Path, content: &str) -> std::io::Result<()> {
    use std::io::Write;
    let mut file = fs::File::create_new(path)?;
    file.write_all(content.as_bytes())?;
    file.sync_all() // on disk before it replaces the note
}

/// `temp` takes `path`'s place. Windows: ReplaceFileW keeps the note's own name (its case), attributes,
/// permissions and creation date; a note that doesn't exist yet (or a drive that can't) gets a plain rename.
#[cfg(windows)]
fn replace(path: &Path, temp: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn ReplaceFileW(
            replaced: *const u16,
            replacement: *const u16,
            backup: *const u16,
            flags: u32,
            exclude: *mut std::ffi::c_void,
            reserved: *mut std::ffi::c_void,
        ) -> i32;
    }
    const REPLACEFILE_IGNORE_MERGE_ERRORS: u32 = 0x2;
    const REPLACEFILE_IGNORE_ACL_ERRORS: u32 = 0x4;

    if !path.exists() {
        return fs::rename(temp, path);
    }
    // The note's name as it is on disk: the file takes the name it's given ("note.md" over "Note.md" would rename it).
    let real = fs::canonicalize(path).ok().and_then(|p| p.file_name().map(|n| path.with_file_name(n)));
    let path = real.as_deref().unwrap_or(path);
    let wide = |p: &Path| p.as_os_str().encode_wide().chain([0]).collect::<Vec<u16>>();
    let (replaced, replacement) = (wide(path), wide(temp));
    let flags = REPLACEFILE_IGNORE_MERGE_ERRORS | REPLACEFILE_IGNORE_ACL_ERRORS;
    // SAFETY: both paths are NUL-terminated UTF-16 that live past the call; the other pointers may be null.
    let ok = unsafe {
        ReplaceFileW(replaced.as_ptr(), replacement.as_ptr(), std::ptr::null(), flags, std::ptr::null_mut(), std::ptr::null_mut())
    };
    if ok != 0 {
        return Ok(());
    }
    // Some drives can't (network shares, FAT), or it stopped half-way (the note already moved away, the
    // temporary file not in its place yet): a rename puts the temporary file there, still in one step.
    let error = std::io::Error::last_os_error();
    fs::rename(temp, path).map_err(|_| error)
}

#[cfg(not(windows))]
fn replace(path: &Path, temp: &Path) -> std::io::Result<()> {
    fs::rename(temp, path)
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

    /// The folder's file names, sorted.
    fn names(dir: &Path) -> Vec<String> {
        let mut names: Vec<String> = fs::read_dir(dir).unwrap().map(|e| e.unwrap().file_name().to_string_lossy().into_owned()).collect();
        names.sort();
        names
    }

    #[test]
    fn overwrite_replaces_in_one_step_and_leaves_nothing_behind() {
        let dir = temp_dir("over");
        let d = dir.to_str().unwrap();
        write(d, "Note.md", "first, and longer").unwrap();
        write(d, "Note.md", "second").unwrap();
        assert_eq!(read(d, "Note.md").unwrap(), "second");
        assert_eq!(names(&dir), ["Note.md"]); // no temporary file left
        // Windows: the note keeps its own name when written under another case (as fs::write did).
        #[cfg(windows)]
        {
            write(d, "note.md", "third").unwrap();
            assert_eq!(names(&dir), ["Note.md"]);
            assert_eq!(read(d, "Note.md").unwrap(), "third");
        }
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    #[cfg(windows)] // elsewhere a read-only file in a writable folder may be replaced
    fn a_refused_write_keeps_the_note_and_leaves_nothing_behind() {
        let dir = temp_dir("ro");
        let d = dir.to_str().unwrap();
        let note = dir.join("locked.md");
        fs::write(&note, "kept").unwrap();
        let mut perms = fs::metadata(&note).unwrap().permissions();
        perms.set_readonly(true);
        fs::set_permissions(&note, perms.clone()).unwrap();
        let error = write(d, "locked.md", "lost").unwrap_err();
        assert!(error.starts_with("保存できません: locked.md"), "{error}");
        assert_eq!(fs::read_to_string(&note).unwrap(), "kept");
        assert_eq!(names(&dir), ["locked.md"]);
        #[allow(clippy::permissions_set_readonly_false)]
        perms.set_readonly(false);
        fs::set_permissions(&note, perms).unwrap();
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
