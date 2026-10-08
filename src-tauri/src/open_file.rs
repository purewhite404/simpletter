//! Opening a file from outside: Explorer starts `simpletter.exe "C:\…\note.md"` for a
//! double-clicked file (the installer's file association), and a second launch hands its
//! arguments to the running window (single instance). Errors are Japanese: the UI shows them.

use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};

/// The file a launch asks to open: the first argument after the exe that isn't an option,
/// made absolute against `cwd` (the launching process's folder). Not checked on disk here.
pub fn from_args<I>(args: I, cwd: &Path) -> Option<PathBuf>
where
    I: IntoIterator,
    I::Item: Into<OsString>,
{
    let arg = args
        .into_iter()
        .skip(1)
        .map(Into::into)
        .find(|a: &OsString| !a.is_empty() && !a.to_string_lossy().starts_with('-'))?;
    let path = PathBuf::from(arg);
    Some(if path.is_absolute() { path } else { cwd.join(path) })
}

/// A file's path → its folder and its name in it; Err if it isn't a file that exists.
pub fn split(path: &Path) -> Result<(PathBuf, String), String> {
    let shown = path.display();
    let meta = fs::metadata(path).map_err(|_| format!("ファイルが見つかりません: {shown}"))?;
    if meta.is_dir() {
        return Err(format!("フォルダではなくファイルを指定してください: {shown}"));
    }
    match (path.parent(), path.file_name()) {
        (Some(dir), Some(name)) if !dir.as_os_str().is_empty() => {
            Ok((dir.to_path_buf(), name.to_string_lossy().into_owned()))
        }
        _ => Err(format!("ファイルの場所がわかりません: {shown}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("simpletter-open-{name}-{}", std::process::id()));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn root() -> PathBuf {
        PathBuf::from(if cfg!(windows) { "C:\\work" } else { "/work" })
    }

    #[test]
    fn the_first_plain_argument_after_the_exe() {
        let abs = root().join("メモ.md");
        let args = ["simpletter.exe", "--flag", abs.to_str().unwrap(), "other.md"];
        assert_eq!(from_args(args, Path::new("/elsewhere")), Some(abs));
        assert_eq!(from_args(["simpletter.exe"], &root()), None);
        assert_eq!(from_args(["simpletter.exe", "-x", ""], &root()), None);
        assert_eq!(from_args(Vec::<String>::new(), &root()), None);
    }

    #[test]
    fn a_relative_argument_is_resolved_against_the_launch_folder() {
        assert_eq!(from_args(["simpletter.exe", "note.md"], &root()), Some(root().join("note.md")));
    }

    #[test]
    fn split_gives_the_folder_and_the_name() {
        let dir = temp_dir("split");
        let file = dir.join("日本語 メモ.md");
        fs::write(&file, "x").unwrap();
        assert_eq!(split(&file).unwrap(), (dir.clone(), "日本語 メモ.md".to_string()));
        assert!(split(&dir).unwrap_err().starts_with("フォルダではなくファイル"));
        assert!(split(&dir.join("missing.md")).unwrap_err().starts_with("ファイルが見つかりません"));
        fs::remove_dir_all(&dir).unwrap();
    }
}
