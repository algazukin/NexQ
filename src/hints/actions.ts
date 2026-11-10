import { cancelGeneration, generateAssist } from "../lib/ipc";
import { cancelPendingScreenCapture, runScreenTask } from "../screen/screenTask";
import { useStreamStore } from "../stores/streamStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { useScreenTaskStore } from "../screen/screenTaskStore";
import { useHintStore } from "./hintStore";
import { isInterviewHintMode } from "./hintMode";
import { looksLikeHintQuestion } from "./scheduler";

export async function requestHint(details = false, question?: string): Promise<void> {
  if (!isInterviewHintMode()) {
    return;
  }
  const stream = useStreamStore.getState();
  if (stream.isStreaming || stream.phase !== "idle") {
    return;
  }
  const previous = { ...useHintStore.getState() };
  if (details) {
    useHintStore.setState({ expanded: true, error: null });
    if (previous.detailsReady && !previous.error) {
      return;
    }
  }
  const attached = previous.kind === "screen" && previous.captureId === useScreenTaskStore.getState().capture?.id;
  if (previous.kind === "screen" && !attached) {
    useHintStore.setState({ error: "Снимок изменился после ошибки или отмены. Нажми «Экран», чтобы обновить задачу." });
    return;
  }
  if (details && previous.captureId) {
    try {
      await runScreenTask(previous.captureId, true, previous.screenAction);
    } catch (error) {
      if (useHintStore.getState().captureId === previous.captureId && useHintStore.getState().kind === "screen") {
        useHintStore.setState({ ...previous, expanded: true, error: error instanceof Error ? error.message : String(error) });
      }
      throw error;
    }
    return;
  }
  const remote = useTranscriptStore.getState().segments.filter((segment) =>
    segment.is_final && (segment.speaker === "Them" || segment.speaker === "Interviewer"));
  const latestQuestion = [...remote].reverse().find((segment) => looksLikeHintQuestion(segment.text));
  const selected = details ? previous.question : question ?? latestQuestion?.text ?? (attached ? undefined : remote[remote.length - 1]?.text);
  if (!selected) {
    useHintStore.setState({ error: "Пока нет распознанного вопроса собеседника." });
    return;
  }
  if (!details && attached && previous.captureId) {
    await runScreenTask(previous.captureId, false, "solve", selected);
    return;
  }
  const requestId = crypto.randomUUID();
  const mode = details ? "HintDetails" : "Hint";
  if (!details) {
    useHintStore.setState({ question: selected, kind: "speech", captureId: null, details: "", expanded: false, error: null });
  }
  const input = details
    ? `Original question:\n${selected}\n\nDisplayed hint:\n${previous.shortAnswer}`
    : selected;
  useHintStore.setState({ requestId, requestKind: details ? "details" : "short", ...(details ? { details: "", detailsReady: false } : { detailsReady: false }) });
  stream.setPending(mode, requestId);
  try {
    await generateAssist(mode, input, { requestId });
  } catch (error) {
    if (useHintStore.getState().requestId === requestId) {
      useHintStore.setState({ ...previous, error: error instanceof Error ? error.message : String(error) });
    }
    throw error;
  } finally {
    useStreamStore.getState().clearPending(requestId);
  }
}


export async function stopHint(): Promise<void> {
  cancelPendingScreenCapture();
  // Invalidate late tokens before asking the provider to stop.
  useHintStore.setState({ requestId: null, detailsReady: false, details: "" });
  await cancelGeneration();
}
