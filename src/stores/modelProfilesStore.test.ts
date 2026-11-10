import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ invoke: vi.fn(async () => {}), set: vi.fn(async (_key: string, _value: unknown) => {}), change: null as null | ((value: unknown) => void), saved: undefined as unknown }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ get: async () => mocks.saved, set: mocks.set, onKeyChange: async (_key: string, callback: (value: unknown) => void) => { mocks.change = callback; return () => {}; } }) }));
import { DEFAULT_LLM_PROFILES, useModelProfilesStore } from "./modelProfilesStore";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.change = null;
  mocks.saved = undefined;
  useModelProfilesStore.setState({ profiles: structuredClone(DEFAULT_LLM_PROFILES), error: null });
});

it("persists an independent translation profile without changing main options", async () => {
  // Arrange
  const profiles = structuredClone(DEFAULT_LLM_PROFILES);
  profiles.translation = { enabled: true, model: "translation-model", options: { reasoning_effort: "low", service_tier: "default" } };
  // Act
  await useModelProfilesStore.getState().setProfiles(profiles);
  // Assert
  expect(mocks.invoke).toHaveBeenCalledWith("set_llm_profiles", { profiles });
  expect(mocks.set).toHaveBeenCalledWith("profiles", profiles);
  expect(useModelProfilesStore.getState().profiles.main).toEqual(DEFAULT_LLM_PROFILES.main);
});

it("loads saved settings and accepts another window's changes without persisting them again", async () => {
  // Arrange
  const saved = structuredClone(DEFAULT_LLM_PROFILES);
  saved.main.reasoning_effort = "medium";
  mocks.saved = saved;
  // Act
  await useModelProfilesStore.getState().loadConfig();
  const next = { ...saved, main: { reasoning_effort: "low", service_tier: "priority" } };
  mocks.change?.(next);
  await vi.waitFor(() => expect(useModelProfilesStore.getState().profiles).toEqual(next));
  // Assert
  expect(useModelProfilesStore.getState().profiles).toEqual(next);
  expect(mocks.set).not.toHaveBeenCalled();
  expect(mocks.invoke).toHaveBeenCalledTimes(1);
});

it("keeps a main setting when the translation profile is saved before its acknowledgement", async () => {
  // Arrange
  let finish!: () => void;
  mocks.invoke.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve; }));
  const first = structuredClone(DEFAULT_LLM_PROFILES);
  first.main.reasoning_effort = "high";
  // Act
  const mainSave = useModelProfilesStore.getState().setProfiles(first);
  const next = structuredClone(useModelProfilesStore.getState().profiles);
  next.translation = { enabled: true, model: "translation-model", options: { reasoning_effort: "low", service_tier: "default" } };
  const translationSave = useModelProfilesStore.getState().setProfiles(next);
  await vi.waitFor(() => expect(mocks.invoke).toHaveBeenCalled());
  finish();
  await Promise.all([mainSave, translationSave]);
  // Assert
  expect(useModelProfilesStore.getState().profiles.main.reasoning_effort).toBe("high");
  expect(mocks.set).toHaveBeenLastCalledWith("profiles", expect.objectContaining({ main: first.main }));
});

it("does not let an older storage acknowledgement erase a newer pending selection", async () => {
  // Arrange
  await useModelProfilesStore.getState().loadConfig();
  const acknowledgements: Array<() => void> = [];
  mocks.invoke.mockImplementation(() => new Promise<void>((resolve) => { acknowledgements.push(resolve); }));
  mocks.set.mockImplementation(async (_key: string, value: unknown) => { mocks.change?.(value); });
  const main = structuredClone(DEFAULT_LLM_PROFILES);
  main.main.reasoning_effort = "high";
  // Act
  const saveA = useModelProfilesStore.getState().setProfiles(main);
  const translation = structuredClone(useModelProfilesStore.getState().profiles);
  translation.translation = { enabled: true, model: "translator", options: { reasoning_effort: "low", service_tier: "default" } };
  const saveB = useModelProfilesStore.getState().setProfiles(translation);
  await vi.waitFor(() => expect(acknowledgements).toHaveLength(1));
  acknowledgements[0]();
  await saveA;
  await vi.waitFor(() => expect(acknowledgements).toHaveLength(2));
  const boost = structuredClone(useModelProfilesStore.getState().profiles);
  boost.main.service_tier = "priority";
  const saveC = useModelProfilesStore.getState().setProfiles(boost);
  acknowledgements[1]();
  await saveB;
  await vi.waitFor(() => expect(acknowledgements).toHaveLength(3));
  acknowledgements[2]();
  await saveC;
  // Assert
  expect(useModelProfilesStore.getState().profiles.translation.enabled).toBe(true);
  expect(useModelProfilesStore.getState().profiles.main).toEqual({ reasoning_effort: "high", service_tier: "priority" });
  expect(mocks.set).toHaveBeenLastCalledWith("profiles", expect.objectContaining({ translation: expect.objectContaining({ enabled: true }) }));
});
