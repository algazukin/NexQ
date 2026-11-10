import { act, renderHook, waitFor } from "@testing-library/react";
import { expect, it, vi } from "vitest";
const native = vi.hoisted(() => ({
  setFocusable: vi.fn(async () => {}), setMinSize: vi.fn(async () => {}),
  setSize: vi.fn(async () => {}), setFocus: vi.fn(async () => {}),
  innerSize: vi.fn(async () => ({ width: 500, height: 700 })), isVisible: vi.fn(async () => true),
}));
vi.mock("@tauri-apps/api/window", () => ({ getCurrentWindow: () => native }));
import { useHintWindow } from "./useHintWindow";
import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useHintStore } from "./hintStore";

it("stays passive before showing, resizes for details and restores the classic window", async () => {
  // Arrange
  useConfigStore.setState({ hintsEnabled: true });
  useMeetingStore.setState({ currentView: "launcher", settingsOpen: false, activeMeeting: { id: "m" } as never, aiScenario: "interview" });
  useHintStore.setState({ expanded: false });
  renderHook(() => useHintWindow("overlay"));
  await waitFor(() => expect(native.setFocusable).toHaveBeenLastCalledWith(false));
  // Act
  act(() => useMeetingStore.setState({ currentView: "overlay" }));
  await waitFor(() => expect(native.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 440, height: 260 })));
  act(() => useHintStore.setState({ expanded: true }));
  await waitFor(() => expect(native.setSize).toHaveBeenLastCalledWith(expect.objectContaining({ width: 440, height: 560 })));
  // Assert
  expect(native.setFocus).not.toHaveBeenCalled();
  act(() => useConfigStore.setState({ hintsEnabled: false }));
  await waitFor(() => expect(native.setSize).toHaveBeenLastCalledWith({ width: 500, height: 700 }));
  expect(native.setFocusable).toHaveBeenLastCalledWith(true);
});
