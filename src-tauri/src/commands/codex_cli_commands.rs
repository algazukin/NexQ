use crate::llm::codex::{detect::find_codex_binary, models, process::CodexProcess, CodexModel};
use serde::Serialize;
use serde_json::json;
use tauri::command;

#[derive(Serialize)]
pub struct CodexCliStatus {
    installed: bool,
    authenticated: bool,
    auth_type: Option<String>,
    plan: Option<String>,
    version: Option<String>,
    binary_path: Option<String>,
    error: Option<String>,
}

#[command]
pub async fn codex_cli_status() -> Result<CodexCliStatus, String> {
    let binary = tokio::task::spawn_blocking(find_codex_binary)
        .await
        .map_err(|error| error.to_string())?;
    let Some(binary) = binary else {
        return Ok(CodexCliStatus {
            installed: false,
            authenticated: false,
            auth_type: None,
            plan: None,
            version: None,
            binary_path: None,
            error: None,
        });
    };
    let mut status = CodexCliStatus {
        installed: true,
        authenticated: false,
        auth_type: None,
        plan: None,
        version: None,
        binary_path: Some(binary.to_string_lossy().into_owned()),
        error: None,
    };
    match CodexProcess::spawn().await {
        Ok(mut server) => {
            status.version = Some(server.version.clone());
            match server
                .rpc("account/read", json!({ "refreshToken": false }))
                .await
            {
                Ok(account) => {
                    status.auth_type = account["account"]["type"].as_str().map(str::to_owned);
                    status.plan = account["account"]["planType"].as_str().map(str::to_owned);
                    status.authenticated = status.auth_type.as_deref() == Some("chatgpt");
                }
                Err(error) => status.error = Some(error.to_string()),
            }
        }
        Err(error) => status.error = Some(error.to_string()),
    }
    Ok(status)
}

#[command]
pub async fn codex_cli_models() -> Result<Vec<CodexModel>, String> {
    let mut server = CodexProcess::spawn()
        .await
        .map_err(|error| error.to_string())?;
    models(&mut server).await.map_err(|error| error.to_string())
}

#[command]
pub async fn open_codex_login_terminal() -> Result<(), String> {
    let binary = tokio::task::spawn_blocking(find_codex_binary)
        .await
        .map_err(|error| error.to_string())?
        .ok_or("Install Codex CLI first")?;
    let directory = binary.parent().ok_or("Codex binary directory missing")?;
    let mut command = std::process::Command::new("cmd.exe");
    command.current_dir(directory);
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        // User clicked Login: open a visible terminal, keeping paths out of shell text.
        command
            .raw_arg(r#"/d /c start "Codex login" cmd.exe /d /k codex.exe login"#)
            .creation_flags(0x0800_0000);
    }
    command
        .spawn()
        .map(|_| ())
        .map_err(|error| error.to_string())
}
