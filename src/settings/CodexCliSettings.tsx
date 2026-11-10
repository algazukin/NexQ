import { useCallback, useEffect, useState } from "react";
import { codexCliModels, codexCliStatus, openCodexLoginTerminal, testLLMConnection } from "../lib/ipc";
import type { CodexCliStatus, CodexModelInfo } from "../lib/types";
import { useConfigStore } from "../stores/configStore";
import { MainModelProfileSettings } from "./MainModelProfileSettings";

export function CodexCliSettings({ selected, active, onSelect }: { selected: boolean; active: boolean; onSelect: () => void }) {
  const activeModel = useConfigStore((state) => state.llmModel);
  const [status, setStatus] = useState<CodexCliStatus | null>(null);
  const [models, setModels] = useState<CodexModelInfo[]>([]);
  const [model, setModel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const status = await codexCliStatus();
      setStatus(status);
      if (status.error) {
        setError(status.error);
      }
      if (status.authenticated) {
        const catalog = await codexCliModels(true);
        setModels(catalog);
        const config = useConfigStore.getState();
        const remembered = config.llmProvider === "codex_cli" ? config.llmModel : config.lastModelByProvider.codex_cli;
        setModel(catalog.find((entry) => entry.id === remembered)?.id ?? catalog.find((entry) => entry.is_default)?.id ?? catalog[0]?.id ?? "");
      } else {
        setModels([]);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  }, []);
  useEffect(() => {
    if (selected) {
      void check();
    }
  }, [selected, check]);
  const activate = async () => {
    setBusy(true);
    try {
      await useConfigStore.getState().activateLLMProvider("codex_cli", { model });
      if (!await testLLMConnection("codex_cli")) {
        throw new Error("Sign in with ChatGPT in Codex CLI");
      }
      setError(null);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }
  };
  return <section className={`space-y-3 rounded-xl border p-4 ${selected ? "border-primary/50 bg-primary/5" : "border-border/30 bg-card/50"}`}>
    <button type="button" onClick={onSelect} className="text-left text-sm font-semibold text-primary">Codex · Subscription (local CLI){active ? " · Active" : ""}</button>
    <p className="text-xs text-muted-foreground">Uses the official local Codex CLI and your ChatGPT login. No HTTP proxy or API key required.</p>
    {selected && <>
      <button type="button" disabled={busy} className="text-xs text-primary disabled:opacity-50" onClick={check}>{busy ? "Checking…" : "Check Codex connection"}</button>
      {status?.authenticated && <p className="text-xs text-success">Connected with ChatGPT{status.plan ? ` · ${status.plan}` : ""}</p>}
      {status?.installed === false && <p className="text-xs text-muted-foreground">Install Codex CLI, sign in, then check again.</p>}
      {status?.installed && !status.authenticated && <>
        <p className="text-xs text-muted-foreground">Sign in with ChatGPT to use your subscription. API logins have separate billing.</p>
        <button type="button" className="text-xs text-primary" onClick={() => { openCodexLoginTerminal().catch((err) => setError(String(err))); }}>Open Codex login</button>
      </>}
      {status?.version && <p className="break-all text-[11px] text-muted-foreground">{status.version}</p>}
      {status?.authenticated && <>
        <label className="block text-xs text-muted-foreground">Codex model
          <select aria-label="Codex model" value={model} onChange={(event) => setModel(event.target.value)} className="mt-1 w-full rounded-md border border-border bg-background p-2 text-foreground">
            {models.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        <button type="button" disabled={busy || !model} onClick={activate} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50">{active ? "Apply Codex model" : "Use Codex"}</button>
        {active && <MainModelProfileSettings efforts={models.find((entry) => entry.id === activeModel)?.supported_reasoning_efforts} />}
      </>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </>}
  </section>;
}
