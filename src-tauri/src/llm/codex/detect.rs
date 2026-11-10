use std::path::{Path, PathBuf};

pub fn npm_candidates(launcher: &Path) -> Vec<PathBuf> {
    let Some(parent) = launcher.parent() else {
        return Vec::new();
    };
    let root = parent.join("node_modules").join("@openai").join("codex");
    [
        root.join(
            "node_modules/@openai/codex-win32-x64/vendor/x86_64-pc-windows-msvc/bin/codex.exe",
        ),
        root.join(
            "node_modules/@openai/codex-win32-arm64/vendor/aarch64-pc-windows-msvc/bin/codex.exe",
        ),
        root.join("vendor/x86_64-pc-windows-msvc/codex/codex.exe"),
    ]
    .into_iter()
    .collect()
}

pub fn find_codex_binary() -> Option<PathBuf> {
    if let Some(home) = std::env::var_os("USERPROFILE") {
        let native = PathBuf::from(home).join(".local/bin/codex.exe");
        if native.is_file() {
            return Some(native);
        }
    }
    let mut command = std::process::Command::new("where.exe");
    command.arg("codex");
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        command.creation_flags(0x0800_0000);
    }
    let output = command.output().ok()?;
    for line in String::from_utf8_lossy(&output.stdout).lines() {
        let path = PathBuf::from(line);
        if path
            .extension()
            .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
            && path.is_file()
        {
            return Some(path);
        }
        if let Some(native) = npm_candidates(&path)
            .into_iter()
            .find(|path| path.is_file())
        {
            return Some(native);
        }
    }
    None
}
