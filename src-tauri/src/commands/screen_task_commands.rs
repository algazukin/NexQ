use tauri::{command, AppHandle, Emitter, State};

use super::intelligence_commands::compose_instructions;
use crate::llm::provider::{
    cancellable, emit_error, is_cancelled, GenerationParams, LLMError, StreamStartPayload,
};
use crate::llm::vision::{screen_task_messages, ScreenAction, ScreenConversation};
use crate::screen_capture::ScreenCaptureState;
use crate::state::AppState;

/// Solve or review the capture through the active provider, without OCR or RAG calls.
#[command]
pub async fn generate_screen_task(
    capture_id: String,
    brief: Option<bool>,
    action: Option<ScreenAction>,
    request_id: String,
    transcript: Option<String>,
    conversation: Option<ScreenConversation>,
    app_handle: AppHandle,
    state: State<'_, AppState>,
    capture_state: State<'_, ScreenCaptureState>,
) -> Result<(), String> {
    let action = action.unwrap_or_default();
    let mut params = GenerationParams {
        request_id: Some(request_id.clone()),
        ..Default::default()
    };

    let prepared = (|| {
        if request_id.chars().all(char::is_whitespace) {
            return Err("A screen task request ID is required".to_string());
        }
        let intelligence = state
            .intelligence
            .as_ref()
            .ok_or_else(|| "Intelligence engine not initialized".to_string())?;
        let (guard, instructions, temperature) = {
            let engine = intelligence
                .lock()
                .map_err(|error| format!("Failed to lock intelligence engine: {error}"))?;
            let guard = engine
                .begin_generation(&request_id)
                .ok_or_else(|| "Generation already in progress".to_string())?;
            params.cancel = Some(guard.cancel_token());
            let configs = engine.get_action_configs();
            let instructions =
                compose_instructions(&configs.instruction_presets, &configs.custom_instructions);
            (guard, instructions, configs.global_defaults.temperature)
        };
        let (provider, model, provider_name) = {
            let llm = state
                .llm
                .as_ref()
                .ok_or_else(|| "LLM router not initialized".to_string())?;
            let router = llm
                .lock()
                .map_err(|error| format!("Failed to lock LLM router: {error}"))?;
            let model = router.active_model().to_string();
            if model.chars().all(char::is_whitespace) {
                return Err(
                    "Select an image-capable model in AI settings before solving a screenshot"
                        .to_string(),
                );
            }
            let provider = router.get_provider().map_err(|error| error.to_string())?;
            let name = router
                .active_provider_type()
                .map(|kind| kind.display_name().to_string())
                .unwrap_or_else(|| "Unknown".to_string());
            (provider, model, name)
        };
        let image = capture_state.task_image(&capture_id)?;
        Ok((
            guard,
            instructions,
            temperature,
            provider,
            model,
            provider_name,
            image,
        ))
    })();

    let (_generation_guard, instructions, temperature, provider, model, provider_name, image) =
        match prepared {
            Ok(prepared) => prepared,
            Err(error) => {
                emit_error(&app_handle, &params, &error);
                return Err(error);
            }
        };
    let cancel_token = _generation_guard.cancel_token();
    params.temperature = Some(temperature);
    params.images = vec![image];

    // The shared provider may be finishing an internal request; Stop still interrupts the wait.
    let provider = match cancellable(&params, provider.lock()).await {
        Ok(provider) => provider,
        Err(LLMError::Cancelled) => return Ok(()),
        Err(error) => {
            emit_error(&app_handle, &params, &error.to_string());
            return Err(error.to_string());
        }
    };
    if is_cancelled(&params) {
        return Ok(());
    }
    if !provider.supports_images() {
        let error = format!(
            "The active {provider_name} provider does not support screenshot tasks. Select a Custom or OpenAI-compatible provider with an image-capable model."
        );
        emit_error(&app_handle, &params, &error);
        return Err(error);
    }

    let messages = screen_task_messages(
        transcript.as_deref(),
        &instructions,
        brief,
        action,
        conversation.as_ref(),
    );
    let include_transcript = transcript
        .as_deref()
        .is_some_and(|text| text.chars().any(|character| !character.is_whitespace()));
    let _ = app_handle.emit(
        "llm_stream_start",
        StreamStartPayload {
            mode: if action == ScreenAction::Review {
                "CodeReview"
            } else {
                "ScreenTask"
            }
            .to_string(),
            model: model.clone(),
            provider: provider_name,
            system_prompt: messages[0].content.clone(),
            user_prompt: messages[1].content.clone(),
            include_transcript,
            include_rag: false,
            include_instructions: !instructions.is_empty(),
            include_question: true,
            temperature,
            rag_query: None,
            rag_chunks: Vec::new(),
            rag_chunks_filtered: 0,
            rag_total_candidates: 0,
            transcript_window_seconds: 0,
            transcript_segments_count: 0,
            transcript_segments_total: 0,
            request_id: Some(request_id),
            session_key: None,
            scope_label: None,
        },
    );

    // Providers emit token/end/error events; cancellation already emitted its end event.
    match provider
        .stream_completion(messages, &model, params, app_handle, None)
        .await
    {
        Ok(_) | Err(LLMError::Cancelled) => Ok(()),
        Err(_) if cancel_token.is_cancelled() => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
