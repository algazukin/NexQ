import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn(), invoke: vi.fn() }));
vi.mock("./actions", () => ({ requestHint: mocks.request }));
vi.mock("@tauri-apps/api/event", () => ({ listen: async () => () => {}, emitTo: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("../lib/windows", () => ({ showOverlayWindow: vi.fn(async () => {}) }));
import { useHintAssistant } from "./useHintAssistant";
import { captureAndAnalyzeScreen } from "../screen/screenTask";
import { useScreenTaskStore } from "../screen/screenTaskStore";
import { EMPTY_HINT, useHintStore } from "./hintStore";
import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useStreamStore } from "../stores/streamStore";
import { useTranscriptStore } from "../stores/transcriptStore";

beforeEach(() => {
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never, aiScenario: "interview" });
  vi.useFakeTimers();
  mocks.request.mockReset().mockResolvedValue(undefined);
  mocks.invoke.mockReset().mockResolvedValue(undefined);
  useScreenTaskStore.setState({ capture: null, conversation: null, requestTranscript: undefined });
  useHintStore.setState({ ...EMPTY_HINT });
  useConfigStore.setState({ hintsEnabled: true });
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never });
  useStreamStore.getState().resetForMeeting();
  useTranscriptStore.getState().clearSegments();
});
afterEach(() => vi.useRealTimers());

it("schedules exactly once with both native window roots mounted", async () => {
  // Arrange
  renderHook(() => useHintAssistant("launcher"));
  renderHook(() => useHintAssistant("overlay"));
  // Act
  act(() => useTranscriptStore.getState().appendSegment({ id: "q", text: "Что такое Task?", speaker: "Them", is_final: true, timestamp_ms: 0, confidence: 1 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  // Assert
  expect(mocks.request).toHaveBeenCalledTimes(1);
});

it("marks details complete on stream end and exposes terminal errors", () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  useHintStore.setState({ requestId: "details", requestKind: "details" });
  // Act
  act(() => {
    const stream = useStreamStore.getState();
    stream.startStream("HintDetails", "model", "custom", { requestId: "details" });
    stream.appendToken("Подробный ответ");
    stream.endStream(100);
  });
  // Assert
  expect(useHintStore.getState().detailsReady).toBe(true);
  expect(useHintStore.getState().details).toBe("Подробный ответ");
  act(() => {
    useStreamStore.getState().startStream("HintDetails", "model", "custom", { requestId: "details" });
    useStreamStore.getState().setError("Proxy failed");
  });
  expect(useHintStore.getState().error).toBe("Proxy failed");
});

it("keeps full screen tokens separate after details are collapsed", () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  useHintStore.setState({ requestId: "screen", requestKind: "details", kind: "screen", shortAnswer: "HashSet", expanded: true });
  // Act
  act(() => {
    useStreamStore.getState().startStream("ScreenTask", "model", "custom", { requestId: "screen" });
    useStreamStore.getState().appendToken("public ");
    useHintStore.setState({ expanded: false });
    useStreamStore.getState().appendToken("class Solution {}");
  });
  // Assert
  expect(useHintStore.getState().shortAnswer).toBe("HashSet");
  expect(useHintStore.getState().details).toContain("class Solution");
});

it("ignores late tokens after hint state is cleared", () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  useHintStore.setState({ requestId: "old" });
  // Act
  act(() => {
    useStreamStore.getState().startStream("Hint", "model", "custom", { requestId: "old" });
    useHintStore.setState({ ...EMPTY_HINT });
    useStreamStore.getState().appendToken("Old answer");
  });
  // Assert
  expect(useHintStore.getState().shortAnswer).toBe("");
});

it("preserves screen metadata when a meeting starts during its stream", () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: null });
  useStreamStore.getState().setPending("ScreenTask", "screen");
  useHintStore.setState({ kind: "screen", captureId: "capture", requestId: "screen" });
  renderHook(() => useHintAssistant("overlay"));
  // Act
  act(() => useMeetingStore.setState({ activeMeeting: { id: "new" } as never }));
  // Assert
  expect(useHintStore.getState().kind).toBe("screen");
  expect(useHintStore.getState().captureId).toBe("capture");
});


it("does not repeat a question that was answered manually before the automatic timer", async () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  // Act
  act(() => {
    useTranscriptStore.getState().appendSegment({ id: "q", text: "What is Task?", speaker: "Them", is_final: true, timestamp_ms: 0, confidence: 1 });
    useHintStore.setState({ question: "What is Task?", requestId: "manual" });
    useStreamStore.getState().setPending("Hint", "manual");
    useStreamStore.getState().startStream("Hint", "model", "custom", { requestId: "manual" });
    useStreamStore.getState().appendToken("An asynchronous operation.");
    useStreamStore.getState().endStream(100);
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
  // Assert
  expect(mocks.request).not.toHaveBeenCalled();
});


it("does not start an automatic hint when a question arrives while the display is being captured", async () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  let finishCapture!: (frame: unknown) => void;
  mocks.invoke.mockImplementation((command) => command === "capture_screen_task"
    ? new Promise((resolve) => { finishCapture = resolve; }) : Promise.resolve());
  let request!: Promise<void>;
  // Act
  act(() => {
    request = captureAndAnalyzeScreen();
    useTranscriptStore.getState().appendSegment({ id: "during-capture", text: "Что такое Task?", speaker: "Them", is_final: true, timestamp_ms: 0, confidence: 1 });
  });
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  // Assert
  expect(mocks.request).not.toHaveBeenCalled();
  await act(async () => {
    finishCapture({ id: "captured", image_url: "private", width: 100, height: 100 });
    await request;
  });
  expect(mocks.invoke.mock.calls.map(([command]) => command)).toEqual(["capture_screen_task", "generate_screen_task"]);
});


it("streams Code Review comments and details into their separate fields", () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "review", captureId: "code", requestId: "review-short", requestKind: "short" });
  // Act
  act(() => {
    useStreamStore.getState().startStream("CodeReview", "model", "custom", { requestId: "review-short" });
    useStreamStore.getState().appendToken("values[i] // bounds bug");
    useStreamStore.getState().endStream(100);
    useHintStore.setState({ requestId: "review-details", requestKind: "details", expanded: true });
    useStreamStore.getState().startStream("CodeReview", "model", "custom", { requestId: "review-details" });
    useStreamStore.getState().appendToken("values[i] // throws when i equals Length; use i < Length");
    useStreamStore.getState().endStream(100);
  });
  // Assert
  expect(useHintStore.getState()).toMatchObject({ shortAnswer: "values[i] // bounds bug", details: "values[i] // throws when i equals Length; use i < Length", detailsReady: true });
});

it("does not reset review capture metadata when meeting audio starts", () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: null });
  useStreamStore.getState().setPending("CodeReview", "review");
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "review", captureId: "code", requestId: "review" });
  const hook = renderHook(() => useHintAssistant("overlay"));
  // Act
  act(() => useMeetingStore.setState({ activeMeeting: { id: "new-meeting" } as never }));
  hook.rerender();
  // Assert
  expect(useHintStore.getState()).toMatchObject({ kind: "screen", screenAction: "review", captureId: "code", requestId: "review" });
});


it("does not mark stopped review details complete when the end event arrives", () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "review", captureId: "code", requestId: "stopped-details", requestKind: "details", shortAnswer: "line // short review", expanded: true });
  // Act
  act(() => {
    useStreamStore.getState().startStream("CodeReview", "model", "provider", { requestId: "stopped-details" });
    useStreamStore.getState().appendToken("partial details");
    useHintStore.setState({ requestId: null, detailsReady: false, details: "" });
    useStreamStore.getState().endStream(100);
  });
  // Assert
  expect(useHintStore.getState()).toMatchObject({ detailsReady: false, details: "", shortAnswer: "line // short review" });
});


it("schedules compact spoken follow-ups while a solve screenshot is attached", async () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "solve", captureId: "task", shortAnswer: "Use HashSet." });
  // Act
  act(() => useTranscriptStore.getState().appendSegment({ id: "next", text: "А если без учёта регистра?", speaker: "Them", is_final: true, timestamp_ms: 0, confidence: 1 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(750); });
  // Assert
  expect(mocks.request).toHaveBeenCalledWith(false, "А если без учёта регистра?");
});

it("keeps detailed screen code visible until the user asks for the follow-up manually", async () => {
  // Arrange
  renderHook(() => useHintAssistant("overlay"));
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "solve", captureId: "task", expanded: true, details: "Full C# code" });
  // Act
  act(() => useTranscriptStore.getState().appendSegment({ id: "next", text: "А если без учёта регистра?", speaker: "Them", is_final: true, timestamp_ms: 0, confidence: 1 }));
  await act(async () => { await vi.advanceTimersByTimeAsync(10000); });
  // Assert
  expect(mocks.request).not.toHaveBeenCalled();
  expect(useHintStore.getState().details).toBe("Full C# code");
});

it("clears the previous task memory when a different meeting starts", () => {
  // Arrange
  const hook = renderHook(() => useHintAssistant("overlay"));
  useScreenTaskStore.setState({ capture: { id: "old-task", image_url: "private", width: 100, height: 100 }, conversation: { taskContext: "Old meeting conditions" } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "old-task" });
  // Act
  act(() => useMeetingStore.setState({ activeMeeting: { id: "different-meeting" } as never }));
  hook.rerender();
  // Assert
  expect(useScreenTaskStore.getState().conversation).toBeNull();
  expect(useHintStore.getState()).toMatchObject({ kind: "speech", captureId: null });
});
