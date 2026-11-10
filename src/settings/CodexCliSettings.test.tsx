import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ status: vi.fn(), models: vi.fn(), activate: vi.fn(), connection: vi.fn(), login: vi.fn() }));
vi.mock("../lib/ipc", () => ({ codexCliStatus: mocks.status, codexCliModels: mocks.models, testLLMConnection: mocks.connection, openCodexLoginTerminal: mocks.login }));
import { CodexCliSettings } from "./CodexCliSettings";
import { useConfigStore } from "../stores/configStore";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.status.mockResolvedValue({ installed: true, authenticated: true, auth_type: "chatgpt", plan: "pro", version: "Codex", binary_path: "C:/codex.exe", error: null });
  mocks.models.mockResolvedValue([{ id: "model-a", name: "Model A", supported_reasoning_efforts: ["low", "medium"], input_modalities: ["text", "image"], is_default: true }]);
  mocks.activate.mockResolvedValue(undefined);
  mocks.connection.mockResolvedValue(true);
  useConfigStore.setState({ activateLLMProvider: mocks.activate, llmProvider: "custom", llmModel: "old-model", lastModelByProvider: {} });
});

it("activates direct Codex with its selected model and warms the active connection", async () => {
  // Arrange
  render(<CodexCliSettings selected active={false} onSelect={() => {}} />);
  await screen.findByRole("option", { name: "Model A" });
  // Act
  fireEvent.click(screen.getByRole("button", { name: "Use Codex" }));
  // Assert
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("codex_cli", { model: "model-a" }));
  expect(mocks.connection).toHaveBeenCalledWith("codex_cli");
});

it("requires a ChatGPT login instead of treating an API login as subscription access", async () => {
  // Arrange
  mocks.status.mockResolvedValue({ installed: true, authenticated: false, auth_type: "apiKey", error: null });
  render(<CodexCliSettings selected active={false} onSelect={() => {}} />);
  // Act
  await screen.findByText(/Sign in with ChatGPT/);
  // Assert
  expect(screen.queryByRole("button", { name: "Use Codex" })).toBeNull();
  expect(screen.getByRole("button", { name: "Open Codex login" })).toBeEnabled();
});
