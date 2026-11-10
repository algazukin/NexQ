import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HintScheduler, looksLikeHintQuestion } from "./scheduler";
import type { TranscriptSegment } from "../lib/types";

const line = (id: string, text: string, speaker = "Them", is_final = true) => ({ id, text, speaker, is_final, timestamp_ms: 1000, confidence: 1 }) as TranscriptSegment;

describe("HintScheduler", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("waits for a finished remote question and merges its refinement", async () => {
    // Arrange
    const request = vi.fn().mockResolvedValue(undefined);
    const scheduler = new HintScheduler(request, () => true);
    // Act
    scheduler.observe([line("1", "Что такое Task?")]);
    await vi.advanceTimersByTimeAsync(400);
    scheduler.observe([line("1", "Что такое Task?"), line("2", "И чем он отличается от Thread?")]);
    await vi.advanceTimersByTimeAsync(749);
    // Assert
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toContain("Thread");
    expect(request.mock.calls[0][0]).toContain("Task");
    scheduler.dispose();
  });

  it("ignores interim and own questions and cancels when the user begins answering", async () => {
    // Arrange
    const request = vi.fn().mockResolvedValue(undefined);
    const scheduler = new HintScheduler(request, () => true);
    // Act
    scheduler.observe([line("1", "Что такое Task?", "Them", false), line("2", "Как работает async?", "User")]);
    await vi.advanceTimersByTimeAsync(1000);
    scheduler.observe([line("3", "Explain dependency injection")]);
    scheduler.observe([line("3", "Explain dependency injection"), line("4", "Это способ передачи зависимостей", "User", false)]);
    await vi.advanceTimersByTimeAsync(1000);
    // Assert
    expect(request).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("suppresses punctuation and case variants of a recently answered question", async () => {
    // Arrange
    const request = vi.fn().mockResolvedValue(undefined);
    const scheduler = new HintScheduler(request, () => true);
    // Act
    scheduler.observe([line("1", "What is Task?")]);
    await vi.advanceTimersByTimeAsync(800);
    scheduler.observe([line("1", "What is Task?"), line("2", "WHAT IS TASK ?")]);
    await vi.advanceTimersByTimeAsync(10000);
    // Assert
    expect(request).toHaveBeenCalledTimes(1);
    scheduler.dispose();
  });

  it("waits while details are open and drops an expired question", async () => {
    // Arrange
    const request = vi.fn().mockResolvedValue(undefined);
    let allowed = false;
    const scheduler = new HintScheduler(request, () => allowed);
    // Act
    scheduler.observe([line("1", "Как работает GC?")]);
    await vi.advanceTimersByTimeAsync(16000);
    allowed = true;
    await vi.advanceTimersByTimeAsync(1000);
    // Assert
    expect(request).not.toHaveBeenCalled();
    scheduler.dispose();
  });

  it("holds the answer for reading and cancels pending work on disposal", async () => {
    // Arrange
    const request = vi.fn().mockResolvedValue(undefined);
    const scheduler = new HintScheduler(request, () => true);
    scheduler.holdForReading();
    // Act
    scheduler.observe([line("1", "Как работает GC?")]);
    await vi.advanceTimersByTimeAsync(7999);
    // Assert
    expect(request).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(request).toHaveBeenCalledTimes(1);
    scheduler.observe([line("2", "Что такое IDisposable?")]);
    scheduler.dispose();
    await vi.advanceTimersByTimeAsync(10000);
    expect(request).toHaveBeenCalledTimes(1);
  });
});


it("does not answer while a remote interim continuation is unfinished", async () => {
  // Arrange
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(undefined);
  const scheduler = new HintScheduler(request, () => true);
  // Act
  scheduler.observe([line("q", "What is Task?")]);
  scheduler.observe([{ ...line("q", "What is Task?"), pending_text: "What is Task and how" }]);
  await vi.advanceTimersByTimeAsync(2000);
  // Assert
  expect(request).not.toHaveBeenCalled();
  scheduler.observe([line("q", "What is Task and how does it differ from Thread?")]);
  await vi.advanceTimersByTimeAsync(750);
  expect(request).toHaveBeenCalledTimes(1);
  scheduler.dispose();
  vi.useRealTimers();
});

it("does not regenerate a spoken question when only a qualification is appended later", async () => {
  // Arrange
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(undefined);
  const scheduler = new HintScheduler(request, () => true);
  // Act
  scheduler.observe([line("q", "Что такое Task?")]);
  await vi.advanceTimersByTimeAsync(1000);
  scheduler.observe([line("q", "Что такое Task? Например в ASP.NET Core.")]);
  await vi.advanceTimersByTimeAsync(9000);
  // Assert
  expect(request).toHaveBeenCalledTimes(1);
  scheduler.dispose();
  vi.useRealTimers();
});


it("keeps an unchanged newer interim blocked when an older final is corrected", async () => {
  // Arrange
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(undefined);
  const scheduler = new HintScheduler(request, () => true);
  const interim = line("b", "And what about", "Them", false);
  // Act
  scheduler.observe([line("a", "What is Task?"), interim]);
  await vi.advanceTimersByTimeAsync(300);
  scheduler.observe([line("a", "What is a Task?"), interim]);
  await vi.advanceTimersByTimeAsync(1000);
  // Assert
  expect(request).not.toHaveBeenCalled();
  scheduler.dispose();
  vi.useRealTimers();
});

it("retains only the newest separate question during a reading hold", async () => {
  // Arrange
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(undefined);
  const scheduler = new HintScheduler(request, () => true);
  scheduler.holdForReading();
  // Act
  scheduler.observe([line("a", "What is Task?")]);
  await vi.advanceTimersByTimeAsync(3000);
  scheduler.observe([line("a", "What is Task?"), line("b", "Что такое Dictionary?")]);
  await vi.advanceTimersByTimeAsync(5000);
  // Assert
  expect(request).toHaveBeenCalledWith("Что такое Dictionary?");
  scheduler.dispose();
  vi.useRealTimers();
});


it("does not revive an older remote question after the user has started answering", async () => {
  // Arrange
  vi.useFakeTimers();
  const request = vi.fn().mockResolvedValue(undefined);
  const scheduler = new HintScheduler(request, () => true);
  const local = line("u", "A task represents", "User", false);
  // Act
  scheduler.observe([line("q", "What is Task?"), local]);
  await vi.advanceTimersByTimeAsync(300);
  scheduler.observe([line("q", "What is a Task?"), local]);
  await vi.advanceTimersByTimeAsync(1000);
  // Assert
  expect(request).not.toHaveBeenCalled();
  scheduler.dispose();
  vi.useRealTimers();
});


it("recognizes short technical follow-up forms without requiring punctuation", () => {
  // Arrange
  const questions = ["А если без учёта регистра", "А почему здесь нельзя lock", "Что если данные приходят параллельно", "What if values are null"];
  // Act
  const detected = questions.map(looksLikeHintQuestion);
  // Assert
  expect(detected).toEqual([true, true, true, true]);
});
