import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { TranscriptSegment } from "../lib/types";
import { useTranscriptStore } from "../stores/transcriptStore";
import { useTranslationStore } from "../stores/translationStore";
import { TranscriptPanel } from "./TranscriptPanel";

vi.mock("../hooks/useAudioLevel", () => ({
  useAudioLevel: () => ({ micLevel: 0, systemLevel: 0 }),
}));

function segment(id: string, timestamp_ms: number, text: string, speaker: "User" | "Them" = "Them"): TranscriptSegment {
  return { id, timestamp_ms, text, speaker, is_final: true, confidence: 1 };
}

afterEach(() => {
  cleanup();
  useTranscriptStore.getState().clearSegments();
  useTranslationStore.getState().clearTranslations();
});

it("shows a late-arriving final at its spoken timestamp", () => {
  // Arrange
  useTranscriptStore.setState({
    segments: [
      segment("later", 179_000, "Later question", "User"),
      segment("earlier", 153_000, "Earlier answer"),
    ],
  });

  // Act
  render(<TranscriptPanel />);

  // Assert
  const earlier = screen.getByText("Earlier answer");
  const later = screen.getByText("Later question");
  expect(earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
});

it("keeps every translated part of a merged line visible while it grows", () => {
  // Arrange
  const first = segment("first", 1_000, "The lock protects shared state.");
  const second = segment("second", 2_000, "Keep it short.");
  useTranscriptStore.setState({ segments: [first, second] });
  useTranslationStore.setState({ displayMode: "inline", targetLang: "ru" });
  for (const [part, text] of [[first, "Блокировка защищает общее состояние."], [second, "Не удерживайте её долго."]] as const) {
    useTranslationStore.getState().addTranslation({
      segment_id: part.id, original_text: part.text, translated_text: text,
      source_lang: "en", target_lang: "ru", provider: "OPUS-MT",
    });
  }
  render(<TranscriptPanel />);

  // Act
  act(() => {
    useTranslationStore.getState().setTranslating(first.id, true);
  });

  // Assert
  expect(screen.getByText("The lock protects shared state. Keep it short.")).toBeInTheDocument();
  expect(screen.getByText("Блокировка защищает общее состояние. Не удерживайте её долго.")).toBeInTheDocument();
});
