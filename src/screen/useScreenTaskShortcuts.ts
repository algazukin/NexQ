import { emitTo } from "@tauri-apps/api/event";
import { useEffect } from "react";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { showToast } from "../stores/toastStore";
import { analyzeScreen, recaptureScreenRegion } from "./screenTask";

// Serialize effect setup/cleanup so StrictMode cannot remove the next mount's handler.
let shortcutLifecycle = Promise.resolve();

export function useScreenTaskShortcuts(windowLabel: string) {
  useEffect(() => {
    if (windowLabel !== "launcher") return;
    let disposed = false;
    const registered: string[] = [];
    const reportError = (err: unknown) => {
      const message = err instanceof Error ? err.message : String(err);
      showToast(message, "error");
      // The shortcut owner is often hidden behind the overlay during a meeting.
      emitTo("overlay", "nexq:screen-task-error", message).catch(() => {});
    };
    const definitions = [
      { key: "CmdOrCtrl+Alt+S", action: analyzeScreen },
      { key: "CmdOrCtrl+Shift+Enter", action: recaptureScreenRegion },
    ];
    shortcutLifecycle = shortcutLifecycle.then(async () => {
      for (const { key, action } of definitions) {
        if (disposed) return;
        try {
          await register(key, (event) => {
            if (!disposed && event.state === "Pressed") action().catch(reportError);
          });
          registered.push(key);
        } catch (err) {
          if (!disposed) reportError(`Couldn't register ${key}: ${String(err)}`);
        }
      }
    });
    return () => {
      disposed = true;
      shortcutLifecycle = shortcutLifecycle.then(async () => {
        for (const key of registered) await unregister(key).catch(() => {});
      });
    };
  }, [windowLabel]);
}
