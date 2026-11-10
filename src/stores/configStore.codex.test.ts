import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ provider: vi.fn(async () => {}), model: vi.fn(async () => {}), catalog: vi.fn(async () => [{ id: "limited", name: "Limited", supported_reasoning_efforts: ["low", "medium"], is_default: true }]), save: vi.fn(async (_value: unknown) => {}), profiles: { main: { reasoning_effort: "ultra" as string | null, service_tier: "default" }, translation: { enabled: false, model: "", options: { reasoning_effort: null, service_tier: null } } } }));
vi.mock("../lib/ipc", () => ({ setLLMProvider: mocks.provider, setActiveModel: mocks.model, getApiKey: async () => null, codexCliModels: mocks.catalog }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ set: async () => {}, get: async () => null }) }));
vi.mock("./modelProfilesStore", () => ({ useModelProfilesStore: { getState: () => ({ profiles: mocks.profiles, setProfiles: mocks.save }) } }));
import { useConfigStore } from "./configStore";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.profiles.main.reasoning_effort = "ultra";
  useConfigStore.setState({ llmProvider: "custom", llmModel: "old", lastModelByProvider: {}, claudeCliFallbackPinned: true });
});

it("resets unsupported Codex effort in the shared activation used by the footer", async () => {
  // Arrange
  // Act
  await useConfigStore.getState().activateLLMProvider("codex_cli", { model: "limited" });
  // Assert
  expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ main: { reasoning_effort: null, service_tier: "default" } }));
  expect(mocks.model).toHaveBeenCalledWith("codex_cli", "limited");
});

it("preserves a supported effort when switching through the same shared path", async () => {
  // Arrange
  mocks.profiles.main.reasoning_effort = "low";
  // Act
  await useConfigStore.getState().activateLLMProvider("codex_cli", { model: "limited" });
  // Assert
  expect(mocks.save).not.toHaveBeenCalled();
  expect(useConfigStore.getState().llmModel).toBe("limited");
});
