import { render, screen, waitFor, within } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ models: vi.fn(async () => [{ id: "model", name: "Model", supported_reasoning_efforts: ["low", "medium"], input_modalities: ["text"] }]) }));
vi.mock("../lib/ipc", () => ({ listModels: mocks.models }));
import { TranslationProfileSettings } from "./TranslationProfileSettings";
import { useConfigStore } from "../stores/configStore";
import { useModelProfilesStore, DEFAULT_LLM_PROFILES } from "../stores/modelProfilesStore";

it("loads Codex model capabilities before offering translation reasoning levels", async () => {
  // Arrange
  useConfigStore.setState({ llmProvider: "codex_cli", llmModel: "model" });
  useModelProfilesStore.setState({ profiles: { ...structuredClone(DEFAULT_LLM_PROFILES), translation: { enabled: true, model: "model", options: { reasoning_effort: null, service_tier: "default" } } } });
  // Act
  render(<TranslationProfileSettings />);
  // Assert
  await waitFor(() => expect(mocks.models).toHaveBeenCalledWith("codex_cli"));
  const reasoning = within(screen.getByRole("combobox", { name: "Reasoning" }));
  expect(reasoning.getByRole("option", { name: "low" })).toBeTruthy();
  expect(reasoning.queryByRole("option", { name: /^none$/ })).toBeNull();
});
