import { emitTo } from "@tauri-apps/api/event";
import { useEffect } from "react";
import {
  register,
  unregister,
} from "@tauri-apps/plugin-global-shortcut";
import { useMeetingStore } from "../stores/meetingStore";
import { useAIActionsStore } from "../stores/aiActionsStore";
import { isQuitPending, toggleTrayVisibility } from "../lib/ipc";
import { runUserAction } from "../lib/userAction";
import { isOverlayVisible, meetingShortcutAction, showLauncherWindow, showMeetingOverlay } from "../lib/windows";
import { endMeetingFromThisWindow } from "./useUpdater";
import { showToast } from "../stores/toastStore";
import { useConfigStore } from "../stores/configStore";
import { normalizeAccelerator, reservedShortcutAction } from "../lib/shortcutLabel";

/** Ctrl+M: end the running meeting (in every window that holds it) or start one. */
async function toggleMeetingFromShortcut(): Promise<void> {
  const store = useMeetingStore.getState();
  const quitPending = store.activeMeeting ? false : await isQuitPending().catch(() => false);
  switch (meetingShortcutAction(!!store.activeMeeting, quitPending)) {
    case "end":
      if (!(await endMeetingFromThisWindow())) {
        showToast("Couldn't finish saving the meeting", "error");
      }
      break;
    case "start":
      await store.startMeetingFlow();
      break;
    case "ignore":
      break;
  }
}

/** Stealth shortcut: hide NexQ from screen sharing, or show it again. */
export async function toggleStealthMode(): Promise<void> {
  const config = useConfigStore.getState();
  const enabled = !config.stealthMode;
  try {
    await config.setStealthMode(enabled);
    showToast(enabled ? "Hidden from screen share" : "Visible in screen share", "info");
  } catch (e) {
    showToast(`Couldn't change screen-share visibility: ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

// Global shortcuts belong to the launcher; every native window has a separate React root.
// Serialize asynchronous setup/cleanup to preserve handlers across StrictMode remounts.
let globalShortcutLifecycle = Promise.resolve();

export function useGlobalShortcut(windowLabel: string) {
  const stealthShortcut = useConfigStore((s) => s.stealthShortcut);
  const hintShortcut = useConfigStore((state) => state.hotkeys.hint_now ?? "CmdOrCtrl+Alt+Space");
  const detailsShortcut = useConfigStore((state) => state.hotkeys.hint_details ?? "CmdOrCtrl+Alt+Enter");

  useEffect(() => {
    if (windowLabel !== "launcher") return;
    let disposed = false;
    const registered: string[] = [];
    const definitions: Array<{ key: string; action: () => Promise<void> }> = [
      { key: "CmdOrCtrl+Alt+B", action: toggleTrayVisibility },
      { key: "CmdOrCtrl+M", action: toggleMeetingFromShortcut },
      { key: "CmdOrCtrl+B", action: async () => {
        if (await isOverlayVisible()) await showLauncherWindow();
        else await showMeetingOverlay();
      } },
      { key: "CmdOrCtrl+,", action: async () => {
        const store = useMeetingStore.getState();
        await showLauncherWindow();
        store.setCurrentView(store.currentView === "settings" ? "launcher" : "settings");
      } },
    ];
    for (const binding of [
      { key: hintShortcut, action: () => emitTo("overlay", "nexq:hint-action", { action: "now" }) },
      { key: detailsShortcut, action: () => emitTo("overlay", "nexq:hint-action", { action: "details" }) },
    ]) {
      const key = normalizeAccelerator(binding.key);
      if (reservedShortcutAction(key) || (stealthShortcut && normalizeAccelerator(stealthShortcut) === key) || definitions.some((item) => normalizeAccelerator(item.key) === key)) {
        console.warn(`[hints] Shortcut ${binding.key} conflicts with another action`);
        continue;
      }
      definitions.push(binding);
    }
    if (stealthShortcut && !reservedShortcutAction(stealthShortcut)) {
      definitions.push({ key: stealthShortcut, action: toggleStealthMode });
    }
    globalShortcutLifecycle = globalShortcutLifecycle.then(async () => {
      for (const { key, action } of definitions) {
        if (disposed) return;
        try {
          await unregister(key).catch(() => {});
          if (disposed) return;
          await register(key, (event) => {
            if (!disposed && event.state === "Pressed") action().catch(() => {});
          });
          registered.push(key);
        } catch (err) {
          console.warn(`Failed to register shortcut ${key}:`, err);
        }
      }
    });
    return () => {
      disposed = true;
      globalShortcutLifecycle = globalShortcutLifecycle.then(async () => {
        for (const key of registered) await unregister(key).catch(() => {});
      });
    };
  }, [windowLabel, stealthShortcut, hintShortcut, detailsShortcut]);
  // Window-level shortcuts (work when window is active/focused)
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const store = useMeetingStore.getState();
      if (!store.activeMeeting) return;

      // Don't trigger if user is typing in an input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      // Check action visibility from the AI actions store
      const actions = useAIActionsStore.getState().configs.actions;
      const isVisible = (mode: string) => actions[mode]?.visible !== false;

      switch (e.code) {
        case "Space":
          if (isVisible("Assist")) {
            e.preventDefault();
            runUserAction("Assist").catch(() => {});
          }
          break;
        case "Numpad1":
        case "Digit1":
          if (!e.ctrlKey && !e.metaKey && !e.altKey && isVisible("WhatToSay")) {
            e.preventDefault();
            runUserAction("WhatToSay").catch(() => {});
          }
          break;
        case "Numpad2":
        case "Digit2":
          if (!e.ctrlKey && !e.metaKey && !e.altKey && isVisible("Shorten")) {
            e.preventDefault();
            runUserAction("Shorten").catch(() => {});
          }
          break;
        case "Numpad3":
        case "Digit3":
          if (!e.ctrlKey && !e.metaKey && !e.altKey && isVisible("FollowUp")) {
            e.preventDefault();
            runUserAction("FollowUp").catch(() => {});
          }
          break;
        case "Numpad4":
        case "Digit4":
          if (!e.ctrlKey && !e.metaKey && !e.altKey && isVisible("Recap")) {
            e.preventDefault();
            runUserAction("Recap").catch(() => {});
          }
          break;
        case "Numpad5":
        case "Digit5":
          if (!e.ctrlKey && !e.metaKey && !e.altKey && isVisible("AskQuestion")) {
            e.preventDefault();
            // Open/focus the Ask input instead of triggering generation directly
            window.dispatchEvent(new Event("nexq:toggle-ask-input"));
          }
          break;
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);
}
