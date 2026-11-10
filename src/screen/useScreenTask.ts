import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { showToast } from "../stores/toastStore";
import { answerScreenCapture, captureAndAnalyzeScreen } from "./screenTask";
import type { ScreenAction, ScreenCapture } from "./capture";

export function useScreenTask(windowLabel: string) {
  useEffect(() => {
    if (windowLabel !== "overlay") {
      return;
    }
    let disposed = false;
    const reportError = (error: unknown) => {
      showToast(error instanceof Error ? error.message : String(error), "error");
    };
    const requests = listen<{ action?: ScreenAction } | undefined>("nexq:screen-task-requested", ({ payload }) => {
      if (!disposed) {
        captureAndAnalyzeScreen(payload?.action === "review" ? "review" : "solve").catch(reportError);
      }
    });
    const subscription = listen<ScreenCapture>("nexq:screen-task-captured", ({ payload }) => {
      if (!disposed) {
        answerScreenCapture(payload).catch(reportError);
      }
    });
    const errors = listen<string>("nexq:screen-task-error", ({ payload }) => {
      if (!disposed) {
        showToast(payload, "error");
      }
    });
    return () => {
      disposed = true;
      requests.then((unlisten) => unlisten());
      subscription.then((unlisten) => unlisten());
      errors.then((unlisten) => unlisten());
    };
  }, [windowLabel]);
}
