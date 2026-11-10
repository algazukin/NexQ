import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke } = vi.hoisted(() => ({ invoke: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
import { ScreenCaptureWindow } from "./ScreenCaptureWindow";

beforeEach(() => {
  invoke.mockReset();
  invoke.mockImplementation(async (command: string) => command === "get_screen_capture"
    ? { id: "capture-1", image_url: "data:image/png;base64,test", width: 2000, height: 1000 }
    : undefined);
  if (!window.PointerEvent) window.PointerEvent = MouseEvent as typeof PointerEvent;
});

function ready() {
  const selector = screen.getByRole("application", { name: "Select a screen task" });
  vi.spyOn(selector, "getBoundingClientRect").mockReturnValue({ x: 0, y: 0, left: 0, top: 0, right: 1000, bottom: 500, width: 1000, height: 500, toJSON() {} });
  Object.assign(selector, { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() });
  fireEvent.load(screen.getByAltText("Frozen desktop"));
  return selector;
}

describe("screen capture selector", () => {
  it("submits the physical region once on release without another click", async () => {
    // Arrange
    render(<ScreenCaptureWindow />);
    await screen.findByAltText("Frozen desktop");
    const selector = ready();
    // Act
    fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 400, clientY: 200 });
    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 100, clientY: 100 });
    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 100, clientY: 100 });
    // Assert
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("finish_screen_capture", { captureId: "capture-1", region: { x: 200, y: 200, width: 600, height: 200 } }));
    expect(invoke.mock.calls.filter(([command]) => command === "finish_screen_capture")).toHaveLength(1);
    expect(screen.getByText(/Release to analyze/)).toBeInTheDocument();
  });

  it("Escape cancels and never submits an active selection", async () => {
    // Arrange
    render(<ScreenCaptureWindow />);
    await screen.findByAltText("Frozen desktop");
    const selector = ready();
    fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
    // Act
    fireEvent.keyDown(window, { key: "Escape" });
    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 400, clientY: 300 });
    // Assert
    await waitFor(() => expect(invoke).toHaveBeenCalledWith("cancel_screen_capture", { captureId: "capture-1" }));
    expect(invoke.mock.calls.some(([command]) => command === "finish_screen_capture")).toBe(false);
  });

  it("keeps the selector open for tiny drags and blocks dragging before the image loads", async () => {
    // Arrange
    render(<ScreenCaptureWindow />);
    await screen.findByAltText("Frozen desktop");
    const selector = screen.getByRole("application", { name: "Select a screen task" });
    // Act
    fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 400, clientY: 300 });
    ready();
    fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 1, clientY: 1 });
    fireEvent.pointerUp(selector, { pointerId: 1, clientX: 2, clientY: 2 });
    // Assert
    expect(invoke.mock.calls.some(([command]) => command === "finish_screen_capture")).toBe(false);
    expect(screen.getByRole("status")).toHaveTextContent("Select an area at least 8 × 8 pixels");
  });
});

it("Escape can cancel using the window capture id while the image is still loading", async () => {
  // Arrange
  window.history.replaceState({}, "", "?view=screen-capture&captureId=loading-capture");
  invoke.mockReturnValueOnce(new Promise(() => {}));
  render(<ScreenCaptureWindow />);
  // Act
  fireEvent.keyDown(window, { key: "Escape" });
  // Assert
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("cancel_screen_capture", { captureId: "loading-capture" }));
  window.history.replaceState({}, "", "/");
});

it("still selects when the webview cannot acquire pointer capture", async () => {
  // Arrange
  render(<ScreenCaptureWindow />);
  await screen.findByAltText("Frozen desktop");
  const selector = ready();
  Object.assign(selector, { setPointerCapture: () => { throw new Error("Pointer is no longer active"); } });
  // Act
  fireEvent.pointerDown(selector, { button: 0, pointerId: 1, clientX: 100, clientY: 100 });
  fireEvent.pointerUp(selector, { pointerId: 1, clientX: 400, clientY: 200 });
  // Assert
  await waitFor(() => expect(invoke).toHaveBeenCalledWith("finish_screen_capture", { captureId: "capture-1", region: { x: 200, y: 200, width: 600, height: 200 } }));
});
