import { beforeEach, describe, expect, it, vi } from "vitest";
const { invoke, emitTo } = vi.hoisted(() => ({ invoke: vi.fn(), emitTo: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emitTo }));
vi.mock("../lib/windows", () => ({ showOverlayWindow: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ get: async () => undefined, set: async () => {}, onKeyChange: async () => () => {} }) }));
import { requestHint, stopHint } from "../hints/actions";
import { EMPTY_HINT, useHintStore } from "../hints/hintStore";
import { analyzeScreen, captureAndAnalyzeScreen, startScreenCapture, recaptureScreenRegion, runScreenTask, answerScreenCapture } from "./screenTask";
import { useStreamStore } from "../stores/streamStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useTranscriptStore } from "../stores/transcriptStore";
import { useConfigStore } from "../stores/configStore";
import { useScreenTaskStore } from "./screenTaskStore";

beforeEach(() => {
  useHintStore.setState({ ...EMPTY_HINT });
  useScreenTaskStore.setState({ capture: null, action: "solve", conversation: null, requestTranscript: undefined });
  useConfigStore.setState({ hintsEnabled: true });
  emitTo.mockClear();
  invoke.mockReset();
  invoke.mockResolvedValue(undefined);
  useStreamStore.getState().resetForMeeting();
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never, aiScenario: "interview", elapsedMs: 0, meetingStartTime: null });
  useTranscriptStore.getState().clearSegments();
});

describe("screen task requests", () => {
  it("sets pending immediately and sends only a capture reference without a meeting", async () => {
    // Arrange
    useMeetingStore.setState({ activeMeeting: null });
    let finish!: () => void;
    invoke.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
    // Act
    const request = runScreenTask("capture-1");
    const state = useStreamStore.getState();
    // Assert
    expect(state.phase).toBe("sending");
    expect(state.currentMode).toBe("ScreenTask");
    expect(invoke).toHaveBeenCalledWith("generate_screen_task", { captureId: "capture-1", requestId: state.pendingRequestId, transcript: undefined });
    finish();
    await request;
  });

  it("refuses capture and repeat while an answer is pending without disturbing it", async () => {
    // Arrange
    useStreamStore.getState().setPending("Assist", "existing");
    // Act
    const results = await Promise.allSettled([startScreenCapture(), recaptureScreenRegion(), runScreenTask("capture-2")]);
    // Assert
    expect(results.every((result) => result.status === "rejected")).toBe(true);
    expect(invoke).not.toHaveBeenCalled();
    expect(useStreamStore.getState().pendingRequestId).toBe("existing");
  });

  it("clears only its own failed pending request and exposes the failure", async () => {
    // Arrange
    invoke.mockRejectedValueOnce(new Error("Configure your screenshot provider"));
    // Act
    const request = runScreenTask("capture-1");
    // Assert
    await expect(request).rejects.toThrow("Configure your screenshot provider");
    expect(useStreamStore.getState().phase).toBe("idle");
    expect(useStreamStore.getState().error).toBe("Configure your screenshot provider");
  });

  it("includes bounded recent finalized meeting context", async () => {
    // Arrange
    useMeetingStore.setState({ activeMeeting: { id: "meeting" } as never, elapsedMs: 120000 });
    useTranscriptStore.getState().appendSegment({ id: "line", text: "Explain the algorithm", speaker: "Them", timestamp_ms: 90000, is_final: true, confidence: 1 });
    // Act
    await runScreenTask("capture-1");
    // Assert
    expect(invoke.mock.calls[0][1].transcript).toBe("Them: Explain the algorithm");
  });
});

it("clears sending when cancellation completes before any stream start event", async () => {
  // Arrange
  let finish!: () => void;
  invoke.mockReturnValueOnce(new Promise<void>((resolve) => { finish = resolve; }));
  // Act
  const request = runScreenTask("capture-cancelled");
  expect(useStreamStore.getState().phase).toBe("sending");
  finish();
  await request;
  // Assert
  expect(useStreamStore.getState().phase).toBe("idle");
  expect(useStreamStore.getState().pendingRequestId).toBeNull();
});


it("restores the previous useful hint after a partially streamed screen request fails", async () => {
  // Arrange
  useHintStore.setState({ ...EMPTY_HINT, question: "Old question", shortAnswer: "Useful answer" });
  invoke.mockImplementation(async () => {
    useHintStore.setState({ shortAnswer: "Partial failed output" });
    throw new Error("Proxy failed");
  });
  // Act
  await expect(runScreenTask("new-capture")).rejects.toThrow("Proxy failed");
  // Assert
  expect(useHintStore.getState().shortAnswer).toBe("Useful answer");
  expect(useHintStore.getState().question).toBe("Old question");
  expect(useHintStore.getState().kind).toBe("speech");
});


it("routes automatic screen capture to its overlay owner", async () => {
  // Arrange
  invoke.mockResolvedValue(undefined);
  // Act
  await analyzeScreen();
  await analyzeScreen();
  // Assert
  expect(emitTo).toHaveBeenCalledTimes(2);
  expect(emitTo).toHaveBeenCalledWith("overlay", "nexq:screen-task-requested");
  expect(invoke).not.toHaveBeenCalled();
});

it("does not capture automatically while an answer is already pending", async () => {
  // Arrange
  useStreamStore.getState().setPending("Hint", "busy");
  // Act
  const request = analyzeScreen();
  // Assert
  await expect(request).rejects.toThrow("Stop the current answer");
  expect(invoke).not.toHaveBeenCalled();
});


it("reserves the idle slot throughout capture and hands it directly to screen generation", async () => {
  // Arrange
  let finishCapture!: (frame: unknown) => void;
  const frame = { id: "automatic", image_url: "private", width: 100, height: 80 };
  invoke.mockImplementation((command) => command === "capture_screen_task"
    ? new Promise((resolve) => { finishCapture = resolve; }) : Promise.resolve());
  // Act
  const request = captureAndAnalyzeScreen();
  const reservation = useStreamStore.getState().pendingRequestId;
  // Assert
  expect(reservation).toBeTruthy();
  expect(useStreamStore.getState().phase).toBe("sending");
  await expect(runScreenTask("competing")).rejects.toThrow("Stop the current answer");
  finishCapture(frame);
  await request;
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["capture_screen_task", "generate_screen_task"]);
  expect(invoke.mock.calls[1][1]).toMatchObject({ captureId: "automatic" });
  expect(invoke.mock.calls[1][1].requestId).not.toBe(reservation);
  expect(useStreamStore.getState().phase).toBe("idle");
});

it("releases capture reservation after a native failure and preserves the useful answer", async () => {
  // Arrange
  useHintStore.setState({ ...EMPTY_HINT, shortAnswer: "Previous useful answer" });
  invoke.mockRejectedValueOnce(new Error("Capture failed"));
  // Act
  const request = captureAndAnalyzeScreen();
  // Assert
  await expect(request).rejects.toThrow("Capture failed");
  expect(useStreamStore.getState().phase).toBe("idle");
  expect(useHintStore.getState().shortAnswer).toBe("Previous useful answer");
});


it("routes a Code Review capture request to the single overlay owner", async () => {
  // Arrange
  useStreamStore.getState().resetForMeeting();
  // Act
  await analyzeScreen("review");
  // Assert
  expect(emitTo).toHaveBeenCalledWith("overlay", "nexq:screen-task-requested", { action: "review" });
  expect(invoke).not.toHaveBeenCalled();
});

it("reserves CodeReview during capture and sends a short review rather than solving", async () => {
  // Arrange
  useConfigStore.setState({ hintsEnabled: false });
  const capture = { id: "review-capture", image_url: "private", width: 100, height: 100 };
  invoke.mockImplementation((command) => Promise.resolve(command === "capture_screen_task" ? capture : undefined));
  // Act
  const request = captureAndAnalyzeScreen("review");
  const pending = useStreamStore.getState().currentMode;
  await request;
  // Assert
  expect(pending).toBe("CodeReview");
  expect(invoke.mock.calls.map(([command]) => command)).toEqual(["capture_screen_task", "generate_screen_task"]);
  expect(invoke.mock.calls[1][1]).toMatchObject({ captureId: "review-capture", action: "review", brief: true });
  expect(useHintStore.getState()).toMatchObject({ kind: "screen", captureId: "review-capture", screenAction: "review" });
  expect(useScreenTaskStore.getState()).toMatchObject({ capture, action: "review" });
});

it("expands review on the same capture in full mode without recapturing or solving", async () => {
  // Arrange
  useConfigStore.setState({ hintsEnabled: false });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "review", captureId: "same-code", shortAnswer: "line // bug" });
  // Act
  await runScreenTask("same-code", true, "review");
  // Assert
  expect(invoke).toHaveBeenCalledTimes(1);
  expect(invoke.mock.calls[0]).toEqual(["generate_screen_task", expect.objectContaining({ captureId: "same-code", action: "review", brief: false })]);
  expect(useHintStore.getState().screenAction).toBe("review");
});


it("restores the preceding hint identity when a review is stopped before its first token", async () => {
  // Arrange
  useHintStore.setState({ ...EMPTY_HINT, question: "Old question", shortAnswer: "Useful old answer" });
  let finish!: () => void;
  invoke.mockImplementation((command) => command === "generate_screen_task"
    ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
  // Act
  const request = runScreenTask("cancelled-review", false, "review");
  await stopHint();
  finish();
  await request;
  // Assert
  expect(useHintStore.getState()).toMatchObject({ question: "Old question", shortAnswer: "Useful old answer", kind: "speech", captureId: null, screenAction: "solve" });
});

it("does not send a capture to the model after Stop was pressed during capture", async () => {
  // Arrange
  let finishCapture!: (frame: unknown) => void;
  useHintStore.setState({ ...EMPTY_HINT, shortAnswer: "Useful previous answer" });
  invoke.mockImplementation((command) => command === "capture_screen_task"
    ? new Promise((resolve) => { finishCapture = resolve; }) : Promise.resolve());
  // Act
  const request = captureAndAnalyzeScreen("review");
  await stopHint();
  finishCapture({ id: "cancelled-frame", image_url: "private", width: 100, height: 100 });
  await request;
  // Assert
  expect(invoke.mock.calls.some(([command]) => command === "generate_screen_task")).toBe(false);
  expect(useStreamStore.getState().phase).toBe("idle");
  expect(useHintStore.getState()).toMatchObject({ kind: "speech", captureId: null, shortAnswer: "Useful previous answer" });
});


it("a cancelled capture finishing late cannot release the next review reservation", async () => {
  // Arrange
  const finishes: Array<(frame: unknown) => void> = [];
  invoke.mockImplementation((command) => command === "capture_screen_task"
    ? new Promise((resolve) => { finishes.push(resolve); }) : Promise.resolve());
  // Act
  const first = captureAndAnalyzeScreen("review");
  await stopHint();
  const second = captureAndAnalyzeScreen("review");
  const secondReservation = useStreamStore.getState().pendingRequestId;
  finishes[0]({ id: "old", image_url: "private", width: 100, height: 100 });
  await first;
  // Assert
  expect(useStreamStore.getState().pendingRequestId).toBe(secondReservation);
  expect(invoke.mock.calls.some(([command]) => command === "generate_screen_task")).toBe(false);
  finishes[1]({ id: "new", image_url: "private", width: 100, height: 100 });
  await second;
  expect(invoke.mock.calls.filter(([command]) => command === "generate_screen_task")).toEqual([
    ["generate_screen_task", expect.objectContaining({ captureId: "new", action: "review" })],
  ]);
});


it("retains the failure message when a cached review without a request ID is retried", async () => {
  // Arrange
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "review", captureId: "code", shortAnswer: "Useful review", requestId: null });
  invoke.mockRejectedValueOnce(new Error("Review provider failed"));
  // Act
  const request = runScreenTask("code", true, "review");
  // Assert
  await expect(request).rejects.toThrow("Review provider failed");
  expect(useHintStore.getState()).toMatchObject({ error: "Review provider failed", shortAnswer: "Useful review", screenAction: "review" });
});


it("sends the current follow-up, anchored task conditions and preceding answer with the existing image", async () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never, elapsedMs: 180000 });
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, action: "solve", conversation: { taskContext: "Original task requires O(n) time." } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "task", screenAction: "solve", shortAnswer: "Use HashSet<string>." });
  useTranscriptStore.getState().appendSegment({ id: "q", text: "А если без учёта регистра?", speaker: "Them", timestamp_ms: 175000, is_final: true, confidence: 1 });
  // Act
  await runScreenTask("task", false, "solve", "А если без учёта регистра?");
  // Assert
  expect(invoke).toHaveBeenCalledWith("generate_screen_task", expect.objectContaining({ captureId: "task", conversation: { taskContext: "Original task requires O(n) time.", question: "А если без учёта регистра?", previousAnswer: "Use HashSet<string>." } }));
  expect(invoke.mock.calls.some(([command]) => command === "capture_screen_task")).toBe(false);
});

it("refreshes the image without losing the original task conditions or forcing an old question", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "old", image_url: "private", width: 100, height: 100 }, action: "solve", conversation: { taskContext: "Original task requires O(n).", question: "Old follow-up" } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "old", screenAction: "solve", shortAnswer: "Previous suggested approach" });
  // Act
  await answerScreenCapture({ id: "new", image_url: "private", width: 100, height: 100 });
  // Assert
  expect(invoke).toHaveBeenCalledWith("generate_screen_task", expect.objectContaining({ captureId: "new", conversation: expect.objectContaining({ taskContext: "Original task requires O(n).", previousAnswer: "Previous suggested approach" }) }));
  expect(invoke.mock.calls[0][1].conversation.question).toBeUndefined();
});

it("keeps the spoken follow-up as the target when More requests details", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, conversation: { taskContext: "String duplicate task", question: "А если без учёта регистра?" } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "task", question: "А если без учёта регистра?", screenAction: "solve", shortAnswer: "Use OrdinalIgnoreCase." });
  // Act
  await runScreenTask("task", true, "solve");
  // Assert
  expect(invoke).toHaveBeenCalledWith("generate_screen_task", expect.objectContaining({ captureId: "task", brief: false, conversation: expect.objectContaining({ question: "А если без учёта регистра?" }) }));
});

it("anchors earlier spoken conditions even when they are outside the latest minute", async () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never, elapsedMs: 180000 });
  useTranscriptStore.getState().appendSegment({ id: "conditions", text: "The original condition is O(n) with no sorting.", speaker: "Them", timestamp_ms: 10000, is_final: true, confidence: 1 });
  useTranscriptStore.getState().appendSegment({ id: "latest", text: "Can comparison ignore case?", speaker: "Them", timestamp_ms: 175000, is_final: true, confidence: 1 });
  // Act
  await runScreenTask("first-capture");
  // Assert
  expect(invoke.mock.calls[0][1].transcript).not.toContain("no sorting");
  expect(invoke.mock.calls[0][1].conversation.taskContext).toContain("no sorting");
  expect(useScreenTaskStore.getState().conversation?.taskContext).toContain("no sorting");
});

it("restores task memory when a spoken follow-up fails", async () => {
  // Arrange
  const conversation = { taskContext: "Original conditions", question: "Previous question" };
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, conversation });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "task", shortAnswer: "Useful answer" });
  invoke.mockRejectedValueOnce(new Error("Provider failed"));
  // Act
  const request = runScreenTask("task", false, "solve", "New question?");
  // Assert
  await expect(request).rejects.toThrow("Provider failed");
  expect(useScreenTaskStore.getState().conversation).toBe(conversation);
  expect(useHintStore.getState().shortAnswer).toBe("Useful answer");
});

it("restores task memory when a spoken follow-up is stopped", async () => {
  // Arrange
  const conversation = { taskContext: "Original conditions", question: "Previous question" };
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, conversation });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "task", shortAnswer: "Useful answer" });
  let finish!: () => void;
  invoke.mockImplementation((command) => command === "generate_screen_task"
    ? new Promise<void>((resolve) => { finish = resolve; }) : Promise.resolve());
  // Act
  const request = runScreenTask("task", false, "solve", "New question?");
  await stopHint();
  finish();
  await request;
  // Assert
  expect(useScreenTaskStore.getState().conversation).toBe(conversation);
  expect(useHintStore.getState().shortAnswer).toBe("Useful answer");
});

it("a late failed request cannot roll back newer task memory", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, conversation: { taskContext: "Old task" } });
  let fail!: (reason: Error) => void;
  invoke.mockImplementation(() => new Promise<void>((_, reject) => { fail = reject; }));
  // Act
  const request = runScreenTask("task", false, "solve", "Old follow-up?");
  const newer = { taskContext: "New task" };
  useScreenTaskStore.setState({ conversation: newer });
  useHintStore.setState({ requestId: "new-request" });
  fail(new Error("Old failure"));
  // Assert
  await expect(request).rejects.toThrow("Old failure");
  expect(useScreenTaskStore.getState().conversation).toBe(newer);
  expect(useHintStore.getState().requestId).toBe("new-request");
});

it("More expands the displayed screen answer rather than a question spoken afterwards", async () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never, elapsedMs: 10000 });
  useTranscriptStore.getState().appendSegment({ id: "first", text: "How to find duplicates?", speaker: "Them", timestamp_ms: 9000, is_final: true, confidence: 1 });
  await answerScreenCapture({ id: "task", image_url: "private", width: 100, height: 100 });
  useHintStore.setState({ shortAnswer: "Use HashSet." });
  useMeetingStore.setState({ elapsedMs: 15000 });
  useTranscriptStore.getState().appendSegment({ id: "later", text: "What if values arrive concurrently?", speaker: "Them", timestamp_ms: 14000, is_final: true, confidence: 1 });
  // Act
  await runScreenTask("task", true, "solve");
  // Assert
  const details = invoke.mock.calls[1][1];
  expect(details.transcript).toContain("How to find duplicates?");
  expect(details.transcript).not.toContain("arrive concurrently");
});

it.each(["failure", "stop"])("requires a fresh Screen binding after a refreshed image request ends with %s", async (outcome) => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "old", image_url: "private", width: 100, height: 100 }, conversation: { taskContext: "Original task" } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "old", shortAnswer: "Useful old answer" });
  let finish!: () => void;
  invoke.mockImplementation((command) => command === "generate_screen_task"
    ? outcome === "failure" ? Promise.reject(new Error("Provider failed")) : new Promise<void>((resolve) => { finish = resolve; })
    : Promise.resolve());
  const refresh = answerScreenCapture({ id: "new", image_url: "private", width: 100, height: 100 });
  if (outcome === "failure") {
    await expect(refresh).rejects.toThrow("Provider failed");
  } else {
    await stopHint();
    finish();
    await refresh;
  }
  invoke.mockClear();
  // Act
  await requestHint(false, "What if comparison ignores case?");
  // Assert
  expect(invoke).not.toHaveBeenCalled();
  expect(useHintStore.getState().shortAnswer).toBe("Useful old answer");
  expect(useHintStore.getState().error).toContain("Экран");
});
