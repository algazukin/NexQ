export interface ModelOptions {
  reasoning_effort: string | null;
  service_tier: string | null;
}

export interface TranslationProfile {
  enabled: boolean;
  model: string;
  options: ModelOptions;
}

export interface LlmProfiles {
  main: ModelOptions;
  translation: TranslationProfile;
}

export const REASONING_EFFORTS = ["none", "minimal", "low", "medium", "high", "xhigh", "max", "ultra"];
export const OPTION_PROVIDERS = ["openai", "custom", "codex_cli"];
