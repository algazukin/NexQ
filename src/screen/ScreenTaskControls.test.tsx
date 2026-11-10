import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, cancelGeneration, emitTo } = vi.hoisted(() => ({ invoke: vi.fn(), emitTo: vi.fn(async () => {}), cancelGeneration: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo }));
vi.mock("../lib/ipc", () => ({ cancelGeneration }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ get: async () => undefined, set: async () => {}, onKeyChange: async () => () => {} }) }));
import { ScreenTaskButtons, ScreenTaskPreview } from "./ScreenTaskControls";
import { useScreenTaskStore } from "./screenTaskStore";
import { useStreamStore } from "../stores/streamStore";
import { EMPTY_HINT, useHintStore } from "../hints/hintStore";

beforeEach(() => {
  useHintStore.setState({ ...EMPTY_HINT });
  emitTo.mockClear();
  invoke.mockReset(); invoke.mockResolvedValue(undefined); cancelGeneration.mockClear();
  useScreenTaskStore.setState({ capture: null, action: "solve" });
  useStreamStore.getState().resetForMeeting();
});

describe("screen task controls", () => {
  it("captures automatically and enables repeat after a capture exists", async () => {
    // Arrange
    render(<ScreenTaskButtons />);
    expect(screen.getByRole("button", { name: /Repeat last region/ })).toBeDisabled();
    // Act
    fireEvent.click(screen.getByRole("button", { name: /Capture screen task/ }));
    act(() => useScreenTaskStore.setState({ capture: { id: "c", image_url: "private", width: 100, height: 80 } }));
    await waitFor(() => expect(screen.getByRole("button", { name: /Repeat last region/ })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: /Repeat last region/ }));
    // Assert
    await waitFor(() => expect(emitTo).toHaveBeenCalledWith("overlay", "nexq:screen-task-requested"));
    expect(invoke).toHaveBeenCalledWith("recapture_screen_region");
  });

  it("protects a running answer and lets the user stop a screen answer", async () => {
    // Arrange
    render(<ScreenTaskButtons />);
    act(() => useStreamStore.getState().startStream("ScreenTask", "codex", "Custom HTTP"));
    // Act
    fireEvent.click(screen.getByRole("button", { name: "Stop screen answer" }));
    // Assert
    expect(screen.getByRole("button", { name: /Capture screen task/ })).toBeDisabled();
    await waitFor(() => expect(cancelGeneration).toHaveBeenCalledOnce());
  });

  it("shows the in-memory capture thumbnail with its physical dimensions", () => {
    // Arrange
    useScreenTaskStore.setState({ capture: { id: "c", image_url: "data:image/png;base64,private", width: 800, height: 600 } });
    // Act
    render(<ScreenTaskPreview />);
    // Assert
    expect(screen.getByAltText("Captured screen task")).toHaveAttribute("src", "data:image/png;base64,private");
    expect(screen.getByText("800 × 600")).toBeInTheDocument();
  });
});

it("allows stopping a screen request before its stream starts", async () => {
  // Arrange
  useStreamStore.getState().setPending("ScreenTask", "pending-screen");
  render(<ScreenTaskButtons />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: "Stop screen answer" }));
  // Assert
  await waitFor(() => expect(cancelGeneration).toHaveBeenCalledOnce());
});

it("retains manual area selection on Shift-click", async () => {
  // Arrange
  render(<ScreenTaskButtons />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: /Capture screen task/ }), { shiftKey: true });
  // Assert
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("start_screen_capture"));
  expect(invoke).not.toHaveBeenCalledWith("capture_screen_task");
});


it("shows Code Review in standard controls and routes it to the overlay", async () => {
  // Arrange
  render(<ScreenTaskButtons />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: "Code Review" }));
  // Assert
  await waitFor(() => expect(emitTo).toHaveBeenCalledWith("overlay", "nexq:screen-task-requested", { action: "review" }));
});

it("uses the same review capture for detailed review in the full window", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "review-same", image_url: "private", width: 100, height: 100 }, action: "review" });
  render(<ScreenTaskButtons />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: "Code Review подробно" }));
  // Assert
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("generate_screen_task", expect.objectContaining({ captureId: "review-same", action: "review", brief: false })));
  expect(invoke).not.toHaveBeenCalledWith("capture_screen_task");
});


it("invalidates interrupted review details when Stop is clicked in standard controls", async () => {
  // Arrange
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "review", captureId: "code", requestId: "details-running", requestKind: "details", shortAnswer: "line // bug", details: "incomplete review", expanded: true });
  useStreamStore.getState().startStream("CodeReview", "model", "provider", { requestId: "details-running" });
  render(<ScreenTaskButtons />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: "Stop screen answer" }));
  // Assert
  await waitFor(() => expect(cancelGeneration).toHaveBeenCalledOnce());
  expect(useHintStore.getState()).toMatchObject({ requestId: null, detailsReady: false, details: "" });
});
