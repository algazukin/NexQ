import { describe, expect, it } from "vitest";
import { selectionRegion, recentScreenTranscript } from "./capture";
import type { TranscriptSegment } from "../lib/types";

describe("screen selection", () => {
  it("maps reverse drags from CSS coordinates to physical pixels", () => {
    // Arrange
    const viewport = { width: 1200, height: 800 };
    const image = { width: 2400, height: 1600 };
    // Act
    const region = selectionRegion({ x: 500, y: 400 }, { x: 100, y: 50 }, viewport, image);
    // Assert
    expect(region).toEqual({ x: 200, y: 100, width: 800, height: 700 });
  });

  it("clamps a drag to the virtual desktop and covers fractional edge pixels", () => {
    // Arrange
    const image = { width: 1920, height: 1080 };
    // Act
    const region = selectionRegion({ x: 10.5, y: 20.5 }, { x: 2000, y: -20 }, { width: 1280, height: 720 }, image);
    // Assert
    expect(region).toEqual({ x: 15, y: 0, width: 1905, height: 31 });
  });

  it("rejects tiny physical regions and empty viewports", () => {
    // Arrange
    const size = { width: 100, height: 100 };
    // Act
    const tiny = selectionRegion({ x: 1, y: 1 }, { x: 4, y: 20 }, size, { width: 200, height: 200 });
    const empty = selectionRegion({ x: 1, y: 1 }, { x: 40, y: 40 }, { width: 0, height: 100 }, size);
    // Assert
    expect(tiny).toBeNull();
    expect(empty).toBeNull();
    expect(selectionRegion({ x: 0, y: 0 }, { x: 4, y: 4 }, size, { width: 200, height: 200 })).toEqual({ x: 0, y: 0, width: 8, height: 8 });
  });
});

describe("screen task meeting context", () => {
  const segment = (text: string, timestamp_ms: number, is_final = true): TranscriptSegment => ({
    id: text, text, timestamp_ms, is_final, speaker: "Them", confidence: 1,
  });

  it("includes only recent finalized lines relative to the current meeting clock", () => {
    // Arrange
    const segments = [segment("old", 1000), segment("recent", 65000), segment("unfinished", 80000, false), segment("future", 150000)];
    // Act
    const context = recentScreenTranscript(segments, 120000);
    // Assert
    expect(context).toBe("Them: recent");
  });

  it("bounds context to 6000 characters and omits it without a meeting", () => {
    // Arrange
    const segments = [segment("x".repeat(8000), 100)];
    // Act
    const context = recentScreenTranscript(segments, 100);
    // Assert
    expect(context).toHaveLength(6000);
    expect(recentScreenTranscript(segments, null)).toBeUndefined();
  });
});

it("normalizes native epoch timestamps alongside meeting-relative segments", () => {
  // Arrange
  const meetingStart = 1_700_000_000_000;
  const line = (text: string, timestamp_ms: number): TranscriptSegment => ({ id: text, text, timestamp_ms, speaker: "Them", is_final: true, confidence: 1 });
  const segments = [line("old native", meetingStart + 1000), line("recent native", meetingStart + 65000), line("relative", 90000)];
  // Act
  const context = recentScreenTranscript(segments, 120000, meetingStart);
  // Assert
  expect(context).toBe("Them: recent native\nThem: relative");
});

it("preserves complete Unicode characters at the context length boundary", () => {
  // Arrange
  const segments: TranscriptSegment[] = [{ id: "unicode", text: "🙂".repeat(6000), timestamp_ms: 1, speaker: "Them", is_final: true, confidence: 1 }];
  // Act
  const context = recentScreenTranscript(segments, 1);
  // Assert
  expect(Array.from(context!)).toHaveLength(6000);
  expect(context).toBe("🙂".repeat(6000));
});
