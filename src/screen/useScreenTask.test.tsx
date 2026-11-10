import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { listeners, invoke, showOverlayWindow } = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { payload: unknown }) => void>>(),
  invoke: vi.fn(),
  showOverlayWindow: vi.fn(async () => {}),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async (name: string, handler: (event: { payload: unknown }) => void) => {
    const handlers = listeners.get(name) ?? new Set();
    handlers.add(handler);
    listeners.set(name, handlers);
    return () => { handlers.delete(handler); if (!handlers.size) listeners.delete(name); };
  },
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("../lib/windows", () => ({ showOverlayWindow }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ get: async () => undefined, set: async () => {}, onKeyChange: async () => () => {} }) }));
import { useScreenTask } from "./useScreenTask";
import { useScreenTaskStore } from "./screenTaskStore";
import { useStreamStore } from "../stores/streamStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useToastStore } from "../stores/toastStore";

beforeEach(() => {
  listeners.clear();
  invoke.mockReset(); invoke.mockResolvedValue(undefined);
  showOverlayWindow.mockClear();
  useScreenTaskStore.setState({ capture: null });
  useStreamStore.getState().resetForMeeting();
  useMeetingStore.setState({ activeMeeting: null, currentView: "launcher", settingsOpen: true });
  useToastStore.setState({ toasts: [] });
});

describe("screen task event ownership", () => {
  it("handles each capture only once in the overlay and keeps the preview out of the prompt", async () => {
    // Arrange
    renderHook(() => useScreenTask("launcher"));
    const overlay = renderHook(() => useScreenTask("overlay"));
    await waitFor(() => expect(listeners.get("nexq:screen-task-captured")?.size).toBe(1));
    const capture = { id: "c1", image_url: "data:image/png;base64,private", width: 100, height: 100 };
    // Act
    act(() => {
      for (const listener of listeners.get("nexq:screen-task-captured")!) {
        listener({ payload: capture }); listener({ payload: capture });
      }
    });
    // Assert
    await waitFor(() => expect(invoke.mock.calls.filter(([name]) => name === "generate_screen_task")).toHaveLength(1));
    expect(useMeetingStore.getState().currentView).toBe("overlay");
    expect(useMeetingStore.getState().settingsOpen).toBe(false);
    expect(useScreenTaskStore.getState().capture).toEqual(capture);
    expect(JSON.stringify(invoke.mock.calls)).not.toContain("private");
    overlay.unmount();
    await waitFor(() => expect(listeners.size).toBe(0));
  });

  it("shows forwarded shortcut failures in the visible overlay", async () => {
    // Arrange
    renderHook(() => useScreenTask("overlay"));
    await waitFor(() => expect(listeners.has("nexq:screen-task-error")).toBe(true));
    // Act
    act(() => {
      for (const listener of listeners.get("nexq:screen-task-error")!) listener({ payload: "Stop the current answer before capturing another task." });
    });
    // Assert
    expect(useToastStore.getState().toasts).toEqual([expect.objectContaining({ type: "error", message: "Stop the current answer before capturing another task." })]);
  });
});


it("handles automatic requests only in the overlay with capture reserved through generation", async () => {
  // Arrange
  renderHook(() => useScreenTask("launcher"));
  renderHook(() => useScreenTask("overlay"));
  const frame = { id: "automatic-owner", image_url: "private", width: 100, height: 100 };
  let finishCapture!: (value: unknown) => void;
  invoke.mockImplementation((command) => command === "capture_screen_task"
    ? new Promise((resolve) => { finishCapture = resolve; }) : Promise.resolve());
  await waitFor(() => expect(listeners.get("nexq:screen-task-requested")?.size).toBe(1));
  // Act
  act(() => {
    for (const listener of listeners.get("nexq:screen-task-requested")!) listener({ payload: undefined });
  });
  // Assert
  expect(useStreamStore.getState().phase).toBe("sending");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["capture_screen_task"]);
  await act(async () => { finishCapture(frame); });
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["capture_screen_task", "generate_screen_task"]);
  expect(useScreenTaskStore.getState().capture).toEqual(frame);
});


it("keeps the requested review action when the launcher forwards it to the overlay", async () => {
  // Arrange
  renderHook(() => useScreenTask("launcher"));
  renderHook(() => useScreenTask("overlay"));
  const capture = { id: "review-event", image_url: "private", width: 100, height: 100 };
  invoke.mockImplementation((command) => Promise.resolve(command === "capture_screen_task" ? capture : undefined));
  await waitFor(() => expect(listeners.get("nexq:screen-task-requested")?.size).toBe(1));
  // Act
  await act(async () => {
    for (const listener of listeners.get("nexq:screen-task-requested")!) {
      listener({ payload: { action: "review" } });
    }
  });
  // Assert
  expect(invoke.mock.calls.filter(([command]) => command === "generate_screen_task")).toEqual([
    ["generate_screen_task", expect.objectContaining({ action: "review", brief: true, captureId: "review-event" })],
  ]);
});
