import { useEffect, useState } from "react";
import { useConfigStore } from "../stores/configStore";
import { useModelProfilesStore } from "../stores/modelProfilesStore";
import { OPTION_PROVIDERS } from "../lib/modelProfiles";
import { listModels } from "../lib/ipc";
import type { ModelInfo } from "../lib/types";
import { ModelOptionsFields } from "./ModelOptionsFields";

export function TranslationProfileSettings() {
  const provider = useConfigStore((state) => state.llmProvider);
  const mainModel = useConfigStore((state) => state.llmModel);
  const profiles = useModelProfilesStore((state) => state.profiles);
  const storeError = useModelProfilesStore((state) => state.error);
  const [draft, setDraft] = useState(profiles.translation);
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(profiles.translation), [profiles.translation]);
  useEffect(() => {
    setModels([]);
    if (provider === "codex_cli") {
      listModels(provider).then(setModels).catch((error) => setError(String(error)));
    }
  }, [provider]);
  const selected = models.find((model) => model.id === draft.model);
  const save = async () => {
    setSaving(true);
    try {
      await useModelProfilesStore.getState().setProfiles({ ...useModelProfilesStore.getState().profiles, translation: draft });
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };
  return <section className="space-y-3 rounded-xl border border-border/30 bg-card/50 p-4">
    <h3 className="text-sm font-semibold text-primary/80">LLM translation profile</h3>
    <p className="text-xs text-muted-foreground">Uses the active AI provider ({provider}) and its credentials. Interview model: {mainModel || "not selected"}.</p>
    <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={draft.enabled} disabled={provider === "claude_cli" && !draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} />Use a separate model and settings for translation</label>
    {provider === "claude_cli" && <p className="text-xs text-muted-foreground">Claude CLI uses its configured Fast model. Select Codex or an API provider to use this separate profile.</p>}
    {draft.enabled && <>
      <label className="block text-xs text-muted-foreground">Translation model
        <input aria-label="Translation model" list="translation-models" className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground" value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} />
        <datalist id="translation-models">{models.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</datalist>
      </label>
      <button type="button" className="text-xs text-primary" onClick={() => {
        listModels(provider).then(setModels).catch((err) => setError(String(err)));
      }}>Load models from active provider</button>
      {OPTION_PROVIDERS.includes(provider) && <ModelOptionsFields options={draft.options} efforts={provider === "codex_cli" ? selected?.supported_reasoning_efforts ?? [] : undefined} onChange={(options) => setDraft({ ...draft, options })} />}
    </>}
    {!draft.enabled && <p className="text-xs text-muted-foreground">Translation inherits the main AI model, reasoning and speed settings.</p>}
    <button type="button" disabled={saving || (draft.enabled && (!draft.model || (provider === "codex_cli" && (!selected || (!!draft.options.reasoning_effort && !selected.supported_reasoning_efforts?.includes(draft.options.reasoning_effort))))))} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" onClick={save}>{saving ? "Saving…" : "Save translation profile"}</button>
    {(error || storeError) && <p role="alert" className="text-xs text-destructive">{error || storeError}</p>}
  </section>;
}
