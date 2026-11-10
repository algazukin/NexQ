import { describe, expect, it } from "vitest";
import { acceleratorFromEvent, reservedShortcutAction } from "../lib/shortcutLabel";

describe("screen task shortcuts", () => {
  it("reserves both screen actions against equivalent stealth bindings", () => {
    // Arrange
    const shortcuts = ["alt+ctrl+s", "Control+Shift+enter", "Ctrl+Shift+Return"];
    // Act
    const actions = shortcuts.map((shortcut) => reservedShortcutAction(shortcut, false));
    // Assert
    expect(actions).toEqual(["Capture screen task", "Repeat last screen region", "Repeat last screen region"]);
  });

  it("recognizes Enter while recording a custom shortcut so reserved repeat cannot be stolen", () => {
    // Arrange
    const event = { key: "Enter", code: "Enter", ctrlKey: true, shiftKey: true, metaKey: false, altKey: false };
    // Act
    const accelerator = acceleratorFromEvent(event, false);
    // Assert
    expect(accelerator).toBe("CmdOrCtrl+Shift+Enter");
    expect(reservedShortcutAction(accelerator!, false)).toBe("Repeat last screen region");
  });
});
