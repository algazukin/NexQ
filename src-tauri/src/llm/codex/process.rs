use super::{detect, protocol};
use crate::llm::profiles::ModelOptions;
use crate::llm::provider::{CompletionStats, LLMError, LLMMessage};
use serde_json::{json, Value};
use std::collections::VecDeque;
use std::path::PathBuf;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};

pub fn launch_args() -> Vec<String> {
    let mut args = vec!["app-server".into()];
    for option in [
        "model_provider=\"openai\"",
        "web_search=\"disabled\"",
        "project_doc_max_bytes=0",
        "skills.include_instructions=false",
        "features.shell_tool=false",
        "features.apps=false",
        "features.hooks=false",
        "features.memories=false",
        "features.multi_agent=false",
        "features.multi_agent_v2=false",
        "features.skill_search=false",
        "features.browser_use=false",
        "features.computer_use=false",
        "features.image_generation=false",
        "features.view_image=false",
        "features.code_mode=false",
        "features.code_mode_host=false",
        "plugins._default.enabled=false",
    ] {
        args.extend(["-c".into(), option.into()]);
    }
    args
}

pub fn sandbox_dir() -> PathBuf {
    std::env::var_os("LOCALAPPDATA")
        .map(PathBuf::from)
        .unwrap_or_else(std::env::temp_dir)
        .join("NexQ")
        .join("codex-sandbox")
}

pub struct CodexProcess {
    _child: Child,
    input: ChildStdin,
    output: BufReader<ChildStdout>,
    pending: VecDeque<Value>,
    next_id: u64,
    pub version: String,
    cwd: PathBuf,
    disabled_mcp: Vec<String>,
}

fn error(message: impl std::fmt::Display) -> LLMError {
    LLMError::ProviderError(format!("Codex CLI: {message}"))
}

fn transport_error(message: impl std::fmt::Display) -> LLMError {
    LLMError::ConnectionFailed(format!("Codex CLI: {message}"))
}

fn turn_failure(failure: &Value) -> LLMError {
    let info = &failure["codexErrorInfo"];
    let message = match info.as_str() {
        Some("unauthorized") => {
            return LLMError::AuthError("Codex CLI: sign in with ChatGPT again".into())
        }
        Some("usageLimitExceeded" | "sessionBudgetExceeded") => "the usage limit was reached",
        Some("rateLimitExceeded") => "the rate limit was reached",
        Some("contextWindowExceeded") => "the request exceeds the model's context window",
        Some("badRequest") => "the model rejected the request parameters",
        Some("flexUnavailable" | "serverOverloaded") => {
            "the selected service tier or model is temporarily unavailable"
        }
        Some("cyberPolicy" | "misalignmentPolicyViolation" | "tooManyDenials") => {
            "the request was declined"
        }
        Some("sandboxError") => {
            "the answer-only session could not run under the configured restrictions"
        }
        _ if [
            "httpConnectionFailed",
            "responseStreamConnectionFailed",
            "responseStreamDisconnected",
            "responseTooManyFailedAttempts",
        ]
        .iter()
        .any(|key| info.get(key).is_some()) =>
        {
            return transport_error("the connection to the model was lost");
        }
        _ => "the model stopped before completing the answer",
    };
    // Raw errors can include request data such as a screenshot data URL.
    error(message)
}

impl CodexProcess {
    pub async fn spawn() -> Result<Self, LLMError> {
        let binary = tokio::task::spawn_blocking(detect::find_codex_binary)
            .await
            .map_err(error)?
            .ok_or_else(|| error("not installed; install Codex CLI and sign in with ChatGPT"))?;
        let mut command = Command::new(binary);
        command.args(launch_args());
        Self::start(command, sandbox_dir()).await
    }

    pub(crate) async fn start(mut command: Command, cwd: PathBuf) -> Result<Self, LLMError> {
        tokio::fs::create_dir_all(&cwd).await.map_err(error)?;
        command
            .current_dir(&cwd)
            .kill_on_drop(true)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        for variable in ["OPENAI_API_KEY", "OPENAI_BASE_URL", "CODEX_API_KEY"] {
            command.env_remove(variable);
        }
        #[cfg(windows)]
        command.creation_flags(0x0800_0000);
        let mut child = command.spawn().map_err(error)?;
        let input = child
            .stdin
            .take()
            .ok_or_else(|| error("stdin unavailable"))?;
        let output = BufReader::new(
            child
                .stdout
                .take()
                .ok_or_else(|| error("stdout unavailable"))?,
        );
        let mut server = Self {
            _child: child,
            input,
            output,
            pending: VecDeque::new(),
            next_id: 1,
            version: String::new(),
            cwd,
            disabled_mcp: Vec::new(),
        };
        let initialized = server.rpc("initialize", json!({ "clientInfo": { "name": "nexq", "version": env!("CARGO_PKG_VERSION") }, "capabilities": { "experimentalApi": true } })).await?;
        server.version = initialized["userAgent"]
            .as_str()
            .unwrap_or("Codex CLI")
            .to_string();
        server
            .send(json!({ "method": "initialized", "params": {} }))
            .await?;
        // Read names only through the official metadata API, never the user's config/auth files.
        let mut cursor: Option<String> = None;
        for page in 0..10 {
            let result = server
                .rpc(
                    "mcpServerStatus/list",
                    json!({ "limit": 100, "cursor": cursor, "detail": "toolsAndAuthOnly" }),
                )
                .await?;
            let names = result["data"]
                .as_array()
                .ok_or_else(|| error("MCP metadata unavailable; update Codex CLI"))?;
            server.disabled_mcp.extend(
                names
                    .iter()
                    .filter_map(|entry| entry["name"].as_str().map(str::to_owned)),
            );
            cursor = result["nextCursor"].as_str().map(str::to_owned);
            if cursor.is_none() {
                break;
            }
            if page == 9 {
                return Err(error("MCP metadata pagination did not end"));
            }
        }
        Ok(server)
    }

    async fn send(&mut self, value: Value) -> Result<(), LLMError> {
        let mut bytes = serde_json::to_vec(&value).map_err(error)?;
        bytes.push(b'\n');
        self.input
            .write_all(&bytes)
            .await
            .map_err(|_| transport_error("failed to write to app-server"))?;
        self.input
            .flush()
            .await
            .map_err(|_| transport_error("failed to flush app-server input"))
    }

    async fn read(&mut self) -> Result<Value, LLMError> {
        const MAX_FRAME: u64 = 4 * 1024 * 1024;
        let mut bytes = Vec::new();
        let count = (&mut self.output)
            .take(MAX_FRAME + 1)
            .read_until(b'\n', &mut bytes)
            .await
            .map_err(|_| transport_error("failed to read from app-server"))?;
        if count == 0 {
            return Err(transport_error("app-server closed its output"));
        }
        if count as u64 > MAX_FRAME {
            return Err(error("app-server response exceeded the frame limit"));
        }
        serde_json::from_slice(&bytes).map_err(|_| error("invalid JSON from app-server"))
    }

    async fn reject_tool_request(&mut self, message: &Value) -> Result<bool, LLMError> {
        if message.get("method").is_some() && message.get("id").is_some() {
            self.send(json!({ "id": message["id"], "error": { "code": -32601, "message": "NexQ is answer-only; client tools are disabled" } })).await?;
            return Ok(true);
        }
        Ok(false)
    }

    pub async fn rpc(&mut self, method: &str, params: Value) -> Result<Value, LLMError> {
        let id = self.next_id;
        self.next_id += 1;
        tokio::time::timeout(Duration::from_secs(30), async {
            self.send(json!({ "id": id, "method": method, "params": params }))
                .await?;
            loop {
                let message = self.read().await?;
                if self.reject_tool_request(&message).await? {
                    continue;
                }
                if message["id"] == id {
                    if let Some(failure) = message.get("error") {
                        if failure["data"]["reason"] == "serverShuttingDown" {
                            return Err(transport_error("app-server is shutting down"));
                        }
                        let code = failure["code"].as_i64().unwrap_or(0);
                        return Err(error(format!("{method} was rejected (RPC code {code})")));
                    }
                    return Ok(message["result"].clone());
                }
                if message["method"].as_str().is_some_and(|method| {
                    method.starts_with("item/")
                        || method.starts_with("turn/")
                        || method == "thread/tokenUsage/updated"
                        || method == "error"
                }) {
                    if self.pending.len() >= 128 {
                        return Err(error("too many events before an RPC response"));
                    }
                    self.pending.push_back(message);
                }
            }
        })
        .await
        .map_err(|_| transport_error(format!("{method} timed out")))?
        .map_err(|failure| match failure {
            LLMError::ConnectionFailed(message) => {
                LLMError::ConnectionFailed(format!("{message} ({method})"))
            }
            failure => failure,
        })
    }

    pub async fn prepare_thread(
        &mut self,
        messages: &[LLMMessage],
        model: &str,
        options: &ModelOptions,
    ) -> Result<String, LLMError> {
        let mut thread_params =
            protocol::thread_params(messages, model, &self.cwd, &self.disabled_mcp);
        if options.service_tier.as_deref() == Some("priority") {
            // Enable the CLI capability only for an explicit Boost selection.
            thread_params["config"]["features.fast_mode"] = json!(true);
        }
        let thread = self.rpc("thread/start", thread_params).await?;
        let thread_id = thread["thread"]["id"]
            .as_str()
            .ok_or_else(|| error("thread ID missing"))?
            .to_string();
        // Validate the effective thread, since global/managed MCP configuration can
        // differ from the discovered names. No model request starts with exposed tools.
        let mut cursor: Option<String> = None;
        for page in 0..10 {
            let status = self
                .rpc(
                    "mcpServerStatus/list",
                    json!({ "limit": 100, "threadId": thread_id, "cursor": cursor, "detail": "toolsAndAuthOnly" }),
                )
                .await?;
            let servers = status["data"]
                .as_array()
                .ok_or_else(|| error("MCP thread status unavailable"))?;
            for server in servers {
                let count = server["tools"]
                    .as_object()
                    .map(|tools| tools.len())
                    .or_else(|| server["tools"].as_array().map(|tools| tools.len()))
                    .ok_or_else(|| error("MCP tool status unavailable; update Codex CLI"))?;
                if count != 0 {
                    return Err(error("external tools remain enabled for this thread; reconnect Codex or check managed CLI configuration"));
                }
            }
            cursor = status["nextCursor"].as_str().map(str::to_owned);
            if cursor.is_none() {
                break;
            }
            if page == 9 {
                return Err(error("MCP thread status pagination did not end"));
            }
        }
        Ok(thread_id)
    }

    pub async fn complete_turn(
        &mut self,
        thread_id: &str,
        messages: &[LLMMessage],
        model: &str,
        options: &ModelOptions,
        images: &[String],
        on_token: &mut (dyn FnMut(&str) + Send),
    ) -> Result<CompletionStats, LLMError> {
        let turn = self
            .rpc(
                "turn/start",
                protocol::turn_params(thread_id, messages, images, model, options),
            )
            .await?;
        let turn_id = turn["turn"]["id"]
            .as_str()
            .ok_or_else(|| error("turn ID missing"))?
            .to_string();
        let mut received_text = false;
        let mut stats = CompletionStats {
            prompt_tokens: 0,
            completion_tokens: 0,
            total_tokens: 0,
            latency_ms: 0,
        };
        loop {
            let event = if let Some(event) = self.pending.pop_front() {
                event
            } else {
                self.read().await?
            };
            if self.reject_tool_request(&event).await? {
                return Err(error("a tool call was requested in answer-only mode"));
            }
            let params = &event["params"];
            if params["threadId"].as_str() != Some(thread_id) {
                continue;
            }
            match event["method"].as_str().unwrap_or("") {
                "item/agentMessage/delta" if params["turnId"].as_str() == Some(&turn_id) => {
                    if let Some(delta) = params["delta"].as_str() {
                        received_text |= !delta.is_empty();
                        on_token(delta);
                    }
                }
                "thread/tokenUsage/updated" => {
                    let usage = &params["tokenUsage"]["last"];
                    stats.prompt_tokens = usage["inputTokens"].as_u64().unwrap_or(0);
                    stats.completion_tokens = usage["outputTokens"].as_u64().unwrap_or(0);
                    stats.total_tokens = usage["totalTokens"]
                        .as_u64()
                        .unwrap_or(stats.prompt_tokens + stats.completion_tokens);
                }
                "item/started" => {
                    let kind = params["item"]["type"].as_str().unwrap_or("");
                    if !["userMessage", "agentMessage", "reasoning"].contains(&kind) {
                        return Err(error(format!(
                            "unexpected {kind} activity in answer-only mode"
                        )));
                    }
                }
                "error" if params["turnId"].as_str() == Some(&turn_id) => {
                    if params["willRetry"] != true {
                        return Err(turn_failure(&params["error"]));
                    }
                }
                "turn/completed" if params["turn"]["id"].as_str() == Some(&turn_id) => {
                    if params["turn"]["status"] != "completed" {
                        return Err(turn_failure(&params["turn"]["error"]));
                    }
                    break;
                }
                _ => {}
            }
        }
        let _ = self
            .rpc("thread/unsubscribe", json!({"threadId": thread_id}))
            .await;
        if !received_text {
            return Err(error("the model returned an empty answer"));
        }
        Ok(stats)
    }
}
