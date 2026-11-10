import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ipc = vi.hoisted(() => ({
  check: vi.fn(),
  download: vi.fn(),
  pending: vi.fn(),
}));

vi.mock("../lib/ipc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../lib/ipc")>()),
  checkForUpdate: ipc.check,
  downloadUpdate: ipc.download,
  getPendingUpdate: ipc.pending,
}));
vi.mock("@tauri-apps/api/webviewWindow", () => ({
  getCurrentWebviewWindow: () => ({ label: "launcher" }),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: async () => () => {},
  emit: async () => {},
}));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ get: async (key: string) => key === "auto_update" ? true : undefined }),
}));
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn() }));

import { checkForUpdates, useUpdater } from "./useUpdater";
import { AboutSettings } from "../settings/AboutSettings";
import { useUpdaterStore } from "../stores/updaterStore";

describe("local fork updates", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    ipc.check.mockResolvedValue({ version: "99.0.0", body: "Official release" });
    ipc.download.mockResolvedValue({ version: "99.0.0" });
    ipc.pending.mockResolvedValue(null);
    useUpdaterStore.getState().reset();
    useUpdaterStore.getState().setAutoUpdate(true);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not check or download upstream updates even with saved automatic updates enabled", async () => {
    // Arrange
    const hook = renderHook(() => useUpdater());

    // Act
    await act(async () => {
      await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000 + 10_000);
    });
    hook.unmount();

    // Assert
    expect(ipc.check).not.toHaveBeenCalled();
    expect(ipc.download).not.toHaveBeenCalled();
  });

  it("keeps manual checks from offering an official replacement", async () => {
    // Arrange
    const options = { manual: true };

    // Act
    await checkForUpdates(options);

    // Assert
    expect(ipc.check).not.toHaveBeenCalled();
    expect(ipc.download).not.toHaveBeenCalled();
  });

  it("explains manual installation and disables the automatic update switch", async () => {
    // Arrange
    render(<AboutSettings />);

    // Act
    await act(async () => {});
    const toggle = screen.getByRole("switch", { name: "Toggle automatic updates" });

    // Assert
    expect(screen.getByText("Local fork — manual updates")).toBeTruthy();
    expect(toggle).toBeDisabled();
    expect(toggle).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("button", { name: "Check for updates" })).toBeNull();
  });
});
