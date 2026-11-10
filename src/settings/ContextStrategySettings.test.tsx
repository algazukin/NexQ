import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ContextStrategy } from "../lib/types";

vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ set: async () => {} }) }));
vi.mock("../hooks/useRagEvents", () => ({ useRagEvents: () => {} }));
vi.mock("../lib/ipc", () => ({
  getRagConfig: vi.fn(async () => ({ enabled: false })),
  updateRagConfig: vi.fn(async () => {}),
  getRagStatus: vi.fn(async () => null),
  getGeminiCacheStatus: vi.fn(async () => null),
  testOllamaEmbeddingConnection: vi.fn(),
}));
vi.mock("../stores/toastStore", () => ({ showToast: vi.fn() }));

import { ContextStrategySettings } from "./ContextStrategySettings";
import { useConfigStore } from "../stores/configStore";
import { useRagStore } from "../stores/ragStore";
import { testOllamaEmbeddingConnection } from "../lib/ipc";
import { showToast } from "../stores/toastStore";

describe("optional Ollama document search connection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useConfigStore.setState({ _loaded: true, llmProvider: "codex_cli", contextStrategy: "stuffing" });
    useRagStore.setState({ ragConfig: null, ollamaStatus: null, error: null, isCheckingConnection: false });
    vi.mocked(testOllamaEmbeddingConnection).mockRejectedValue(new Error("ECONNREFUSED"));
  });

  afterEach(cleanup);

  it.each<ContextStrategy>(["stuffing", "gemini_cache"])("does not probe Ollama for %s", async (strategy) => {
    // Arrange
    useConfigStore.setState({ contextStrategy: strategy });
    // Act
    await act(async () => { render(<ContextStrategySettings />); });
    // Assert
    expect(testOllamaEmbeddingConnection).not.toHaveBeenCalled();
    expect(showToast).not.toHaveBeenCalled();
  });

  it("waits for configuration, then checks only an enabled local index without a toast", async () => {
    // Arrange
    useConfigStore.setState({ _loaded: false, contextStrategy: "local_rag" });
    // Act
    await act(async () => { render(<ContextStrategySettings />); });
    // Assert
    expect(testOllamaEmbeddingConnection).not.toHaveBeenCalled();

    // Act
    await act(async () => { useConfigStore.setState({ _loaded: true }); });
    // Assert
    await waitFor(() => expect(testOllamaEmbeddingConnection).toHaveBeenCalledTimes(1));
    expect(useRagStore.getState().ollamaStatus?.connected).toBe(false);
    expect(showToast).not.toHaveBeenCalled();
  });

  it("checks on enabling local search and explains a failed manual retry", async () => {
    // Arrange
    await act(async () => { render(<ContextStrategySettings />); });
    // Act
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: /Local RAG/ })); });
    // Assert
    expect(testOllamaEmbeddingConnection).toHaveBeenCalledTimes(1);
    expect(showToast).not.toHaveBeenCalled();

    // Act
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Test Connection" })); });
    // Assert
    expect(testOllamaEmbeddingConnection).toHaveBeenCalledTimes(2);
    expect(showToast).toHaveBeenCalledWith("Document search: failed to connect to Ollama", "error");
    expect(useConfigStore.getState().llmProvider).toBe("codex_cli");
  });

  it("keeps a successful manual connection test available for document search", async () => {
    // Arrange
    useConfigStore.setState({ contextStrategy: "local_rag" });
    vi.mocked(testOllamaEmbeddingConnection).mockResolvedValue({ connected: true, models: ["nomic-embed-text"] });
    await act(async () => { render(<ContextStrategySettings />); });
    // Act
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Test Connection" })); });
    // Assert
    expect(showToast).toHaveBeenCalledExactlyOnceWith("Document search: Ollama connected — 1 model available", "success");
    expect(screen.getByText("Ollama Connected")).toBeInTheDocument();
  });
});
