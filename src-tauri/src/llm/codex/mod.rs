pub mod detect;
pub mod process;
pub mod protocol;

use crate::llm::profiles::{request_options, ModelOptions};
use crate::llm::provider::{
    cancellable, emit_end_with_stats, emit_error, emit_token, CompletionStats, GenerationParams,
    LLMError, LLMMessage, LLMProvider, ModelInfo, TokenSink,
};
use process::CodexProcess;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::{future::Future, time::Duration};
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CodexModel {
    pub id: String,
    pub name: String,
    pub provider: String,
    pub context_window: Option<u64>,
    pub supported_reasoning_efforts: Vec<String>,
    pub input_modalities: Vec<String>,
    pub is_default: bool,
}

pub async fn models(server: &mut CodexProcess) -> Result<Vec<CodexModel>, LLMError> {
    let mut result = Vec::new();
    let mut cursor: Option<String> = None;
    for _ in 0..10 {
        let page = server
            .rpc(
                "model/list",
                json!({ "limit": 100, "includeHidden": false, "cursor": cursor }),
            )
            .await?;
        let data = page["data"]
            .as_array()
            .ok_or_else(|| LLMError::ProviderError("Codex model catalog is missing".into()))?;
        for model in data {
            let Some(id) = model["model"].as_str().or_else(|| model["id"].as_str()) else {
                continue;
            };
            result.push(CodexModel {
                id: id.into(),
                name: model["displayName"].as_str().unwrap_or(id).into(),
                provider: "codex_cli".into(),
                context_window: None,
                supported_reasoning_efforts: model["supportedReasoningEfforts"]
                    .as_array()
                    .map(|efforts| {
                        efforts
                            .iter()
                            .filter_map(|value| {
                                value["reasoningEffort"].as_str().map(str::to_owned)
                            })
                            .collect()
                    })
                    .unwrap_or_default(),
                input_modalities: model["inputModalities"]
                    .as_array()
                    .map(|values| {
                        values
                            .iter()
                            .filter_map(|value| value.as_str().map(str::to_owned))
                            .collect()
                    })
                    .unwrap_or_else(|| vec!["text".into(), "image".into()]),
                is_default: model["isDefault"].as_bool().unwrap_or(false),
            });
        }
        cursor = page["nextCursor"].as_str().map(str::to_owned);
        if cursor.is_none() {
            return Ok(result);
        }
    }
    Err(LLMError::ProviderError(
        "Codex model catalog pagination did not end".into(),
    ))
}

pub struct CodexCliProvider {
    process: Mutex<Option<CodexProcess>>,
}

impl CodexCliProvider {
    pub fn new() -> Self {
        Self {
            process: Mutex::new(None),
        }
    }

    async fn run(
        &self,
        messages: &[LLMMessage],
        model: &str,
        options: &ModelOptions,
        params: &GenerationParams,
        on_token: &mut (dyn FnMut(&str) + Send),
    ) -> Result<CompletionStats, LLMError> {
        let mut process = cancellable(params, self.process.lock()).await?;
        let started = std::time::Instant::now();
        let result = cancellable(
            params,
            tokio::time::timeout(Duration::from_secs(180), async {
                let thread_id =
                    prepare_turn(&mut process, messages, model, options, CodexProcess::spawn)
                        .await?;
                process
                    .as_mut()
                    .unwrap()
                    .complete_turn(
                        &thread_id,
                        messages,
                        model,
                        options,
                        &params.images,
                        on_token,
                    )
                    .await
            }),
        )
        .await;
        let result = match result {
            Ok(Ok(result)) => result.map(|mut stats| {
                stats.latency_ms = started.elapsed().as_millis() as u64;
                stats
            }),
            Ok(Err(_)) => Err(LLMError::ProviderError("Codex answer timed out".into())),
            Err(error) => Err(error),
        };
        if result.is_err() {
            // Dropping the child cancels the turn and removes any queued late tokens.
            *process = None;
        }
        result
    }
}

async fn prepare_turn<F: Future<Output = Result<CodexProcess, LLMError>>>(
    process: &mut Option<CodexProcess>,
    messages: &[LLMMessage],
    model: &str,
    options: &ModelOptions,
    mut spawn: impl FnMut() -> F,
) -> Result<String, LLMError> {
    let mut may_reconnect = true;
    loop {
        let result = async {
            if process.is_none() {
                *process = Some(spawn().await?);
            }
            process
                .as_mut()
                .unwrap()
                .prepare_thread(messages, model, options)
                .await
        }
        .await;
        match result {
            Err(LLMError::ConnectionFailed(_)) if may_reconnect => {
                // Only preparation is repeated. A submitted turn may have reached the model.
                *process = None;
                may_reconnect = false;
            }
            result => return result,
        }
    }
}

#[async_trait::async_trait]
impl LLMProvider for CodexCliProvider {
    fn provider_name(&self) -> &str {
        "codex_cli"
    }
    fn supports_images(&self) -> bool {
        true
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LLMError> {
        let mut guard = self.process.lock().await;
        if guard.is_none() {
            *guard = Some(CodexProcess::spawn().await?);
        }
        let result = models(guard.as_mut().unwrap()).await;
        if result.is_err() {
            *guard = None;
        }
        result.map(|values| {
            values
                .into_iter()
                .map(|model| ModelInfo {
                    id: model.id,
                    name: model.name,
                    provider: model.provider,
                    context_window: model.context_window,
                })
                .collect()
        })
    }

    async fn test_connection(&self) -> Result<bool, LLMError> {
        let mut guard = self.process.lock().await;
        if guard.is_none() {
            *guard = Some(CodexProcess::spawn().await?);
        }
        let result = guard
            .as_mut()
            .unwrap()
            .rpc("account/read", json!({"refreshToken": false}))
            .await;
        if result.is_err() {
            *guard = None;
        }
        result.map(|value| value["account"]["type"] == "chatgpt")
    }

    async fn stream_completion(
        &self,
        messages: Vec<LLMMessage>,
        model: &str,
        params: GenerationParams,
        app: tauri::AppHandle,
        sink: Option<TokenSink>,
    ) -> Result<CompletionStats, LLMError> {
        let options = request_options(&app, &params);
        let result = self
            .run(&messages, model, &options, &params, &mut |token| {
                emit_token(&app, &params, token, sink.as_ref())
            })
            .await;
        match result {
            Ok(stats) => {
                emit_end_with_stats(&app, &params, &stats);
                Ok(stats)
            }
            Err(LLMError::Cancelled) => Err(LLMError::Cancelled),
            Err(failure) => {
                emit_error(&app, &params, &failure.to_string());
                Err(failure)
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::llm::profiles::ModelOptions;
    use crate::llm::provider::LLMMessage;
    use serde_json::json;

    #[test]
    fn native_thread_is_ephemeral_and_answer_only_with_system_prompt_outside_task_data() {
        // Arrange
        let messages = vec![
            LLMMessage {
                role: "system".into(),
                content: "Technical interview".into(),
            },
            LLMMessage {
                role: "user".into(),
                content: "What if values are null?".into(),
            },
        ];
        // Act
        let request = protocol::thread_params(
            &messages,
            "model",
            std::path::Path::new("C:/empty"),
            &["externalServer".into()],
        );
        // Assert
        assert_eq!(
            request["config"]["mcp_servers"]["externalServer"]["enabled"],
            false
        );
        assert_eq!(
            request["config"]["mcp_servers"]["externalServer"]["command"],
            "nexq-disabled-mcp"
        );
        assert_eq!(request["ephemeral"], true);
        assert_eq!(request["approvalPolicy"], "never");
        assert_eq!(request["sandbox"], "read-only");
        assert_eq!(request["baseInstructions"], "Technical interview");
        assert!(request["developerInstructions"]
            .as_str()
            .unwrap()
            .contains("Do not use tools"));
    }

    #[test]
    fn turn_keeps_images_and_explicit_standard_with_a_separate_reasoning_level() {
        // Arrange
        let options = ModelOptions {
            reasoning_effort: Some("low".into()),
            service_tier: Some("default".into()),
        };
        let messages = vec![LLMMessage {
            role: "user".into(),
            content: "Translate this".into(),
        }];
        // Act
        let request = protocol::turn_params(
            "thread",
            &messages,
            &["data:image/png;base64,private".into()],
            "model",
            &options,
        );
        // Assert
        assert_eq!(request["effort"], "low");
        assert_eq!(request["serviceTierForTurn"], "default");
        assert_eq!(
            request["input"][1],
            json!({"type":"image","url":"data:image/png;base64,private"})
        );
        assert!(request["input"][0]["text"]
            .as_str()
            .unwrap()
            .contains("Translate this"));
    }

    #[test]
    fn process_overrides_disable_slow_agent_features_without_changing_global_config() {
        // Arrange
        // Act
        let args = process::launch_args();
        // Assert
        for required in [
            "features.shell_tool=false",
            "features.apps=false",
            "features.hooks=false",
            "features.memories=false",
            "features.multi_agent=false",
            "skills.include_instructions=false",
            "project_doc_max_bytes=0",
        ] {
            assert!(args.iter().any(|arg| arg == required), "missing {required}");
        }
        assert!(!args.iter().any(|arg| arg.contains("danger-full-access")));
    }

    #[test]
    fn npm_launcher_resolves_to_the_native_binary_instead_of_a_shell_script() {
        // Arrange
        let launcher = std::path::Path::new("C:/npm/codex.cmd");
        // Act
        let candidates = detect::npm_candidates(launcher);
        // Assert
        assert!(candidates
            .iter()
            .any(|path| path.to_string_lossy().contains("codex-win32-x64")));
        assert!(candidates
            .iter()
            .all(|path| path.extension().is_some_and(|ext| ext == "exe")));
    }
}

#[cfg(test)]
mod streaming_tests;
