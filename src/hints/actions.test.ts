import { useMeetingStore } from "../stores/meetingStore";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ generate: vi.fn(), screen: vi.fn() }));
vi.mock("../lib/ipc", async (original) => ({ ...(await original<typeof import("../lib/ipc")>()), generateAssist: mocks.generate }));
vi.mock("../screen/screenTask", () => ({ runScreenTask: mocks.screen }));
import { requestHint } from "./actions";
import { useScreenTaskStore } from "../screen/screenTaskStore";
import { EMPTY_HINT, useHintStore } from "./hintStore";
import { useStreamStore } from "../stores/streamStore";
import { useTranscriptStore } from "../stores/transcriptStore";

beforeEach(() => {
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never, aiScenario: "interview" });
  useScreenTaskStore.setState({ capture: null, action: "solve", conversation: null, requestTranscript: undefined });
  vi.clearAllMocks();
  mocks.generate.mockResolvedValue(undefined);
  mocks.screen.mockResolvedValue(undefined);
  useHintStore.setState({ ...EMPTY_HINT });
  useStreamStore.getState().resetForMeeting();
  useTranscriptStore.getState().clearSegments();
});

describe("hint actions", () => {
  it("uses the remote question and a dedicated short action", async () => {
    // Arrange
    useTranscriptStore.getState().appendSegment({ id: "q", speaker: "Them", text: "Что такое Task?", is_final: true, timestamp_ms: 0, confidence: 1 });
    // Act
    await requestHint();
    // Assert
    expect(mocks.generate).toHaveBeenCalledWith("Hint", "Что такое Task?", expect.objectContaining({ requestId: expect.any(String) }));
  });

  it("expands the displayed question instead of the newest transcript", async () => {
    // Arrange
    useHintStore.setState({ question: "Что такое Task?", shortAnswer: "Представляет асинхронную операцию." });
    // Act
    await requestHint(true);
    // Assert
    expect(mocks.generate.mock.calls[0][0]).toBe("HintDetails");
    expect(mocks.generate.mock.calls[0][1]).toContain("Что такое Task?");
    expect(mocks.generate.mock.calls[0][1]).toContain("Представляет асинхронную операцию.");
    expect(useHintStore.getState().expanded).toBe(true);
  });

  it("requests full code against the same screen capture", async () => {
    // Arrange
    useScreenTaskStore.setState({ capture: { id: "capture-1", image_url: "private", width: 100, height: 100 } });
    useHintStore.setState({ kind: "screen", captureId: "capture-1", shortAnswer: "Использовать HashSet." });
    // Act
    await requestHint(true);
    // Assert
    expect(mocks.screen).toHaveBeenCalledWith("capture-1", true, "solve");
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("reopens cached details without a second request", async () => {
    // Arrange
    useHintStore.setState({ question: "Task?", shortAnswer: "Кратко", details: "Подробный ответ", detailsReady: true });
    // Act
    await requestHint(true);
    // Assert
    expect(useHintStore.getState().expanded).toBe(true);
    expect(mocks.generate).not.toHaveBeenCalled();
  });

  it("preserves the previous answer when a new request fails", async () => {
    // Arrange
    useHintStore.setState({ question: "Старый вопрос", shortAnswer: "Полезный ответ" });
    mocks.generate.mockRejectedValue(new Error("Proxy unavailable"));
    // Act
    await expect(requestHint(false, "Новый вопрос?")).rejects.toThrow("Proxy unavailable");
    // Assert
    expect(useHintStore.getState().shortAnswer).toBe("Полезный ответ");
    expect(useHintStore.getState().question).toBe("Старый вопрос");
    expect(useHintStore.getState().error).toBe("Proxy unavailable");
  });

  it("does not overlap a pending generation", async () => {
    // Arrange
    useStreamStore.getState().setPending("Assist", "already-pending");
    // Act
    await requestHint(false, "Что такое Task?");
    // Assert
    expect(mocks.generate).not.toHaveBeenCalled();
    expect(useStreamStore.getState().pendingRequestId).toBe("already-pending");
  });
});


it("More retains the review action and screenshot reference", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "code", image_url: "private", width: 100, height: 100 } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", screenAction: "review", captureId: "code", shortAnswer: "values[i] // bounds bug" });
  // Act
  await requestHint(true);
  // Assert
  expect(mocks.screen).toHaveBeenCalledWith("code", true, "review");
  expect(mocks.generate).not.toHaveBeenCalled();
});


it("answers a new spoken follow-up using the current screenshot instead of text-only Hint", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, action: "solve", conversation: { taskContext: "Case-sensitive duplicates, O(n)" } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "task", screenAction: "solve", shortAnswer: "Use a HashSet<string>." });
  useTranscriptStore.getState().appendSegment({ id: "old", speaker: "Them", text: "Как найти дубликаты?", is_final: true, timestamp_ms: 0, confidence: 1 });
  useTranscriptStore.getState().appendSegment({ id: "followup", speaker: "Them", text: "А если без учёта регистра", is_final: true, timestamp_ms: 1000, confidence: 1 });
  // Act
  await requestHint();
  // Assert
  expect(mocks.screen).toHaveBeenCalledWith("task", false, "solve", "А если без учёта регистра");
  expect(mocks.generate).not.toHaveBeenCalled();
});

it("does not attach a stale screenshot after the user returned to ordinary questions", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "old-task", image_url: "private", width: 100, height: 100 }, conversation: { taskContext: "Old task" } });
  useHintStore.setState({ ...EMPTY_HINT });
  // Act
  await requestHint(false, "Что такое ValueTask?");
  // Assert
  expect(mocks.screen).not.toHaveBeenCalled();
  expect(mocks.generate).toHaveBeenCalledWith("Hint", "Что такое ValueTask?", expect.anything());
});

it("uses the latest question rather than trailing non-question chatter for a screen hint", async () => {
  // Arrange
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, conversation: { taskContext: "Duplicate strings" } });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "task" });
  useTranscriptStore.getState().appendSegment({ id: "question", text: "А если без учёта регистра?", speaker: "Them", timestamp_ms: 1000, is_final: true, confidence: 1 });
  useTranscriptStore.getState().appendSegment({ id: "chatter", text: "Хорошо, подумайте пока", speaker: "Them", timestamp_ms: 2000, is_final: true, confidence: 1 });
  // Act
  await requestHint();
  // Assert
  expect(mocks.screen).toHaveBeenCalledWith("task", false, "solve", "А если без учёта регистра?");
  expect(mocks.generate).not.toHaveBeenCalled();
});
