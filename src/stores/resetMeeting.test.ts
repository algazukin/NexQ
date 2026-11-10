// The overlay window keeps its own stores between meetings; a new meeting must
// start from nothing there (it used to show every earlier meeting's transcript).

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ get: async () => undefined, set: async () => {}, onKeyChange: async () => () => {} }),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke: async () => null }));

import { initMeetingSpeakers, resetMeetingScopedStores } from "./resetMeeting";
import { useTranscriptStore } from "./transcriptStore";
import { useSpeakerStore } from "./speakerStore";
import { useStreamStore } from "./streamStore";

describe("resetMeetingScopedStores", () => {
  beforeEach(() => {
    useStreamStore.getState().resetForMeeting();
    useTranscriptStore.getState().clearSegments();
    useSpeakerStore.getState().reset();
  });
  it("clears the previous meeting's transcript, speakers and answers", async () => {
    // Arrange
    useTranscriptStore.getState().appendSegment({
      id: "them_1_acc_1",
      text: "Last meeting's line",
      speaker: "Them",
      speaker_id: "them",
      timestamp_ms: 1_000,
      is_final: true,
      confidence: 0.9,
    });
    useSpeakerStore.getState().addSpeaker("speaker_16");
    useStreamStore.setState({ currentContent: "old answer" });

    // Act
    await resetMeetingScopedStores();
    initMeetingSpeakers("online");

    // Assert
    expect(useTranscriptStore.getState().segments).toEqual([]);
    expect(useStreamStore.getState().currentContent).toBe("");
    expect(useStreamStore.getState().responseHistory).toEqual([]);
    expect(useSpeakerStore.getState().speakerOrder).toEqual(["you", "them"]);
  });
});

it("preserves a sending screen request while resetting the new meeting's transcript and speakers", async () => {
  // Arrange
  useStreamStore.getState().resetForMeeting();
  useStreamStore.getState().setPending("ScreenTask", "screen-pending");
  useTranscriptStore.getState().appendSegment({ id: "old", text: "Previous context", speaker: "Them", timestamp_ms: 1, is_final: true, confidence: 1 });
  useSpeakerStore.getState().addSpeaker("old-speaker");
  // Act
  await resetMeetingScopedStores();
  // Assert
  expect(useStreamStore.getState()).toMatchObject({ phase: "sending", currentMode: "ScreenTask", pendingRequestId: "screen-pending" });
  expect(useTranscriptStore.getState().segments).toEqual([]);
  expect(useSpeakerStore.getState().speakerOrder).toEqual([]);
});

it("finishes a screen answer with its original mode and content after a meeting starts", async () => {
  // Arrange
  useStreamStore.getState().resetForMeeting();
  useStreamStore.getState().startStream("ScreenTask", "codex", "Custom HTTP", { requestId: "screen-stream" });
  useStreamStore.getState().appendToken("partial");
  // Act
  await resetMeetingScopedStores();
  useStreamStore.getState().appendToken(" answer");
  useStreamStore.getState().endStream(100);
  // Assert
  expect(useStreamStore.getState().responseHistory[0]).toMatchObject({ mode: "ScreenTask", content: "partial answer", model: "codex" });
});

it("still resets ordinary live answers and completed screen answers for a new meeting", async () => {
  // Arrange
  useStreamStore.getState().resetForMeeting();
  useStreamStore.getState().startStream("Assist", "model", "provider");
  useStreamStore.getState().appendToken("old meeting");
  // Act
  await resetMeetingScopedStores();
  // Assert
  expect(useStreamStore.getState()).toMatchObject({ phase: "idle", isStreaming: false, currentMode: null, currentContent: "", responseHistory: [] });

  // Arrange
  useStreamStore.getState().startStream("ScreenTask", "codex", "Custom HTTP");
  useStreamStore.getState().appendToken("completed screen answer");
  useStreamStore.getState().endStream(100);
  // Act
  await resetMeetingScopedStores();
  // Assert
  expect(useStreamStore.getState()).toMatchObject({ phase: "idle", currentMode: null, currentContent: "", responseHistory: [] });
});

it("preserves an in-flight Code Review while a new meeting resets transcript state", async () => {
  // Arrange
  useStreamStore.getState().resetForMeeting();
  useStreamStore.getState().setPending("CodeReview", "review-pending");
  useTranscriptStore.getState().appendSegment({ id: "old", text: "Background story", speaker: "Them", timestamp_ms: 1, is_final: true, confidence: 1 });
  // Act
  await resetMeetingScopedStores();
  // Assert
  expect(useStreamStore.getState()).toMatchObject({ phase: "sending", currentMode: "CodeReview", pendingRequestId: "review-pending" });
  expect(useTranscriptStore.getState().segments).toEqual([]);
});
