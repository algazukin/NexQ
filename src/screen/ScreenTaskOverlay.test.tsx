import { render, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@tauri-apps/plugin-store", () => ({ load: async () => ({ get: async () => undefined, set: async () => {}, onKeyChange: async () => () => {} }) }));
import { useConfigStore } from "../stores/configStore";
import { ScreenTaskOverlay } from "./ScreenTaskOverlay";
import { useMeetingStore } from "../stores/meetingStore";
import { useStreamStore } from "../stores/streamStore";
import { useScreenTaskStore } from "./screenTaskStore";

beforeEach(() => {
  useConfigStore.setState({ hintsEnabled: false });
  useMeetingStore.setState({ activeMeeting: null });
  useStreamStore.getState().resetForMeeting();
  useScreenTaskStore.setState({ capture: null });
});

it("offers a screen capture after a standalone request was cancelled before answering", () => {
  // Arrange
  useStreamStore.getState().setPending("ScreenTask", "cancelled");
  useStreamStore.getState().clearPending("cancelled");
  // Act
  render(<ScreenTaskOverlay />);
  // Assert
  expect(screen.getByText("Capture a screen task to get an answer.")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /Capture screen task/ })).toBeEnabled();
  expect(screen.queryByText(/for AI assistance/)).not.toBeInTheDocument();
});
