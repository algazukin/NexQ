import { useInterviewHintMode } from "./hintMode";
import { useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, type PhysicalSize } from "@tauri-apps/api/dpi";
import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useHintStore } from "./hintStore";

// Serialize native operations across React updates and StrictMode remounts.
let changes = Promise.resolve();
let previousSize: PhysicalSize | null = null;

export function useHintWindow(windowLabel: string): void {
  const enabled = useInterviewHintMode();
  const view = useMeetingStore((state) => state.currentView);
  const settingsOpen = useMeetingStore((state) => state.settingsOpen);
  const expanded = useHintStore((state) => state.expanded);
  useEffect(() => {
    if (windowLabel !== "overlay") {
      return;
    }
    let disposed = false;
    changes = changes.then(async () => {
      if (disposed) {
        return;
      }
      const window = getCurrentWindow();
      const passive = enabled && view !== "settings" && !settingsOpen;
      const compact = passive && view === "overlay";
      await window.setFocusable(!passive);
      if (compact) {
        if (!previousSize) {
          previousSize = await window.innerSize();
        }
        await window.setMinSize(new LogicalSize(340, 180));
        await window.setSize(new LogicalSize(440, expanded ? 560 : 260));
      } else if (previousSize) {
        const restore = previousSize;
        previousSize = null;
        await window.setMinSize(new LogicalSize(400, 480));
        await window.setSize(restore);
        if (!passive && await window.isVisible()) {
          await window.setFocus();
        }
      }
    }).catch((error) => console.warn("[hints] Could not update overlay window:", error));
    return () => { disposed = true; };
  }, [windowLabel, enabled, view, settingsOpen, expanded]);
}
