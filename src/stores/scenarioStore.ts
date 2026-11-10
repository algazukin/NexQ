import { create } from "zustand";
import { load, Store } from "@tauri-apps/plugin-store";
import type { AIScenario, ScenarioTemplate } from "../lib/types";
import { BUILT_IN_SCENARIOS, getScenarioById } from "../lib/scenarios";

const STORE_FILE = "config.json";

// Lazy singleton for Tauri plugin-store (shared with configStore)
let storeInstance: Store | null = null;

async function getStore(): Promise<Store> {
  if (!storeInstance) {
    storeInstance = await load(STORE_FILE, { autoSave: true, defaults: {} });
  }
  return storeInstance;
}

async function persistValue(key: string, value: unknown): Promise<void> {
  try {
    const store = await getStore();
    await store.set(key, value);
  } catch (err) {
    console.error(`[scenarioStore] Failed to persist "${key}":`, err);
  }
}

interface ScenarioState {
  activeScenarioId: AIScenario;
  customScenarios: ScenarioTemplate[];
  scenarioOverrides: Record<string, Partial<ScenarioTemplate>>;

  // Actions
  setActiveScenario: (id: AIScenario) => void;
  getTemplate: (id: AIScenario) => ScenarioTemplate;
  updatePrompt: (
    scenarioId: string,
    field: keyof Pick<ScenarioTemplate, "system_prompt" | "summary_prompt" | "question_detection_prompt">,
    value: string
  ) => void;
  resetScenarioOverrides: (scenarioId: string) => void;
  createCustomScenario: (template: ScenarioTemplate) => void;
  deleteCustomScenario: (id: string) => void;
  cloneScenario: (sourceId: string, newName: string) => ScenarioTemplate | null;

  // Persistence
  loadScenarioConfig: () => Promise<void>;
}

export const useScenarioStore = create<ScenarioState>((set, get) => ({
  activeScenarioId: "team_meeting",
  customScenarios: [],
  scenarioOverrides: {},

  setActiveScenario: (id) => {
    set({ activeScenarioId: id });
    persistValue("activeScenarioId", id);
  },

  getTemplate: (id) => {
    const { customScenarios, scenarioOverrides } = get();
    const custom = customScenarios.find((scenario) => scenario.id === id);
    if (custom) {
      return custom;
    }

    const builtIn = getScenarioById(id);
    if (!builtIn) {
      return BUILT_IN_SCENARIOS[0];
    }

    const overrides = scenarioOverrides[id];
    return overrides ? { ...builtIn, ...overrides } : builtIn;
  },

  updatePrompt: (scenarioId, field, value) => {
    set((s) => {
      const existing = s.scenarioOverrides[scenarioId] ?? {};
      const updated = {
        ...s.scenarioOverrides,
        [scenarioId]: { ...existing, [field]: value },
      };
      persistValue("scenarioOverrides", updated);
      return { scenarioOverrides: updated };
    });
  },

  resetScenarioOverrides: (scenarioId) => {
    set((s) => {
      const updated = { ...s.scenarioOverrides };
      delete updated[scenarioId];
      persistValue("scenarioOverrides", updated);
      return { scenarioOverrides: updated };
    });
  },

  createCustomScenario: (template) => {
    set((s) => {
      const updated = [...s.customScenarios, template];
      persistValue("customScenarios", updated);
      return { customScenarios: updated };
    });
  },

  deleteCustomScenario: (id) => {
    set((s) => {
      const updated = s.customScenarios.filter((sc) => sc.id !== id);
      persistValue("customScenarios", updated);
      // If deleting active scenario, fall back to team_meeting
      const activeId = s.activeScenarioId === id ? "team_meeting" : s.activeScenarioId;
      if (activeId !== s.activeScenarioId) {
        persistValue("activeScenarioId", activeId);
      }
      return { customScenarios: updated, activeScenarioId: activeId };
    });
  },

  cloneScenario: (sourceId, newName) => {
    const state = get();

    // Find source: check custom first, then built-in
    const source =
      state.customScenarios.find((s) => s.id === sourceId) ??
      getScenarioById(sourceId);

    if (!source) return null;

    // Apply overrides for built-ins before cloning
    const overrides = state.scenarioOverrides[sourceId];
    const base = overrides ? { ...source, ...overrides } : source;

    const cloned: ScenarioTemplate = {
      ...base,
      id: `custom_${Date.now()}`,
      name: newName,
      is_custom: true,
    };

    const updated = [...state.customScenarios, cloned];
    set({ customScenarios: updated });
    persistValue("customScenarios", updated);

    return cloned;
  },

  loadScenarioConfig: async () => {
    try {
      const store = await getStore();

      const activeScenarioId = await store.get<AIScenario>("activeScenarioId");
      const customScenarios = await store.get<ScenarioTemplate[]>("customScenarios");
      const scenarioOverrides = await store.get<Record<string, Partial<ScenarioTemplate>>>("scenarioOverrides");

      set((s) => ({
        ...s,
        ...(activeScenarioId != null && { activeScenarioId }),
        ...(customScenarios != null && { customScenarios }),
        ...(scenarioOverrides != null && { scenarioOverrides }),
      }));

      console.log("[scenarioStore] Scenario config loaded");
    } catch (err) {
      console.error("[scenarioStore] Failed to load scenario config:", err);
    }
  },
}));
