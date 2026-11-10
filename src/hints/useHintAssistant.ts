import { isInterviewHintMode, useInterviewHintMode } from "./hintMode";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { useConfigStore } from "../stores/configStore";
import { useAIActionsStore } from "../stores/aiActionsStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useStreamStore } from "../stores/streamStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { EMPTY_HINT, useHintStore } from "./hintStore";
import { useScreenTaskStore } from "../screen/screenTaskStore";
import { HintScheduler } from "./scheduler";
import { requestHint } from "./actions";

export function useHintAssistant(windowLabel: string): void {
  const meetingId = useMeetingStore((state) => state.activeMeeting?.id);
  const enabled = useInterviewHintMode();
  const automatic = useAIActionsStore((state) => state.configs.globalDefaults.autoTrigger);

  useEffect(() => {
    if (windowLabel === "overlay") {
      const stream = useStreamStore.getState();
      const screenInFlight = (stream.currentMode === "ScreenTask" || stream.currentMode === "CodeReview") && (stream.isStreaming || stream.phase !== "idle");
      if (!screenInFlight) {
        useHintStore.setState({ ...EMPTY_HINT });
        useScreenTaskStore.setState({ conversation: null, requestTranscript: undefined });
      }
    }
  }, [windowLabel, meetingId]);

  useEffect(() => {
    if (windowLabel !== "overlay") {
      return;
    }
    const unsubscribe = useStreamStore.subscribe((state, previous) => {
      const hint = useHintStore.getState();
      if (!hint.requestId || (state.streamMeta?.requestId ?? previous.streamMeta?.requestId) !== hint.requestId) {
        return;
      }
      if (state.currentMode !== "Hint" && state.currentMode !== "HintDetails" && state.currentMode !== "ScreenTask" && state.currentMode !== "CodeReview") {
        return;
      }
      if (state.error) {
        useHintStore.setState({ error: state.error });
      }
      if (!state.isStreaming && previous.isStreaming && hint.requestKind === "details" && !state.error) {
        useHintStore.setState({ detailsReady: true });
      }
      if (state.currentContent) {
        const detailed = state.currentMode === "HintDetails" || ((state.currentMode === "ScreenTask" || state.currentMode === "CodeReview") && hint.requestKind === "details");
        useHintStore.setState(detailed ? { details: state.currentContent } : { shortAnswer: state.currentContent });
      }
    });
    let disposed = false;
    const events = listen<{ action: "now" | "details" }>("nexq:hint-action", ({ payload }) => {
      if (!disposed && isInterviewHintMode()) {
        if (payload.action === "details" && useHintStore.getState().expanded) {
          useHintStore.setState({ expanded: false });
        } else {
          requestHint(payload.action === "details").catch(() => {});
        }
      }
    });
    return () => {
      disposed = true;
      unsubscribe();
      events.then((unlisten) => unlisten());
    };
  }, [windowLabel]);

  useEffect(() => {
    if (windowLabel !== "overlay" || !meetingId || !enabled || !automatic) {
      return;
    }
    const scheduler = new HintScheduler(
      (question) => requestHint(false, question),
      () => {
        const stream = useStreamStore.getState();
        const hint = useHintStore.getState();
        return !stream.isStreaming && stream.phase === "idle" && !hint.expanded && (hint.kind !== "screen" || hint.screenAction === "solve");
      },
      useTranscriptStore.getState().segments,
    );
    const unsubscribe = useTranscriptStore.subscribe((state) => scheduler.observe(state.segments));
    const stopWatchingStream = useStreamStore.subscribe((state, previous) => {
      if (previous.phase === "idle" && state.phase !== "idle") {
        scheduler.acknowledge(useHintStore.getState().question);
      }
      if (previous.isStreaming && !state.isStreaming) {
        scheduler.holdForReading();
      }
    });
    return () => {
      unsubscribe();
      stopWatchingStream();
      scheduler.dispose();
    };
  }, [windowLabel, meetingId, enabled, automatic]);
}
