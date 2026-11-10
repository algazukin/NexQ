import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { TranscriptUpdateEvent, TranslationResult } from "../lib/types";
import { translateSegments } from "../lib/ipc";
import { useMeetingStore } from "../stores/meetingStore";
import { useTranslationStore } from "../stores/translationStore";
import { useTranslation } from "./useTranslation";

const finalListeners = vi.hoisted(() => new Set<(event: TranscriptUpdateEvent) => void>());
vi.mock("../lib/events", () => ({
  onTranscriptFinal: async (listener: (event: TranscriptUpdateEvent) => void) => {
    finalListeners.add(listener);
    return () => { finalListeners.delete(listener); };
  },
  onTranslationResult: async () => () => {},
  onTranslationError: async () => () => {},
  onBatchTranslationProgress: async () => () => {},
}));
vi.mock("../lib/ipc", () => ({
  translateSegments: vi.fn(async () => {}),
  getMeetingTranslations: vi.fn(async () => []),
}));

function publish(text: string, id = "them_1") {
  const event: TranscriptUpdateEvent = {
    segment: { id, text, speaker: "Them", timestamp_ms: 0, is_final: true, confidence: 1 },
  };
  for (const listener of finalListeners) {
    listener(event);
  }
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(translateSegments).mockReset();
  useMeetingStore.setState({ activeMeeting: { id: "meeting" } as never });
  useTranslationStore.getState().clearTranslations();
  useTranslationStore.setState({ autoTranslateActive: true, sourceLang: "en", targetLang: "ru" });
});

afterEach(() => {
  vi.useRealTimers();
  useMeetingStore.setState({ activeMeeting: null });
  useTranslationStore.getState().clearTranslations();
  useTranslationStore.setState({ autoTranslateActive: false });
});

it("dispatches live requests from the overlay only", async () => {
  // Arrange
  const launcher = renderHook(() => useTranslation(false));
  const overlay = renderHook(() => useTranslation(true));

  // Act
  await act(async () => {
    publish("How does a lock work?");
    await vi.advanceTimersByTimeAsync(250);
  });

  // Assert
  expect(translateSegments).toHaveBeenCalledTimes(1);
  launcher.unmount();
  overlay.unmount();
});

it("skips an already translated final while continuing to translate other lines", async () => {
  // Arrange
  const translated: TranslationResult = {
    segment_id: "them_1", original_text: "A lock protects shared state.",
    translated_text: "Блокировка защищает общее состояние.", source_lang: "en",
    target_lang: "ru", provider: "Microsoft Translator",
  };
  useTranslationStore.getState().addTranslation(translated);
  const overlay = renderHook(() => useTranslation(true));

  // Act
  await act(async () => {
    publish(translated.original_text);
    publish("What about async code?", "them_2");
    await vi.advanceTimersByTimeAsync(250);
  });

  // Assert
  expect(translateSegments).toHaveBeenCalledTimes(1);
  expect(translateSegments).toHaveBeenCalledWith(
    ["them_2"], ["What about async code?"], "meeting", "ru", "en", true,
  );
  overlay.unmount();
});

it("coalesces a growing paragraph until its current translation completes", async () => {
  // Arrange
  let finish!: () => void;
  vi.mocked(translateSegments).mockImplementationOnce(() =>
    new Promise<void>((resolve) => { finish = resolve; }),
  );
  const overlay = renderHook(() => useTranslation(true));

  // Act
  await act(async () => {
    publish("A lock protects shared state.");
    await vi.advanceTimersByTimeAsync(250);
    publish("A lock protects shared state. Keep it short.");
    await vi.advanceTimersByTimeAsync(250);
    publish("A lock protects shared state. Keep it short. Avoid blocking I/O.");
    await vi.advanceTimersByTimeAsync(250);
  });

  // Assert
  expect(translateSegments).toHaveBeenCalledTimes(1);
  await act(async () => { finish(); });
  expect(translateSegments).toHaveBeenCalledTimes(2);
  expect(translateSegments).toHaveBeenLastCalledWith(
    ["them_1"], ["A lock protects shared state. Keep it short. Avoid blocking I/O."],
    "meeting", "ru", "en", true,
  );
  overlay.unmount();
});
