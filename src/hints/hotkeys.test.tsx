import { fireEvent, render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { HotkeySettings } from "../settings/HotkeySettings";
import { useConfigStore } from "../stores/configStore";

it("rejects a hint binding that would replace the screen capture shortcut", () => {
  // Arrange
  const original = useConfigStore.getState().hotkeys.hint_now;
  render(<HotkeySettings />);
  fireEvent.click(screen.getByRole("button", { name: /Подсказка сейчас/ }));
  // Act
  fireEvent.keyDown(window, { key: "s", code: "KeyS", ctrlKey: true, altKey: true });
  // Assert
  expect(useConfigStore.getState().hotkeys.hint_now).toBe(original);
  expect(screen.getByText(/Capture screen task/)).toBeTruthy();
});
