import { useCallback, useEffect, useRef, useState } from "react";
import { codexCliModels, codexCliStatus, openCodexLoginTerminal, testLLMConnection } from "../lib/ipc";
import type { CodexCliStatus, CodexModelInfo } from "../lib/types";
import { useConfigStore } from "../stores/configStore";
import { MainModelProfileSettings } from "./MainModelProfileSettings";

export function CodexCliSettings({ active }: { active: boolean }) {
  const activeModel = useConfigStore((state) => active ? state.llmModel : undefined);
  const rememberedModel = useConfigStore((state) => state.lastModelByProvider.codex_cli);
  const activateProvider = useConfigStore((state) => state.activateLLMProvider);
  const [status, setStatus] = useState<CodexCliStatus | null>(null);
  const [models, setModels] = useState<CodexModelInfo[] | null>(null);
  const [draftModel, setDraftModel] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const checkInFlight = useRef(false);
  const check = useCallback(async () => {
    if (checkInFlight.current) {
      return;
    }
    checkInFlight.current = true;
    setChecking(true);
    setError(null);
    let result: CodexCliStatus | null = null;
    try {
      result = await codexCliStatus();
      // The ChatGPT account can change while the panel is closed.
      const catalog = result.authenticated && !result.error ? await codexCliModels(true) : null;
      setStatus(result);
      setModels(catalog);
      setError(result.error ?? null);
    } catch (err) {
      setStatus(result);
      setModels(null);
      setError(String(err));
    } finally {
      checkInFlight.current = false;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  // An applied selection can also change from the footer or the other window.
  useEffect(() => {
    setDraftModel(null);
  }, [activeModel]);

  const model = (draftModel ?? (activeModel || rememberedModel)) ||
    models?.find((entry) => entry.is_default)?.id || models?.[0]?.id || "";
  const selected = models?.find((entry) => entry.id === model);
  const busy = checking || activating;
  const ready = !busy && !!status?.authenticated && !!selected;

  const activate = async () => {
    setActivating(true);
    setError(null);
    try {
      await activateProvider("codex_cli", { model });
      // Warm the active app-server connection so the first answer can reuse it.
      if (!await testLLMConnection("codex_cli")) {
        setStatus((previous) => previous && { ...previous, authenticated: false });
        setError("Sign in with ChatGPT in Codex CLI to connect.");
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setActivating(false);
    }
  };

  return (
    <section aria-label="Codex CLI connection" className="space-y-3 rounded-xl border border-border/30 bg-card/50 p-5">
      <h3 className="text-sm font-semibold text-primary/80">Connection</h3>
      <p className="text-xs text-muted-foreground">Use your ChatGPT subscription through the local Codex CLI.</p>
      <button
        type="button"
        disabled={busy}
        className="rounded-lg border border-border/50 bg-background px-4 py-2 text-sm text-foreground hover:bg-accent disabled:opacity-50"
        onClick={() => { void check(); }}
      >
        {checking ? "Checking…" : "Check Codex connection"}
      </button>
      {status?.authenticated && <p className="text-xs text-success">Connected with ChatGPT{status.plan ? ` · ${status.plan}` : ""}</p>}
      {status?.installed === false && <p className="text-xs text-muted-foreground">Install Codex CLI, sign in, then check again.</p>}
      {status?.installed && !status.authenticated && !status.error && (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">Sign in with ChatGPT to use your subscription. API logins have separate billing.</p>
          <button
            type="button"
            className="text-xs text-primary"
            onClick={() => { openCodexLoginTerminal().catch((err) => setError(String(err))); }}
          >
            Open Codex login
          </button>
        </div>
      )}
      {status?.version && <p className="break-all text-[11px] text-muted-foreground">{status.version}</p>}
      {status?.authenticated && !checking && models?.length === 0 && (
        <p className="text-xs text-warning">Codex returned no models. Check the connection again.</p>
      )}
      {status?.authenticated && !checking && !!models?.length && model && !selected && (
        <p className="text-xs text-warning">This Codex model is unavailable. Choose another model in Advanced settings.</p>
      )}
      {!active && (
        <button
          type="button"
          disabled={!ready}
          onClick={activate}
          className="w-full rounded-xl border border-primary/30 bg-primary/5 px-4 py-3 text-sm font-medium text-primary hover:bg-primary/10 disabled:opacity-50"
        >
          Set Codex CLI as Active Provider
        </button>
      )}
      {status?.authenticated && models && (
        <details className="rounded-lg border border-border/30 px-4 py-3">
          <summary className="cursor-pointer text-sm font-medium text-foreground">Advanced settings</summary>
          <div className="mt-3 space-y-3">
            <label className="block text-xs text-muted-foreground">
              Codex model
              <select
                aria-label="Codex model"
                value={model}
                disabled={busy || models.length === 0}
                onChange={(event) => setDraftModel(event.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground disabled:opacity-50"
              >
                {model && !selected && <option value={model} disabled>{model} (unavailable)</option>}
                {!model && <option value="">No models available</option>}
                {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
              </select>
            </label>
            {active && (
              <button
                type="button"
                disabled={!ready || model === activeModel}
                onClick={activate}
                className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50"
              >
                Apply Codex model
              </button>
            )}
            {active && selected && model === activeModel && (
              <>
                {selected.supported_reasoning_efforts.length === 0 && (
                  <p className="text-xs text-muted-foreground">This model does not advertise adjustable reasoning levels.</p>
                )}
                <MainModelProfileSettings efforts={selected.supported_reasoning_efforts} />
                <p className="text-xs text-muted-foreground">Boost availability depends on your Codex model and ChatGPT plan.</p>
              </>
            )}
          </div>
        </details>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
