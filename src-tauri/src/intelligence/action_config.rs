use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use super::prompt_templates;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActionConfig {
    pub id: String,
    pub name: String,
    pub mode: String,
    pub visible: bool,
    pub system_prompt: String,
    pub is_default_prompt: bool,

    pub include_transcript: bool,
    pub include_rag_chunks: bool,
    pub include_custom_instructions: bool,
    pub include_detected_question: bool,

    /// Enable provider-native web search/grounding for this action (Gemini google_search, OpenRouter :online).
    #[serde(default)]
    pub web_search: bool,

    pub transcript_window_seconds: Option<u64>,
    pub rag_top_k: Option<usize>,
    pub temperature: Option<f64>,

    pub is_built_in: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct GlobalDefaults {
    pub transcript_window_seconds: u64,
    pub rag_top_k: usize, // Legacy: retained for deserialization of old configs. Superseded by RagConfig.top_k.
    pub temperature: f64,
    pub auto_trigger: bool,
}

impl Default for GlobalDefaults {
    fn default() -> Self {
        Self {
            transcript_window_seconds: 300,
            rag_top_k: 5,
            temperature: 0.3,
            auto_trigger: true,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct InstructionPresets {
    pub tone: Option<String>,
    pub format: Option<String>,
    pub length: Option<String>,
    pub opinion: Option<String>,
}

impl Default for InstructionPresets {
    fn default() -> Self {
        Self {
            tone: None,
            format: None,
            length: None,
            opinion: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
#[serde(default)]
pub struct AllActionConfigs {
    pub global_defaults: GlobalDefaults,
    pub custom_instructions: String,
    pub instruction_presets: InstructionPresets,
    pub actions: HashMap<String, ActionConfig>,
}

impl Default for AllActionConfigs {
    fn default() -> Self {
        let mut actions = HashMap::new();

        actions.insert(
            "Assist".to_string(),
            ActionConfig {
                id: "Assist".to_string(),
                name: "Assist".to_string(),
                mode: "Assist".to_string(),
                visible: true,
                system_prompt: prompt_templates::ASSIST_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: true,
                include_custom_instructions: true,
                include_detected_question: true,
                web_search: false,
                transcript_window_seconds: None,
                rag_top_k: None,
                temperature: None,

                is_built_in: true,
            },
        );

        actions.insert(
            "WhatToSay".to_string(),
            ActionConfig {
                id: "WhatToSay".to_string(),
                name: "Say".to_string(),
                mode: "WhatToSay".to_string(),
                visible: true,
                system_prompt: prompt_templates::WHAT_TO_SAY_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: false,
                include_custom_instructions: true,
                include_detected_question: true,
                web_search: false,
                transcript_window_seconds: Some(60),
                rag_top_k: None,
                temperature: None,

                is_built_in: true,
            },
        );

        actions.insert(
            "Shorten".to_string(),
            ActionConfig {
                id: "Shorten".to_string(),
                name: "Short".to_string(),
                mode: "Shorten".to_string(),
                visible: true,
                system_prompt: prompt_templates::SHORTEN_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: false,
                include_custom_instructions: true,
                include_detected_question: true,
                web_search: false,
                transcript_window_seconds: Some(30),
                rag_top_k: None,
                temperature: None,

                is_built_in: true,
            },
        );

        actions.insert(
            "FollowUp".to_string(),
            ActionConfig {
                id: "FollowUp".to_string(),
                name: "F/U".to_string(),
                mode: "FollowUp".to_string(),
                visible: true,
                system_prompt: prompt_templates::FOLLOW_UP_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: false,
                include_custom_instructions: true,
                include_detected_question: false,
                web_search: false,
                transcript_window_seconds: None,
                rag_top_k: None,
                temperature: None,

                is_built_in: true,
            },
        );

        actions.insert(
            "Recap".to_string(),
            ActionConfig {
                id: "Recap".to_string(),
                name: "Recap".to_string(),
                mode: "Recap".to_string(),
                visible: true,
                system_prompt: prompt_templates::RECAP_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: false,
                include_custom_instructions: false,
                include_detected_question: false,
                web_search: false,
                transcript_window_seconds: Some(0), // 0 = all transcript
                rag_top_k: None,
                temperature: None,

                is_built_in: true,
            },
        );

        actions.insert(
            "AskQuestion".to_string(),
            ActionConfig {
                id: "AskQuestion".to_string(),
                name: "Ask".to_string(),
                mode: "AskQuestion".to_string(),
                visible: true,
                system_prompt: prompt_templates::ASK_QUESTION_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: true,
                include_custom_instructions: true,
                include_detected_question: false,
                web_search: true,
                transcript_window_seconds: None,
                rag_top_k: None,
                temperature: None,

                is_built_in: true,
            },
        );

        actions.insert(
            "ActionItemsExtraction".to_string(),
            ActionConfig {
                id: "ActionItemsExtraction".to_string(),
                name: "Actions".to_string(),
                mode: "ActionItemsExtraction".to_string(),
                visible: false, // Internal mode — not shown in overlay action bar
                system_prompt: prompt_templates::ACTION_ITEMS_EXTRACTION_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: false,
                include_custom_instructions: false,
                include_detected_question: false,
                web_search: false,
                transcript_window_seconds: Some(0), // 0 = all transcript (need full meeting)
                rag_top_k: None,
                temperature: Some(0.1), // Low temperature for structured JSON output
                is_built_in: true,
            },
        );

        actions.insert(
            "BookmarkSuggestions".to_string(),
            ActionConfig {
                id: "BookmarkSuggestions".to_string(),
                name: "Bookmarks".to_string(),
                mode: "BookmarkSuggestions".to_string(),
                visible: false, // Internal mode — not shown in overlay action bar
                system_prompt: prompt_templates::BOOKMARK_SUGGESTIONS_PROMPT.to_string(),
                is_default_prompt: true,
                include_transcript: true,
                include_rag_chunks: false,
                include_custom_instructions: false,
                include_detected_question: false,
                web_search: false,
                transcript_window_seconds: Some(0), // 0 = all transcript (need full meeting)
                rag_top_k: None,
                temperature: Some(0.1), // Low temperature for structured JSON output
                is_built_in: true,
            },
        );

        Self {
            global_defaults: GlobalDefaults::default(),
            custom_instructions: include_str!("../../../src/lib/defaultInterviewInstructions.txt").to_string(),
            instruction_presets: InstructionPresets::default(),
            actions,
        }
    }
}


/// Resolve an action without discarding its explicit custom prompt.
pub fn action_system_prompt(mode: &str, action: Option<&ActionConfig>, scenario: &str) -> String {
    // A saved default Assist is a fallback, not an explicit override of the
    // scenario selected for this meeting. Other actions keep their own intent.
    if mode == "Assist" && !scenario.is_empty() && action.is_none_or(|config| config.is_default_prompt) {
        return scenario.to_string();
    }
    action.map(|config| config.system_prompt.clone()).unwrap_or_else(|| {
        if scenario.is_empty() {
            prompt_templates::get_system_prompt(mode).to_string()
        } else {
            scenario.to_string()
        }
    })
}

/// Dedicated transient actions: never overwrite a saved Assist configuration.
pub fn hint_action_config(mode: &str) -> Option<ActionConfig> {
    let prompt = match mode {
        "Hint" => "Give a compact live interview hint in the language of the question. Use C#/.NET for programming questions. Output one direct main statement followed by at most two short bullet points, no more than 50 words total. For a coding task, give the algorithm, complexity and one edge case. Do not output a full code solution, preamble, alternatives, brainstorming or verification commentary. These compact formatting rules override longer response defaults. If context is insufficient, ask one short clarification instead of inventing details.",
        "HintDetails" => prompt_templates::INTERVIEW_DETAILS_PROMPT,
        _ => return None,
    };
    Some(ActionConfig {
        id: mode.to_string(), name: mode.to_string(), mode: mode.to_string(),
        visible: false, system_prompt: format!("{}\n\n{}", prompt_templates::TECHNICAL_INTERVIEW_PROMPT, prompt), is_default_prompt: true,
        include_transcript: true, include_rag_chunks: false,
        include_custom_instructions: true, include_detected_question: true,
        web_search: false, transcript_window_seconds: Some(if mode == "Hint" { 60 } else { 120 }),
        rag_top_k: None, temperature: None, is_built_in: true,
    })
}

#[cfg(test)]
mod hint_tests {
    use super::*;

    #[test]
    fn hint_profiles_skip_slow_context_and_keep_custom_instructions() {
        // Arrange
        let modes = ["Hint", "HintDetails"];
        // Act
        let configs: Vec<_> = modes.iter().map(|mode| hint_action_config(mode)).collect();
        // Assert
        for config in configs {
            let config = config.expect("hint profile must exist");
            assert!(!config.include_rag_chunks);
            assert!(!config.web_search);
            assert!(config.include_custom_instructions);
            assert!(config.include_transcript);
            assert!(config.system_prompt.contains("C#"));
        }
    }

    #[test]
    fn short_hint_has_an_explicit_output_contract() {
        // Arrange
        let mode = "Hint";
        // Act
        let config = hint_action_config(mode).expect("hint profile must exist");
        // Assert
        assert!(config.system_prompt.contains("50 words"));
        assert!(config.system_prompt.contains("two short"));
        assert_eq!(config.transcript_window_seconds, Some(60));
        assert!(hint_action_config("Assist").is_none());
    }

    #[test]
    fn default_assist_uses_the_selected_interview_scenario() {
        // Arrange
        let configs = AllActionConfigs::default();
        let scenario = "Only answer programming questions; ignore background stories.";
        // Act
        let prompt = action_system_prompt("Assist", configs.actions.get("Assist"), scenario);
        // Assert
        assert_eq!(prompt, scenario);
    }

    #[test]
    fn a_custom_assist_prompt_and_other_action_modes_keep_their_intent() {
        // Arrange
        let mut configs = AllActionConfigs::default();
        let assist = configs.actions.get_mut("Assist").unwrap();
        assist.is_default_prompt = false;
        assist.system_prompt = "Explicit custom action.".to_string();
        let scenario = "Technical interview.";
        // Act
        let custom = action_system_prompt("Assist", configs.actions.get("Assist"), scenario);
        let recap = action_system_prompt("Recap", configs.actions.get("Recap"), scenario);
        let no_scenario = action_system_prompt("Assist", AllActionConfigs::default().actions.get("Assist"), "");
        // Assert
        assert_eq!(custom, "Explicit custom action.");
        assert_eq!(recap, configs.actions["Recap"].system_prompt);
        assert_eq!(no_scenario, prompt_templates::ASSIST_PROMPT);
    }

}
