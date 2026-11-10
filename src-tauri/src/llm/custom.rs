// Sub-PRD 5: User-configured custom endpoint with auto-detect SSE/NDJSON

use futures::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::time::Instant;

use super::provider::{
    cancellable, check_cancelled, emit_end, emit_error, emit_token, is_cancelled, CompletionStats,
    GenerationParams, LLMError, LLMMessage, LLMProvider, ModelInfo, TokenSink,
};
use super::stream_parser::{LineBuffer, NDJSONParser, SSEParser};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum CustomAuthType {
    None,
    Bearer,
    ApiKey,
}

#[derive(Debug, Clone)]
pub struct CustomConfig {
    pub base_url: String,
    pub auth_type: CustomAuthType,
    pub auth_value: Option<String>,
    pub auth_header: Option<String>,
}

pub struct CustomClient {
    config: CustomConfig,
    client: reqwest::Client,
}

impl CustomClient {
    pub fn new(config: CustomConfig) -> Self {
        Self {
            config,
            client: reqwest::Client::new(),
        }
    }

    /// Apply authentication to a request based on the configured auth type.
    fn apply_auth(&self, builder: reqwest::RequestBuilder) -> reqwest::RequestBuilder {
        match &self.config.auth_type {
            CustomAuthType::None => builder,
            CustomAuthType::Bearer => {
                if let Some(ref token) = self.config.auth_value {
                    builder.header("Authorization", format!("Bearer {}", token))
                } else {
                    builder
                }
            }
            CustomAuthType::ApiKey => {
                let header = self.config.auth_header.as_deref().unwrap_or("x-api-key");
                if let Some(ref key) = self.config.auth_value {
                    builder.header(header, key.as_str())
                } else {
                    builder
                }
            }
        }
    }

    /// Send a completion request, with legacy Ollama endpoint detection for text.
    async fn completion_response(
        &self,
        body: &serde_json::Value,
        params: &GenerationParams,
    ) -> Result<reqwest::Response, LLMError> {
        let url = format!("{}/chat/completions", self.config.base_url);
        let request = self
            .apply_auth(self.client.post(&url))
            .header("Content-Type", "application/json")
            .json(body);
        let response = cancellable(params, request.send()).await??;
        let response =
            if params.images.is_empty() && matches!(response.status().as_u16(), 404 | 405) {
                let url = format!("{}/api/chat", self.config.base_url);
                let fallback_body =
                    json!({"model": body["model"], "messages": body["messages"], "stream": true});
                let request = self
                    .apply_auth(self.client.post(&url))
                    .header("Content-Type", "application/json")
                    .json(&fallback_body);
                cancellable(params, request.send()).await??
            } else {
                response
            };
        if !response.status().is_success() {
            let status = response.status();
            // Image endpoints may echo request content. Keep raw images out of error events and the AI log.
            let message = if params.images.is_empty() {
                let body = cancellable(params, response.text())
                    .await?
                    .unwrap_or_default();
                format!("Custom endpoint request failed ({}): {}", status, body)
            } else {
                format!("Custom endpoint image request failed ({})", status)
            };
            check_cancelled(params)?;
            return Err(LLMError::ProviderError(message));
        }
        Ok(response)
    }

    /// Detect whether a stream is SSE or NDJSON and parse tokens accordingly.
    /// Returns (token_text, is_done).
    fn try_extract_token(line: &str) -> Vec<(Option<String>, bool)> {
        let mut results = Vec::new();

        // Try SSE format first
        let sse_events = SSEParser::parse_chunk(line);
        if !sse_events.is_empty() {
            for event in sse_events {
                match event {
                    Some(data) => {
                        // Try OpenAI-compat format
                        if let Some(token) = SSEParser::extract_openai_token(&data) {
                            results.push((Some(token), false));
                            continue;
                        }
                        // Try Anthropic format
                        if let Some(token) = SSEParser::extract_anthropic_token(&data) {
                            results.push((Some(token), false));
                            continue;
                        }
                        // Try Gemini format
                        if let Some(token) = SSEParser::extract_gemini_token(&data) {
                            results.push((Some(token), false));
                            continue;
                        }
                        // Unknown SSE format - try generic text extraction
                        if let Some(text) = data.get("text").and_then(|t| t.as_str()) {
                            results.push((Some(text.to_string()), false));
                            continue;
                        }
                        if let Some(content) = data.get("content").and_then(|t| t.as_str()) {
                            results.push((Some(content.to_string()), false));
                        }
                    }
                    None => {
                        // [DONE]
                        results.push((None, true));
                    }
                }
            }
            return results;
        }

        // Try NDJSON format
        let ndjson_events = NDJSONParser::parse_chunk(line);
        for data in ndjson_events {
            if NDJSONParser::is_ollama_done(&data) {
                results.push((None, true));
                continue;
            }
            // Try Ollama format
            if let Some(token) = NDJSONParser::extract_ollama_token(&data) {
                results.push((Some(token), false));
                continue;
            }
            // Try generic extraction
            if let Some(text) = data.get("text").and_then(|t| t.as_str()) {
                results.push((Some(text.to_string()), false));
                continue;
            }
            if let Some(content) = data.get("content").and_then(|t| t.as_str()) {
                results.push((Some(content.to_string()), false));
                continue;
            }
            // Try OpenAI format in NDJSON (some servers do this)
            if let Some(token) = SSEParser::extract_openai_token(&data) {
                results.push((Some(token), false));
            }
        }

        results
    }
}

#[async_trait::async_trait]
impl LLMProvider for CustomClient {
    fn provider_name(&self) -> &str {
        "custom"
    }

    fn supports_images(&self) -> bool {
        true
    }

    async fn list_models(&self) -> Result<Vec<ModelInfo>, LLMError> {
        // Try OpenAI-compatible /models endpoint
        let url = format!("{}/models", self.config.base_url);
        let request = self.apply_auth(self.client.get(&url));

        match request.send().await {
            Ok(response) if response.status().is_success() => {
                let body: serde_json::Value = response.json().await?;
                let models = body
                    .get("data")
                    .and_then(|d| d.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|m| {
                                let id = m.get("id")?.as_str()?.to_string();
                                Some(ModelInfo {
                                    id: id.clone(),
                                    name: m
                                        .get("name")
                                        .and_then(|n| n.as_str())
                                        .unwrap_or(&id)
                                        .to_string(),
                                    provider: "custom".to_string(),
                                    context_window: None,
                                })
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                Ok(models)
            }
            _ => {
                // Try Ollama-compatible /api/tags endpoint
                let url = format!("{}/api/tags", self.config.base_url);
                let request = self.apply_auth(self.client.get(&url));

                match request.send().await {
                    Ok(response) if response.status().is_success() => {
                        let body: serde_json::Value = response.json().await?;
                        let models = body
                            .get("models")
                            .and_then(|m| m.as_array())
                            .map(|arr| {
                                arr.iter()
                                    .filter_map(|m| {
                                        let name = m.get("name")?.as_str()?.to_string();
                                        Some(ModelInfo {
                                            id: name.clone(),
                                            name: name.clone(),
                                            provider: "custom".to_string(),
                                            context_window: None,
                                        })
                                    })
                                    .collect()
                            })
                            .unwrap_or_default();
                        Ok(models)
                    }
                    _ => {
                        // Return empty list - user can type model name manually
                        Ok(vec![])
                    }
                }
            }
        }
    }

    async fn test_connection(&self) -> Result<bool, LLMError> {
        // Try /models first (OpenAI-compat)
        let url = format!("{}/models", self.config.base_url);
        let request = self.apply_auth(self.client.get(&url));
        if let Ok(resp) = request.send().await {
            if resp.status().is_success() {
                return Ok(true);
            }
        }

        // Try /api/tags (Ollama-compat)
        let url = format!("{}/api/tags", self.config.base_url);
        let request = self.apply_auth(self.client.get(&url));
        if let Ok(resp) = request.send().await {
            if resp.status().is_success() {
                return Ok(true);
            }
        }

        // Try a simple GET to the base URL
        let request = self.apply_auth(self.client.get(&self.config.base_url));
        match request.send().await {
            Ok(resp) => Ok(resp.status().is_success()),
            Err(_) => Ok(false),
        }
    }

    async fn stream_completion(
        &self,
        messages: Vec<LLMMessage>,
        model: &str,
        params: GenerationParams,
        app_handle: tauri::AppHandle,
        sink: Option<TokenSink>,
    ) -> Result<CompletionStats, LLMError> {
        let start = Instant::now();

        let msgs = super::vision::openai_messages(&messages, &params.images).map_err(|error| {
            emit_error(&app_handle, &params, &error.to_string());
            error
        })?;

        let mut body = json!({
            "model": model,
            "messages": msgs,
            "stream": true
        });

        super::profiles::apply_http_options(&mut body, &super::profiles::request_options(&app_handle, &params));
        if let Some(temp) = params.temperature {
            body["temperature"] = json!(temp);
        }
        if let Some(max_tok) = params.max_tokens {
            body["max_tokens"] = json!(max_tok);
        }

        // NOTE: llm_stream_start is emitted by IntelligenceEngine::generate_assist()
        // with the correct mode. Do NOT emit it here — it would overwrite the mode.

        let response = self
            .completion_response(&body, &params)
            .await
            .map_err(|error| {
                emit_error(&app_handle, &params, &error.to_string());
                error
            })?;

        let mut stream = response.bytes_stream();
        let mut line_buffer = LineBuffer::new();
        let mut token_count: u64 = 0;

        while let Some(chunk_result) = cancellable(&params, stream.next()).await? {
            check_cancelled(&params)?;
            let chunk = chunk_result.map_err(|e| {
                if is_cancelled(&params) {
                    return LLMError::Cancelled;
                }
                emit_error(&app_handle, &params, &e.to_string());
                LLMError::HttpError(e)
            })?;

            let chunk_str = String::from_utf8_lossy(&chunk);
            let lines = line_buffer.push(&chunk_str);

            for line in lines {
                let extractions = Self::try_extract_token(&line);
                for (maybe_token, _is_done) in extractions {
                    if let Some(token) = maybe_token {
                        if !token.is_empty() {
                            token_count += 1;
                            check_cancelled(&params)?;
                            emit_token(&app_handle, &params, &token, sink.as_ref());
                        }
                    }
                }
            }
        }

        // Flush remaining
        if let Some(remaining) = line_buffer.flush() {
            let extractions = Self::try_extract_token(&remaining);
            for (maybe_token, _is_done) in extractions {
                if let Some(token) = maybe_token {
                    if !token.is_empty() {
                        token_count += 1;
                        check_cancelled(&params)?;
                        emit_token(&app_handle, &params, &token, sink.as_ref());
                    }
                }
            }
        }

        let latency_ms = start.elapsed().as_millis() as u64;
        let stats = CompletionStats {
            prompt_tokens: 0,
            completion_tokens: token_count,
            total_tokens: token_count,
            latency_ms,
        };

        check_cancelled(&params)?;
        emit_end(&app_handle, &params, token_count, latency_ms);

        Ok(stats)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{
        atomic::{AtomicUsize, Ordering},
        Arc,
    };
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    async fn endpoint(
        status: u16,
    ) -> (CustomClient, Arc<AtomicUsize>, tokio::task::JoinHandle<()>) {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base_url = format!("http://{}", listener.local_addr().unwrap());
        let requests = Arc::new(AtomicUsize::new(0));
        let observed = requests.clone();
        let server = tokio::spawn(async move {
            for code in [status, 200] {
                let (mut socket, _) = listener.accept().await.unwrap();
                let mut request = Vec::new();
                let mut chunk = [0; 4096];
                loop {
                    let read = socket.read(&mut chunk).await.unwrap();
                    if read == 0 {
                        break;
                    }
                    request.extend_from_slice(&chunk[..read]);
                    if let Some(header_end) =
                        request.windows(4).position(|part| part == b"\r\n\r\n")
                    {
                        let headers = String::from_utf8_lossy(&request[..header_end]);
                        let length = headers
                            .lines()
                            .find_map(|line| {
                                let (name, value) = line.split_once(':')?;
                                name.eq_ignore_ascii_case("content-length")
                                    .then(|| {
                                        value
                                            .strip_prefix(' ')
                                            .unwrap_or(value)
                                            .parse::<usize>()
                                            .ok()
                                    })
                                    .flatten()
                            })
                            .unwrap_or(0);
                        if request.len() >= header_end + 4 + length {
                            break;
                        }
                    }
                }
                observed.fetch_add(1, Ordering::SeqCst);
                let body =
                    r#"{"error":{"message":"upstream failure data:image/png;base64,private"}}"#;
                let response = format!(
                    "HTTP/1.1 {code} Test\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                socket.write_all(response.as_bytes()).await.unwrap();
            }
        });
        let client = CustomClient::new(CustomConfig {
            base_url,
            auth_type: CustomAuthType::None,
            auth_value: None,
            auth_header: None,
        });
        (client, requests, server)
    }

    #[tokio::test]
    async fn image_requests_never_retry_as_ollama() {
        // Arrange
        let (client, requests, server) = endpoint(404).await;
        let params = GenerationParams {
            images: vec!["data:image/png;base64,private".into()],
            ..Default::default()
        };
        let body = json!({"model":"vision-model", "messages":[], "stream":true});

        // Act
        let result = client.completion_response(&body, &params).await;
        server.abort();

        // Assert
        let error = result.unwrap_err().to_string();
        assert!(error.contains("404"), "{error}");
        assert!(!error.contains("private"));
        assert_eq!(requests.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn text_requests_preserve_auth_rate_limit_and_server_failures() {
        // Arrange
        for status in [401, 429, 503] {
            let (client, requests, server) = endpoint(status).await;
            let params = GenerationParams::default();
            let body = json!({"model":"text-model", "messages":[], "stream":true});

            // Act
            let result = client.completion_response(&body, &params).await;
            server.abort();

            // Assert
            let error = result.unwrap_err().to_string();
            assert!(error.contains(&status.to_string()), "{error}");
            assert!(error.contains("upstream failure"), "{error}");
            assert_eq!(requests.load(Ordering::SeqCst), 1);
        }
    }

    #[tokio::test]
    async fn text_requests_retry_unsupported_openai_endpoints_as_ollama() {
        // Arrange
        for status in [404, 405] {
            let (client, requests, server) = endpoint(status).await;
            let body = json!({"model":"text-model", "messages":[], "stream":true});

            // Act
            let result = client
                .completion_response(&body, &GenerationParams::default())
                .await;
            server.abort();

            // Assert
            assert!(result.unwrap().status().is_success());
            assert_eq!(requests.load(Ordering::SeqCst), 2);
        }
    }
}
