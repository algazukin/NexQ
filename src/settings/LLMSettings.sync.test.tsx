// Settings ↔ footer: one source of truth for the active LLM provider.
//
// Reported bug: "activating" Claude in Settings left the footer on the old
// provider until Claude was picked again in the footer.

import "@testing-library/jest-dom/vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClaudeCliStatus } from "../lib/types";

vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {} }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ set: async () => {}, get: async () => undefined, onKeyChange: async () => () => {} }),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

const ipc = vi.hoisted(() => ({
  claudeCliStatus: vi.fn(),
  claudeCliModels: vi.fn(),
  getAgentSessions: vi.fn(),
  setLLMProvider: vi.fn(),
  setActiveModel: vi.fn(),
  setClaudeCliConfig: vi.fn(),
  codexCliStatus: vi.fn(),
  codexCliModels: vi.fn(),
  testLLMConnection: vi.fn(),
  listModels: vi.fn(),
}));

vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ipc")>()),
  claudeCliStatus: () => ipc.claudeCliStatus(),
  claudeCliModels: (...a: unknown[]) => ipc.claudeCliModels(...a),
  getAgentSessions: () => ipc.getAgentSessions(),
  setLLMProvider: (...a: unknown[]) => ipc.setLLMProvider(...a),
  setActiveModel: (...a: unknown[]) => ipc.setActiveModel(...a),
  setClaudeCliConfig: (...a: unknown[]) => ipc.setClaudeCliConfig(...a),
  codexCliStatus: () => ipc.codexCliStatus(),
  codexCliModels: (...a: unknown[]) => ipc.codexCliModels(...a),
  testLLMConnection: (...a: unknown[]) => ipc.testLLMConnection(...a),
  getApiKey: async () => null,
  hasApiKey: async () => false,
  listModels: (...a: unknown[]) => ipc.listModels(...a),
  listLocalSTTEngines: async () => [],
  getLLMProviders: async () => [],
}));

import { LLMSettings } from "./LLMSettings";
import { ServiceStatusBar } from "../components/ServiceStatusBar";
import { resetAgentStoreForTests } from "../stores/agentStore";
import { useStreamStore } from "../stores/streamStore";
import { DEFAULT_CLAUDE_CLI_CONFIG, useConfigStore } from "../stores/configStore";
import { DEFAULT_LLM_PROFILES, useModelProfilesStore } from "../stores/modelProfilesStore";

const CODEX_MODELS = [
  { id: "model-a", name: "Model A", supported_reasoning_efforts: ["low", "medium"], is_default: true },
  { id: "model-b", name: "Model B", supported_reasoning_efforts: ["low"], is_default: false },
];

const LOGGED_IN: ClaudeCliStatus = {
  installed: true,
  binary_path: "C:\\Users\\me\\.local\\bin\\claude.exe",
  version: "2.1.288",
  auth: { logged_in: true, auth_method: "claude.ai", subscription_type: "max", email: "me@example.com", login: "subscription" },
  npm_only: false,
};

/** The footer's LLM chip: Claude's status chip, or the generic provider chip. */
function footerShowsClaude(): boolean {
  return screen.queryByTestId("agent-status-chip") !== null;
}

function claudeCard(): HTMLElement {
  return screen.getByRole("button", { name: /^Claude\b/ });
}

describe("Settings ↔ footer sync of the active LLM", () => {
  beforeEach(() => {
    resetAgentStoreForTests();
    useConfigStore.setState({
      llmProvider: "ollama",
      llmModel: "llama3.2",
      lastModelByProvider: { ollama: "llama3.2" },
      claudeCliConfig: DEFAULT_CLAUDE_CLI_CONFIG,
      claudeCliFallbackPinned: false,
      verifiedCloudProviders: [],
    });
    ipc.claudeCliStatus.mockReset().mockResolvedValue(LOGGED_IN);
    ipc.claudeCliModels.mockReset().mockResolvedValue([]);
    ipc.getAgentSessions.mockReset().mockResolvedValue([]);
    ipc.setLLMProvider.mockReset().mockResolvedValue(undefined);
    ipc.setActiveModel.mockReset().mockResolvedValue(undefined);
    ipc.setClaudeCliConfig.mockReset().mockResolvedValue(undefined);
    ipc.codexCliStatus.mockReset().mockResolvedValue({ installed: true, authenticated: true, plan: "pro" });
    ipc.codexCliModels.mockReset().mockResolvedValue(CODEX_MODELS);
    ipc.testLLMConnection.mockReset().mockResolvedValue(true);
    ipc.listModels.mockReset().mockImplementation(async (provider: string) => provider.includes("codex_cli") ? CODEX_MODELS : []);
    useModelProfilesStore.setState({ profiles: structuredClone(DEFAULT_LLM_PROFILES), error: null });
    vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("selects Codex from the shared grid and restores its applied model and options after switching away", async () => {
    // Arrange
    render(<><LLMSettings /><ServiceStatusBar /></>);
    const providers = screen.getByRole("region", { name: "AI providers" });
    const codex = within(providers).getByRole("button", { name: /^Codex CLI/ });
    expect(codex).toBeEnabled();
    expect(screen.getAllByRole("button", { name: /^Codex CLI/ })).toHaveLength(1);
    expect(ipc.codexCliStatus).not.toHaveBeenCalled();

    // Act
    fireEvent.click(codex);
    await screen.findByText(/Connected with ChatGPT/);
    expect(screen.getByLabelText("Codex model").closest("details")).not.toHaveAttribute("open");
    fireEvent.click(screen.getByText("Advanced settings"));
    fireEvent.change(screen.getByLabelText("Codex model"), { target: { value: "model-b" } });
    fireEvent.click(screen.getByRole("button", { name: "Set Codex CLI as Active Provider" }));
    await waitFor(() => expect(screen.getByTitle(/^LLM: Codex \/ model-b$/)).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reasoning"), { target: { value: "low" } });
    fireEvent.change(screen.getByLabelText("Boost / speed"), { target: { value: "priority" } });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save AI profile" })); });
    fireEvent.click(within(providers).getByRole("button", { name: /^Ollama/ }));
    fireEvent.click(screen.getByRole("button", { name: "Set Ollama as Active Provider" }));
    await waitFor(() => expect(screen.getByTitle(/^LLM: Ollama/)).toBeInTheDocument());
    fireEvent.click(screen.getByTitle(/^LLM: Ollama/));
    fireEvent.click(screen.getByRole("button", { name: /^Codex$/ }));
    await waitFor(() => expect(ipc.listModels).toHaveBeenCalledWith("codex_cli"));
    fireEvent.click(await screen.findByRole("button", { name: "model-b" }));

    // Assert
    await waitFor(() => expect(screen.getByTitle(/^LLM: Codex \/ model-b$/)).toBeInTheDocument());
    await screen.findByText(/Connected with ChatGPT/);
    expect(codex).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByText("Advanced settings"));
    expect(screen.getByLabelText("Codex model")).toHaveValue("model-b");
    expect(screen.getByLabelText("Reasoning")).toHaveValue("low");
    expect(screen.queryByRole("option", { name: "medium" })).not.toBeInTheDocument();
    expect(screen.getByLabelText("Boost / speed")).toHaveValue("priority");
    expect(ipc.setLLMProvider).toHaveBeenLastCalledWith(JSON.stringify({ provider_type: "codex_cli" }));
    expect(ipc.setActiveModel).toHaveBeenLastCalledWith("codex_cli", "model-b");
  });

  it("opens Codex settings from the shared grid with login required before activation", async () => {
    // Arrange
    ipc.codexCliStatus.mockResolvedValue({ installed: true, authenticated: false, auth_type: "apiKey" });
    render(<LLMSettings />);

    // Act
    fireEvent.click(within(screen.getByRole("region", { name: "AI providers" })).getByRole("button", { name: /^Codex CLI/ }));

    // Assert
    expect(await screen.findByRole("button", { name: "Open Codex login" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Set Codex CLI as Active Provider" })).toBeDisabled();
    expect(ipc.codexCliModels).not.toHaveBeenCalled();
    expect(ipc.setLLMProvider).not.toHaveBeenCalled();
  });

  it("the Claude panel in Settings activates Claude, and the footer follows", async () => {
    render(
      <>
        <LLMSettings />
        <ServiceStatusBar />
      </>,
    );
    expect(footerShowsClaude()).toBe(false);

    // Open Claude in Settings: its panel shows the login and models...
    fireEvent.click(claudeCard());
    await screen.findByText("me@example.com · Max");
    // ...and offers activation right there, not only at the bottom of the page.
    fireEvent.click(screen.getByRole("button", { name: "Use Claude" }));

    await waitFor(() => expect(footerShowsClaude()).toBe(true));
    expect(useConfigStore.getState().llmProvider).toBe("claude_cli");
    expect(ipc.setLLMProvider).toHaveBeenCalledWith(JSON.stringify({ provider_type: "claude_cli" }));
    expect(ipc.setActiveModel).toHaveBeenCalledWith("claude_cli", "haiku");
    expect(within(claudeCard()).getByText("Active")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Use Claude" })).not.toBeInTheDocument();
    // Same side effects as every other activation path.
    expect(useConfigStore.getState().verifiedCloudProviders).toContain("claude_cli");
  });

  it("the bottom 'Set as Active' button takes the same path", async () => {
    render(
      <>
        <LLMSettings />
        <ServiceStatusBar />
      </>,
    );
    fireEvent.click(claudeCard());
    await screen.findByText("me@example.com · Max");
    fireEvent.click(screen.getByRole("button", { name: /set claude \(subscription\) as active provider/i }));
    await waitFor(() => expect(footerShowsClaude()).toBe(true));
    expect(ipc.setActiveModel).toHaveBeenCalledWith("claude_cli", "haiku");
  });

  it("after an answer has streamed, the footer shows the newly activated provider, not the last stream's", async () => {
    // An answer streamed with Groq earlier in the meeting; the stream store
    // keeps its provider/model until the meeting ends.
    useConfigStore.setState({ llmProvider: "groq", llmModel: "llama-3.3-70b", lastModelByProvider: { groq: "llama-3.3-70b", openai: "gpt-4o" } });
    useStreamStore.setState({ isStreaming: false, currentProvider: "groq", currentModel: "llama-3.3-70b" });
    render(<ServiceStatusBar />);

    await act(async () => {
      await useConfigStore.getState().activateLLMProvider("openai");
    });
    const chip = screen.getByTitle(/^LLM:/);
    expect(chip).toHaveAttribute("title", expect.stringContaining("OpenAI"));
    expect(chip).not.toHaveAttribute("title", expect.stringContaining("Groq"));

    // While an answer streams, the chip names what actually serves it.
    act(() => useStreamStore.setState({ isStreaming: true, currentProvider: "ollama", currentModel: "llama3.2" }));
    expect(screen.getByTitle(/^LLM:/)).toHaveAttribute("title", expect.stringContaining("Ollama"));
    act(() => useStreamStore.setState({ isStreaming: false, currentProvider: "", currentModel: "" }));
  });

  it("a provider switched in the footer is reflected in open Settings", async () => {
    render(<LLMSettings />);
    // Settings opened while Ollama is active: Ollama is the selected card.
    expect(screen.getByRole("button", { name: /^Ollama/ })).toHaveAttribute("aria-pressed", "true");

    // The footer in the other window switches to Claude; the store's
    // cross-window sync (onKeyChange) applies it here.
    act(() => useConfigStore.setState({ llmProvider: "claude_cli", llmModel: "haiku" }));

    expect(screen.getByText(/Active: Claude \(subscription\)/)).toBeInTheDocument();
    // Settings shows the provider that is actually active...
    expect(claudeCard()).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: /^Ollama/ })).toHaveAttribute("aria-pressed", "false");
    // ...and doesn't offer to "activate" the provider that was just replaced.
    expect(screen.queryByRole("button", { name: /set .* as active provider/i })).not.toBeInTheDocument();
  });
});
