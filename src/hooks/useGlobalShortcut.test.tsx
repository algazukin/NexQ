const emitTo = vi.hoisted(() => vi.fn(async (..._args: unknown[]) => {}));
vi.mock("@tauri-apps/api/event", () => ({ emitTo }));
import { StrictMode } from "react";
import { renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { bindings, register, unregister } = vi.hoisted(() => {
  const bindings = new Map<string, (event: { state: string }) => void>();
  return { bindings, register: vi.fn(async (key: string, handler: (event: { state: string }) => void) => { bindings.set(key, handler); }), unregister: vi.fn(async (key: string) => { bindings.delete(key); }) };
});
vi.mock("@tauri-apps/plugin-global-shortcut", () => ({ register, unregister }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ get: async () => undefined, set: async () => {}, onKeyChange: async () => () => {} }) }));
vi.mock("../lib/ipc", () => ({ isQuitPending: async () => false, toggleTrayVisibility: vi.fn(async () => {}) }));
vi.mock("../lib/userAction", () => ({ runUserAction: async () => {} }));
vi.mock("./useUpdater", () => ({ endMeetingFromThisWindow: async () => true }));
vi.mock("../lib/windows", () => ({ isOverlayVisible: async () => false, showLauncherWindow: async () => {}, showMeetingOverlay: vi.fn(async () => {}), meetingShortcutAction: () => "ignore" }));
import { showMeetingOverlay } from "../lib/windows";
import { useMeetingStore } from "../stores/meetingStore";
import { useStreamStore } from "../stores/streamStore";
import { useGlobalShortcut } from "./useGlobalShortcut";
import { useScreenTaskShortcuts } from "../screen/useScreenTaskShortcuts";

beforeEach(() => { bindings.clear(); emitTo.mockClear(); useStreamStore.getState().resetForMeeting(); register.mockClear(); unregister.mockClear(); vi.mocked(showMeetingOverlay).mockClear(); useMeetingStore.setState({ activeMeeting: null }); });

describe("global shortcut ownership", () => {
  it("registers global actions in the launcher only", async () => {
    // Arrange
    const overlay = renderHook(() => { useGlobalShortcut("overlay"); useScreenTaskShortcuts("overlay"); });
    // Act
    await new Promise((resolve) => setTimeout(resolve, 0));
    // Assert
    expect(register).not.toHaveBeenCalled();
    overlay.unmount();
  });

  it("retains one handler per screen action through StrictMode setup and cleanup", async () => {
    // Arrange
    const wrapper = ({ children }: { children: React.ReactNode }) => <StrictMode>{children}</StrictMode>;
    // Act
    const launcher = renderHook(() => { useGlobalShortcut("launcher"); useScreenTaskShortcuts("launcher"); }, { wrapper });
    // Assert
    await waitFor(() => expect(bindings.has("CmdOrCtrl+Shift+Enter")).toBe(true));
    expect(bindings.has("CmdOrCtrl+Alt+S")).toBe(true);
    expect(bindings.has("CmdOrCtrl+M")).toBe(true);
    launcher.unmount();
    await waitFor(() => expect(bindings.size).toBe(0));
  });
});

it("can reopen the screen answer overlay when there is no meeting", async () => {
  // Arrange
  const launcher = renderHook(() => useGlobalShortcut("launcher"));
  await waitFor(() => expect(bindings.has("CmdOrCtrl+B")).toBe(true));
  // Act
  bindings.get("CmdOrCtrl+B")!({ state: "Pressed" });
  // Assert
  await waitFor(() => expect(showMeetingOverlay).toHaveBeenCalledOnce());
  launcher.unmount();
  await waitFor(() => expect(bindings.size).toBe(0));
});
it("forwards busy screenshot shortcut errors to the overlay while the launcher is hidden", async () => {
  // Arrange
  useStreamStore.getState().setPending("Assist", "busy-answer");
  const launcher = renderHook(() => useScreenTaskShortcuts("launcher"));
  await waitFor(() => expect(bindings.has("CmdOrCtrl+Alt+S")).toBe(true));
  // Act
  bindings.get("CmdOrCtrl+Alt+S")!({ state: "Pressed" });
  // Assert
  await waitFor(() => expect(emitTo).toHaveBeenCalledWith("overlay", "nexq:screen-task-error", "Stop the current answer before capturing another task."));
  launcher.unmount();
  await waitFor(() => expect(bindings.size).toBe(0));
});

it("preserves screen capture when a saved hint binding conflicts with it", async () => {
  // Arrange
  const { useConfigStore } = await import("../stores/configStore");
  const previous = useConfigStore.getState().hotkeys;
  useConfigStore.setState({ hotkeys: { ...previous, hint_now: "CmdOrCtrl+Alt+S" } });
  const captureHook = renderHook(() => useScreenTaskShortcuts("launcher"));
  await waitFor(() => expect(bindings.has("CmdOrCtrl+Alt+S")).toBe(true));
  const captureHandler = bindings.get("CmdOrCtrl+Alt+S");
  // Act
  const globalHook = renderHook(() => useGlobalShortcut("launcher"));
  await waitFor(() => expect(bindings.has("CmdOrCtrl+B")).toBe(true));
  // Assert
  expect(bindings.get("CmdOrCtrl+Alt+S")).toBe(captureHandler);
  globalHook.unmount();
  captureHook.unmount();
  await waitFor(() => expect(bindings.size).toBe(0));
  useConfigStore.setState({ hotkeys: previous });
});


it("toggles tray visibility with Ctrl+Alt+B without ending the meeting", async () => {
  // Arrange
  const { toggleTrayVisibility } = await import("../lib/ipc");
  vi.mocked(toggleTrayVisibility).mockClear();
  useMeetingStore.setState({ activeMeeting: { id: "running" } as never });
  const hook = renderHook(() => useGlobalShortcut("launcher"));
  await waitFor(() => expect(bindings.has("CmdOrCtrl+Alt+B")).toBe(true));
  // Act
  bindings.get("CmdOrCtrl+Alt+B")!({ state: "Pressed" });
  // Assert
  await waitFor(() => expect(toggleTrayVisibility).toHaveBeenCalledTimes(1));
  expect(useMeetingStore.getState().activeMeeting?.id).toBe("running");
  hook.unmount();
  await waitFor(() => expect(bindings.size).toBe(0));
});
