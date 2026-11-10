import { useEffect, useState } from "react";
import { useModelProfilesStore } from "../stores/modelProfilesStore";
import { ModelOptionsFields } from "./ModelOptionsFields";

export function MainModelProfileSettings({ efforts }: { efforts?: string[] }) {
  const profiles = useModelProfilesStore((state) => state.profiles);
  const error = useModelProfilesStore((state) => state.error);
  const [draft, setDraft] = useState(profiles.main);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(profiles.main), [profiles.main]);
  return <section className="space-y-3 rounded-xl border border-border/30 bg-card/50 p-4">
    <h3 className="text-sm font-semibold text-primary/80">Main AI reasoning and boost</h3>
    <ModelOptionsFields options={draft} efforts={efforts} onChange={setDraft} />
    <button type="button" disabled={saving || (!!draft.reasoning_effort && !!efforts && !efforts.includes(draft.reasoning_effort))} className="rounded-md bg-primary px-3 py-2 text-xs text-primary-foreground disabled:opacity-50" onClick={async () => {
      setSaving(true);
      try {
        await useModelProfilesStore.getState().setProfiles({ ...useModelProfilesStore.getState().profiles, main: draft });
      } catch {
        // The store exposes the backend error below; keep the unsaved draft visible.
      } finally {
        setSaving(false);
      }
    }}>{saving ? "Saving…" : "Save AI profile"}</button>
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </section>;
}
