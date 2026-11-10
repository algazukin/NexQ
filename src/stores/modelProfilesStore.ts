import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { invoke } from "@tauri-apps/api/core";
import type { LlmProfiles } from "../lib/modelProfiles";

export const DEFAULT_LLM_PROFILES: LlmProfiles = {
  main: { reasoning_effort: null, service_tier: null },
  translation: { enabled: false, model: "", options: { reasoning_effort: null, service_tier: null } },
};

let storage: Promise<Store> | undefined;
let sync = Promise.resolve();
let pendingSaves = 0;
let stopWatching: (() => void) | undefined;
function getStorage(): Promise<Store> {
  storage ??= load("llm-profiles.json", { autoSave: true, defaults: {} });
  return storage;
}

function syncBackend(profiles: LlmProfiles, persist = false): Promise<void> {
  sync = sync.catch(() => {}).then(async () => {
    await invoke<void>("set_llm_profiles", { profiles });
    if (persist) {
      await (await getStorage()).set("profiles", profiles);
    }
  });
  return sync;
}

interface ProfileState {
  profiles: LlmProfiles;
  error: string | null;
  setProfiles: (profiles: LlmProfiles) => Promise<void>;
  loadConfig: () => Promise<void>;
}

export const useModelProfilesStore = create<ProfileState>((set) => ({
  profiles: structuredClone(DEFAULT_LLM_PROFILES),
  error: null,
  setProfiles: async (profiles) => {
    // Publish the pending choice immediately so another profile save preserves it.
    pendingSaves += 1;
    set({ profiles, error: null });
    try {
      await syncBackend(profiles, true);
      if (pendingSaves === 1) {
        set({ error: null });
      }
    } catch (error) {
      if (pendingSaves === 1) {
        set({ error: String(error) });
      }
      throw error;
    } finally {
      pendingSaves -= 1;
    }
  },
  loadConfig: async () => {
    try {
      const store = await getStorage();
      const saved = await store.get<LlmProfiles>("profiles");
      const profiles = saved ?? structuredClone(DEFAULT_LLM_PROFILES);
      await syncBackend(profiles);
      set({ profiles, error: null });
      stopWatching?.();
      stopWatching = await store.onKeyChange<LlmProfiles>("profiles", (next) => {
        if (next && pendingSaves === 0) {
          // Acknowledgements of older saves cannot replace a newer local choice.
          set({ profiles: next });
          // Tauri's backend is shared: the saving window already applied this value.
          // Re-applying an older store event could overwrite a newer queued save.
        }
      });
    } catch (error) {
      set({ error: String(error) });
    }
  },
}));
