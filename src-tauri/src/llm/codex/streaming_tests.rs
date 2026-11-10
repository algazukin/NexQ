use super::*;
use crate::llm::provider::CancelToken;
use std::sync::Arc;

async fn fake_server(leak: bool, stop_during_preparation: bool) -> CodexProcess {
    let mut command = tokio::process::Command::new("node");
    command.arg(
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("src/llm/codex/fixtures/fake_server.mjs"),
    );
    if leak {
        command.env("NEXQ_FAKE_MCP_LEAK", "1");
    }
    if stop_during_preparation {
        command.env("NEXQ_FAKE_STOP_DURING_PREPARATION", "1");
    }
    CodexProcess::start(command, std::env::temp_dir())
        .await
        .unwrap()
}

async fn fake_provider(leak: bool) -> CodexCliProvider {
    CodexCliProvider {
        process: Mutex::new(Some(fake_server(leak, false).await)),
    }
}

fn prompt(text: &str) -> Vec<LLMMessage> {
    vec![LLMMessage {
        role: "user".into(),
        content: text.into(),
    }]
}

#[tokio::test]
async fn warm_process_filters_old_events_and_isolates_each_ephemeral_request() {
    // Arrange
    let provider = fake_provider(false).await;
    let mut first = String::new();
    let mut second = String::new();
    // Act
    let stats = provider
        .run(
            &prompt("first"),
            "model",
            &ModelOptions::default(),
            &GenerationParams::default(),
            &mut |token| first.push_str(token),
        )
        .await
        .unwrap();
    provider
        .run(
            &prompt("second"),
            "model",
            &ModelOptions::default(),
            &GenerationParams::default(),
            &mut |token| second.push_str(token),
        )
        .await
        .unwrap();
    // Assert
    assert_eq!(first, "answer-1");
    assert_eq!(second, "answer-2");
    assert_eq!(stats.total_tokens, 13);
    assert!(provider.process.lock().await.is_some());
}

#[tokio::test]
async fn malformed_exit_tool_and_terminal_errors_discard_the_process() {
    // Arrange
    for input in ["MALFORMED", "EOF", "TOOL", "FAIL"] {
        let provider = fake_provider(false).await;
        // Act
        let result = provider
            .run(
                &prompt(input),
                "model",
                &ModelOptions::default(),
                &GenerationParams::default(),
                &mut |_| {},
            )
            .await;
        // Assert
        assert!(result.is_err(), "{input} must fail");
        assert!(
            provider.process.lock().await.is_none(),
            "{input} must discard stale state"
        );
    }
}

#[tokio::test]
async fn stop_cancels_a_silent_child_without_waiting_for_network_and_discards_late_events() {
    // Arrange
    let provider = fake_provider(false).await;
    let cancel = Arc::new(CancelToken::new());
    let params = GenerationParams {
        cancel: Some(cancel.clone()),
        ..Default::default()
    };
    let messages = prompt("HANG");
    let options = ModelOptions::default();
    let mut on_token = |_: &str| {};
    // Act
    let request = provider.run(&messages, "model", &options, &params, &mut on_token);
    let stopper = async {
        tokio::time::sleep(Duration::from_millis(25)).await;
        cancel.cancel();
    };
    let (result, _) = tokio::join!(request, stopper);
    // Assert
    assert!(matches!(result, Err(LLMError::Cancelled)));
    assert!(provider.process.lock().await.is_none());
}

#[tokio::test]
async fn empty_completed_answer_is_an_error_instead_of_relabeling_old_text() {
    // Arrange
    let provider = fake_provider(false).await;
    // Act
    let result = provider
        .run(
            &prompt("EMPTY"),
            "model",
            &ModelOptions::default(),
            &GenerationParams::default(),
            &mut |_| {},
        )
        .await;
    // Assert
    assert!(result.is_err());
    assert!(provider.process.lock().await.is_none());
}

#[tokio::test]
#[ignore = "uses the signed-in Codex account; run explicitly on artificial input only"]
async fn codex_cli_live_smoke_artificial() {
    // Arrange
    use base64::Engine;
    let provider = CodexCliProvider::new();
    let options = ModelOptions {
        reasoning_effort: Some("low".into()),
        service_tier: Some("default".into()),
    };
    let image = format!(
        "data:image/png;base64,{}",
        base64::engine::general_purpose::STANDARD.encode(include_bytes!("fixtures/code.png"))
    );
    let mut translation = String::new();
    let mut vision = String::new();
    // Act
    let first = tokio::time::timeout(
        Duration::from_secs(90),
        provider.run(
            &prompt(
                "Translate into Russian: The request was canceled. Return only the translation.",
            ),
            "gpt-6.1-sol",
            &options,
            &GenerationParams::default(),
            &mut |text| translation.push_str(text),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    let second = tokio::time::timeout(Duration::from_secs(90), provider.run(&prompt("Как сделать сравнение строк в этом коде без учёта регистра? Ответь одним предложением, указав подходящий comparer."), "gpt-6.1-sol", &options, &GenerationParams { images: vec![image], ..Default::default() }, &mut |text| vision.push_str(text))).await.unwrap().unwrap();
    let mut boosted = String::new();
    let boost_options = ModelOptions {
        reasoning_effort: Some("low".into()),
        service_tier: Some("priority".into()),
    };
    let third = tokio::time::timeout(
        Duration::from_secs(90),
        provider.run(
            &prompt("Translate into Russian: Ready. Return only the translation."),
            "gpt-6-luna",
            &boost_options,
            &GenerationParams::default(),
            &mut |text| boosted.push_str(text),
        ),
    )
    .await
    .unwrap()
    .unwrap();
    // Assert
    assert!(boosted
        .chars()
        .any(|character| ('а'..='я').contains(&character)));
    println!(
        "Separate Luna profile with explicit Boost: {} ms, {} chars",
        third.latency_ms,
        boosted.chars().count()
    );
    assert!(translation
        .chars()
        .any(|character| ('а'..='я').contains(&character)));
    assert!(vision.contains("OrdinalIgnoreCase"));
    println!(
        "Artificial translation: {} ms, {} chars; vision: {} ms, {} chars",
        first.latency_ms,
        translation.chars().count(),
        second.latency_ms,
        vision.chars().count()
    );
}

#[tokio::test]
async fn exposed_mcp_tools_prevent_generation_even_if_a_cli_override_is_ignored() {
    // Arrange
    let provider = fake_provider(true).await;
    let mut output = String::new();
    // Act
    let result = provider
        .run(
            &prompt("answer only"),
            "model",
            &ModelOptions::default(),
            &GenerationParams::default(),
            &mut |text| output.push_str(text),
        )
        .await;
    // Assert
    assert!(result.is_err());
    assert!(output.is_empty());
    assert!(provider.process.lock().await.is_none());
}

#[tokio::test]
async fn explicit_boost_enables_fast_capability_only_for_that_thread() {
    // Arrange
    let provider = fake_provider(false).await;
    let options = ModelOptions {
        reasoning_effort: Some("low".into()),
        service_tier: Some("priority".into()),
    };
    let mut output = String::new();
    // Act
    let result = provider
        .run(
            &prompt("boost request"),
            "model",
            &options,
            &GenerationParams::default(),
            &mut |text| output.push_str(text),
        )
        .await;
    // Assert
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(output, "answer-1");
}

#[tokio::test]
async fn codex_finishes_when_app_server_recovers_the_active_turn() {
    // Arrange
    let provider = fake_provider(false).await;
    let mut answer = String::new();

    // Act
    let result = provider
        .run(
            &prompt("RECONNECT_UPSTREAM"),
            "model",
            &ModelOptions::default(),
            &GenerationParams::default(),
            &mut |token| answer.push_str(token),
        )
        .await;

    // Assert
    assert!(result.is_ok(), "{result:?}");
    assert_eq!(answer, "answer-1");
}

#[tokio::test]
async fn terminal_error_explains_the_limit_without_echoing_the_payload() {
    // Arrange
    let provider = fake_provider(false).await;

    // Act
    let result = provider
        .run(
            &prompt("FAIL"),
            "model",
            &ModelOptions::default(),
            &GenerationParams::default(),
            &mut |_| {},
        )
        .await
        .unwrap_err()
        .to_string();

    // Assert
    assert!(result.contains("usage limit"), "{result}");
    assert!(!result.contains("private-image-data"), "{result}");
}

#[tokio::test]
async fn replaces_a_closed_process_before_submitting_the_turn() {
    // Arrange
    let mut process = Some(fake_server(false, true).await);
    let mut starts = 0;
    let messages = prompt("answer the synthetic screenshot");
    let options = ModelOptions::default();
    let mut answer = String::new();

    // Act
    let thread_id = prepare_turn(&mut process, &messages, "model", &options, || {
        starts += 1;
        async { Ok(fake_server(false, false).await) }
    })
    .await
    .unwrap();
    process
        .as_mut()
        .unwrap()
        .complete_turn(
            &thread_id,
            &messages,
            "model",
            &options,
            &[],
            &mut |token| answer.push_str(token),
        )
        .await
        .unwrap();

    // Assert
    assert_eq!(starts, 1);
    assert_eq!(answer, "answer-1");
}
