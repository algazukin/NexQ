use super::provider::GenerationParams;
use crate::state::AppState;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::Manager;

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct ModelOptions {
    pub reasoning_effort: Option<String>,
    pub service_tier: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct TranslationProfile {
    pub enabled: bool,
    pub model: String,
    pub options: ModelOptions,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(default)]
pub struct LlmProfiles {
    pub main: ModelOptions,
    pub translation: TranslationProfile,
}

impl LlmProfiles {
    pub fn validate(&self) -> Result<(), String> {
        for options in [&self.main, &self.translation.options] {
            if let Some(effort) = options.reasoning_effort.as_deref() {
                if ![
                    "none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra",
                ]
                .contains(&effort)
                {
                    return Err("Unknown reasoning effort".into());
                }
            }
            if let Some(tier) = options.service_tier.as_deref() {
                if !["default", "priority"].contains(&tier) {
                    return Err("Unknown boost/speed tier".into());
                }
            }
        }
        if self.translation.enabled && self.translation.model.chars().all(char::is_whitespace) {
            return Err("Select a model for the separate translation profile".into());
        }
        Ok(())
    }
}

pub fn effective_options(main: &ModelOptions, request: Option<&ModelOptions>) -> ModelOptions {
    request.unwrap_or(main).clone()
}

pub fn request_options(app: &tauri::AppHandle, params: &GenerationParams) -> ModelOptions {
    if let Some(options) = params.model_options.as_ref() {
        return options.clone();
    }
    app.try_state::<AppState>()
        .and_then(|state| {
            state.llm.as_ref().and_then(|router| {
                router
                    .lock()
                    .ok()
                    .map(|router| router.profiles.main.clone())
            })
        })
        .unwrap_or_default()
}

pub fn apply_http_options(body: &mut Value, options: &ModelOptions) {
    if let Some(effort) = options.reasoning_effort.as_ref() {
        body["reasoning_effort"] = json!(effort);
    }
    if let Some(tier) = options.service_tier.as_ref() {
        body["service_tier"] = json!(tier);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn profile_defaults_preserve_provider_behavior() {
        // Arrange
        let profiles: LlmProfiles = serde_json::from_str("{}").unwrap();
        let mut body = json!({"model": "main-model"});
        // Act
        apply_http_options(&mut body, &profiles.main);
        // Assert
        assert_eq!(body, json!({"model": "main-model"}));
        assert!(!profiles.translation.enabled);
    }

    #[test]
    fn translation_options_can_explicitly_disable_main_boost() {
        // Arrange
        let main = ModelOptions {
            reasoning_effort: Some("high".into()),
            service_tier: Some("priority".into()),
        };
        let translation = ModelOptions {
            reasoning_effort: Some("low".into()),
            service_tier: Some("default".into()),
        };
        let mut body = json!({});
        // Act
        let selected = effective_options(&main, Some(&translation));
        apply_http_options(&mut body, &selected);
        // Assert
        assert_eq!(
            body,
            json!({"reasoning_effort": "low", "service_tier": "default"})
        );
        assert_eq!(main.service_tier.as_deref(), Some("priority"));
    }

    #[test]
    fn empty_override_means_provider_default_rather_than_inheriting_main() {
        // Arrange
        let main = ModelOptions {
            reasoning_effort: Some("high".into()),
            service_tier: Some("priority".into()),
        };
        // Act
        let selected = effective_options(&main, Some(&ModelOptions::default()));
        // Assert
        assert_eq!(selected, ModelOptions::default());
        assert_eq!(effective_options(&main, None), main);
    }

    #[test]
    fn enabled_translation_requires_a_model_and_known_speed_tier() {
        // Arrange
        let mut profiles = LlmProfiles::default();
        profiles.translation.enabled = true;
        // Act
        let empty = profiles.validate();
        profiles.translation.model = "translation-model".into();
        profiles.translation.options.service_tier = Some("turbo".into());
        let unknown = profiles.validate();
        // Assert
        assert!(empty.is_err());
        assert!(unknown.is_err());
    }
}
