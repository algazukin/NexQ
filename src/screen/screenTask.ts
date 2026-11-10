import { isInterviewHintMode } from "../hints/hintMode";
import { useAIActionsStore } from "../stores/aiActionsStore";
import { useConfigStore } from "../stores/configStore";
import { useHintStore } from "../hints/hintStore";
import { invoke } from "@tauri-apps/api/core";
import { emitTo } from "@tauri-apps/api/event";
import { showOverlayWindow } from "../lib/windows";
import { useScreenTaskStore } from "./screenTaskStore";
import type { ScreenAction, ScreenCapture, ScreenConversation } from "./capture";
import { useMeetingStore } from "../stores/meetingStore";
import { useStreamStore } from "../stores/streamStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { recentScreenTranscript } from "./capture";

// Capture and generation run in the overlay's module instance. Invalidating
// this reservation stops the later model dispatch even if native capture finishes.
let captureReservation: string | null = null;

export function cancelPendingScreenCapture(): void {
  if (captureReservation) {
    useStreamStore.getState().clearPending(captureReservation);
    captureReservation = null;
  }
}

function ensureIdle() {
  const stream = useStreamStore.getState();
  if (stream.isStreaming || stream.phase !== "idle") {
    throw new Error("Stop the current answer before capturing another task.");
  }
}

export async function startScreenCapture(): Promise<void> {
  ensureIdle();
  await invoke("start_screen_capture");
}

export async function recaptureScreenRegion(): Promise<void> {
  ensureIdle();
  await invoke("recapture_screen_region");
}

export async function runScreenTask(captureId: string, detailed = false, action: ScreenAction = "solve", question?: string): Promise<void> {
  ensureIdle();
  const previousHint = { ...useHintStore.getState() };
  const screen = useScreenTaskStore.getState();
  const previousConversation = screen.conversation;
  const meeting = useMeetingStore.getState();
  const elapsedMs = meeting.activeMeeting
    ? meeting.meetingStartTime !== null ? Math.max(0, Date.now() - meeting.meetingStartTime) : meeting.elapsedMs
    : null;
  const segments = useTranscriptStore.getState().segments;
  const attached = previousHint.kind === "screen" && previousHint.captureId === captureId;
  // More expands the answer already on screen, including its original speech snapshot.
  const transcript = detailed && attached && screen.capture?.id === captureId
    ? screen.requestTranscript
    : recentScreenTranscript(segments, elapsedMs, meeting.meetingStartTime);
  const retained = screen.capture?.id === captureId ? previousConversation : null;
  const anchorWindow = Math.max(60, Math.min(300, useAIActionsStore.getState().configs.globalDefaults.transcriptWindowSeconds));
  const priorAnswer = attached && !previousHint.error
    ? previousHint.detailsReady ? previousHint.details : previousHint.shortAnswer
    : retained?.previousAnswer;
  const conversation: ScreenConversation = {
    taskContext: retained?.taskContext ?? recentScreenTranscript(segments, elapsedMs, meeting.meetingStartTime, anchorWindow),
    question: question ? Array.from(question).slice(0, 2000).join("") : detailed ? retained?.question : undefined,
    previousAnswer: priorAnswer ? Array.from(priorAnswer).slice(0, 4000).join("") : undefined,
  };
  useScreenTaskStore.setState({ conversation, requestTranscript: transcript });
  // Avoid duplicating the initial transcript when no follow-up memory is needed.
  const includeConversation = conversation.question || conversation.previousAnswer || conversation.taskContext !== transcript;
  const mode = action === "review" ? "CodeReview" : "ScreenTask";
  if (!detailed || previousHint.kind !== "screen" || previousHint.captureId !== captureId || previousHint.screenAction !== action) {
    useHintStore.setState({ question: conversation.question ?? (action === "review" ? "Code Review" : "Задача с экрана"), kind: "screen", screenAction: action, captureId, details: "", expanded: detailed, error: null });
  }
  const requestId = crypto.randomUUID();
  useHintStore.setState({ requestId, requestKind: detailed ? "details" : "short", detailsReady: false, error: null, ...(detailed ? { expanded: true } : {}) });
  useStreamStore.getState().setPending(mode, requestId);
  let failed = false;
  try {
    await invoke("generate_screen_task", { captureId, requestId, transcript, ...(includeConversation ? { conversation } : {}), ...(action === "review" ? { action, brief: !detailed } : isInterviewHintMode() ? { brief: !detailed } : {}) });
  } catch (err) {
    failed = true;
    if (useScreenTaskStore.getState().conversation === conversation) {
      useScreenTaskStore.setState({ conversation: previousConversation, requestTranscript: screen.requestTranscript });
    }
    if (useHintStore.getState().requestId === requestId) {
      useHintStore.setState({ ...previousHint, error: err instanceof Error ? err.message : String(err) });
    }
    const stream = useStreamStore.getState();
    // A failure from this request cannot clear a later action's progress.
    if (stream.pendingRequestId === requestId) {
      stream.clearPending(requestId);
      stream.setError(err instanceof Error ? err.message : String(err));
    }
    throw err;
  } finally {
    const hint = useHintStore.getState();
    // Stop invalidates the ID before native cancellation resolves successfully.
    // Restore both the useful text and its identity; never relabel old text as
    // a new review or treat partial detailed comments as a completed answer.
    if (!failed && hint.requestId === null && hint.kind === "screen" && hint.captureId === captureId && hint.screenAction === action) {
      useHintStore.setState({ ...previousHint });
      if (useScreenTaskStore.getState().conversation === conversation) {
        useScreenTaskStore.setState({ conversation: previousConversation, requestTranscript: screen.requestTranscript });
      }
    }
    useStreamStore.getState().clearPending(requestId);
  }
}

/** Route both launcher buttons and global shortcuts to the single AI owner. */
export async function analyzeScreen(action: ScreenAction = "solve"): Promise<void> {
  ensureIdle();
  if (action === "review") {
    await emitTo("overlay", "nexq:screen-task-requested", { action });
  } else {
    await emitTo("overlay", "nexq:screen-task-requested");
  }
}

/** Called only by the overlay, so automatic hints see the capture reservation. */
export async function captureAndAnalyzeScreen(action: ScreenAction = "solve"): Promise<void> {
  ensureIdle();
  const reservation = crypto.randomUUID();
  captureReservation = reservation;
  useStreamStore.getState().setPending(action === "review" ? "CodeReview" : "ScreenTask", reservation);
  try {
    const capture = await invoke<ScreenCapture>("capture_screen_task");
    if (captureReservation !== reservation) {
      return;
    }
    useStreamStore.getState().clearPending(reservation);
    // No await between releasing the reservation and runScreenTask reserving
    // generation: a scheduled hint cannot take the slot between these steps.
    await answerScreenCapture(capture, action);
  } finally {
    if (captureReservation === reservation) {
      captureReservation = null;
    }
    useStreamStore.getState().clearPending(reservation);
  }
}

/** Show and answer a new capture once, for automatic and manual capture paths. */
export async function answerScreenCapture(capture: ScreenCapture, action: ScreenAction = "solve"): Promise<void> {
  if (useScreenTaskStore.getState().capture?.id === capture.id) {
    return;
  }
  const previous = useScreenTaskStore.getState();
  const hint = useHintStore.getState();
  const attached = hint.kind === "screen" && hint.captureId === previous.capture?.id;
  // A fresh image supersedes the old question, while its task conditions survive.
  const conversation = attached ? {
    taskContext: previous.conversation?.taskContext,
    previousAnswer: !hint.error ? hint.detailsReady ? hint.details : hint.shortAnswer : previous.conversation?.previousAnswer,
  } : null;
  useScreenTaskStore.setState({ capture, action, conversation });
  useMeetingStore.getState().setSettingsOpen(false);
  useMeetingStore.getState().setCurrentView("overlay");
  showOverlayWindow({ focus: !isInterviewHintMode() }).catch(() => {});
  await runScreenTask(capture.id, false, action);
}
