import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
const actions = vi.hoisted(() => ({ hint: vi.fn(), screen: vi.fn() }));
vi.mock("./actions", () => ({ requestHint: actions.hint }));
vi.mock("../screen/screenTask", () => ({ analyzeScreen: actions.screen }));
import { HintOverlay } from "./HintOverlay";
import { EMPTY_HINT, useHintStore } from "./hintStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useScreenTaskStore } from "../screen/screenTaskStore";
import { useStreamStore } from "../stores/streamStore";

beforeEach(() => {
  vi.clearAllMocks();
  actions.hint.mockResolvedValue(undefined);
  actions.screen.mockResolvedValue(undefined);
  useHintStore.setState({ ...EMPTY_HINT, shortAnswer: "Task представляет асинхронную операцию." });
  useStreamStore.getState().resetForMeeting();
});

it("keeps the useful answer visible while the next request is pending", () => {
  // Arrange
  useStreamStore.getState().setPending("Hint", "next");
  // Act
  render(<HintOverlay />);
  // Assert
  expect(screen.getByText("Task представляет асинхронную операцию.")).toBeTruthy();
  expect(screen.queryByText("Transcript")).toBeNull();
  expect(screen.queryByText("History")).toBeNull();
  expect(screen.getByRole("button", { name: /Подскажи сейчас/ })).toBeDisabled();
});

it("collapses cached details back to the short answer without regenerating", () => {
  // Arrange
  useHintStore.setState({ expanded: true, details: "Подробный пример C#" });
  render(<HintOverlay />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: "Кратко" }));
  // Assert
  expect(screen.getByText("Task представляет асинхронную операцию.")).toBeTruthy();
  expect(screen.queryByText("Подробный пример C#")).toBeNull();
  expect(actions.hint).not.toHaveBeenCalled();
});

it("analyzes the screen with one action", () => {
  // Arrange
  render(<HintOverlay />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: /Разобрать экран/ }));
  // Assert
  expect(actions.screen).toHaveBeenCalledTimes(1);
});


it("starts Code Review from a separate button", () => {
  // Arrange
  render(<HintOverlay />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: "Code Review" }));
  // Assert
  expect(actions.screen).toHaveBeenCalledWith("review");
});

it("detaches the active screenshot and its memory when returning to spoken questions", () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never });
  useHintStore.setState({ ...EMPTY_HINT, kind: "screen", captureId: "task", shortAnswer: "Screen answer" });
  useScreenTaskStore.setState({ capture: { id: "task", image_url: "private", width: 100, height: 100 }, conversation: { taskContext: "Old conditions" } });
  render(<HintOverlay />);
  // Act
  fireEvent.click(screen.getByRole("button", { name: "К вопросам" }));
  // Assert
  expect(useHintStore.getState()).toMatchObject({ kind: "speech", captureId: null });
  expect(useScreenTaskStore.getState().conversation).toBeNull();
  expect(useScreenTaskStore.getState().capture?.id).toBe("task");
});
