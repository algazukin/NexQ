import { StrictMode } from "react";
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
  render(<CodexCliSettings active={false} />);
  const activate = await screen.findByRole("button", { name: "Set Codex CLI as Active Provider" });
  await waitFor(() => expect(activate).toBeEnabled());
  // Act
  fireEvent.click(activate);
  // Assert
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("codex_cli", { model: "model-a" }));
  expect(mocks.connection).toHaveBeenCalledWith("codex_cli");
});

it("requires a ChatGPT login instead of treating an API login as subscription access", async () => {
  // Arrange
  mocks.status.mockResolvedValue({ installed: true, authenticated: false, auth_type: "apiKey", error: null });
  render(<CodexCliSettings active={false} />);
  // Act
  await screen.findByText(/Sign in with ChatGPT/);
  // Assert
  expect(screen.getByRole("button", { name: "Set Codex CLI as Active Provider" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Open Codex login" })).toBeEnabled();
});

it("marks a saved model that disappeared and requires an explicit replacement", async () => {
  // Arrange
  useConfigStore.setState({ lastModelByProvider: { codex_cli: "old-codex" } });
  render(<CodexCliSettings active={false} />);
  await screen.findByText(/This Codex model is unavailable/);
  const activate = screen.getByRole("button", { name: "Set Codex CLI as Active Provider" });

  // Act
  fireEvent.click(activate);
  fireEvent.click(screen.getByText("Advanced settings"));

  // Assert
  expect(mocks.activate).not.toHaveBeenCalled();
  expect(screen.getByRole("option", { name: "old-codex (unavailable)" })).toBeDisabled();
  expect(activate).toBeDisabled();

  // Act
  fireEvent.change(screen.getByLabelText("Codex model"), { target: { value: "model-a" } });
  fireEvent.click(activate);

  // Assert
  await waitFor(() => expect(mocks.activate).toHaveBeenCalledWith("codex_cli", { model: "model-a" }));
});

it("keeps an open settings draft when refreshing the current account and model", async () => {
  // Arrange
  useConfigStore.setState({ llmProvider: "codex_cli", llmModel: "model-a" });
  render(<StrictMode><CodexCliSettings active /></StrictMode>);
  const check = await screen.findByRole("button", { name: "Check Codex connection" });
  expect(mocks.status).toHaveBeenCalledTimes(1);
  expect(mocks.models).toHaveBeenCalledWith(true);
  fireEvent.click(screen.getByText("Advanced settings"));
  fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "medium" } });
  fireEvent.change(screen.getByLabelText("Boost / speed"), { target: { value: "priority" } });

  // Act
  fireEvent.click(check);
  await screen.findByRole("button", { name: "Check Codex connection" });

  // Assert
  expect(mocks.status).toHaveBeenCalledTimes(2);
  expect(screen.getByLabelText("Codex model").closest("details")).toHaveAttribute("open");
  expect(screen.getByLabelText("Reasoning")).toHaveValue("medium");
  expect(screen.getByLabelText("Boost / speed")).toHaveValue("priority");
});
