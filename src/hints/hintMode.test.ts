import { beforeEach, expect, it } from "vitest";
import { isInterviewHintMode } from "./hintMode";
import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";

beforeEach(() => {
  useConfigStore.setState({ hintsEnabled: true });
  useMeetingStore.setState({ activeMeeting: { id: "m" } as never, aiScenario: "interview" });
});

it("enables compact hints for an active interview", () => {
  // Arrange
  // Act
  const enabled = isInterviewHintMode();
  // Assert
  expect(enabled).toBe(true);
});

it.each(["team_meeting", "lecture", "webinar"] as const)("does not enable interview hints for %s", (scenario) => {
  // Arrange
  useMeetingStore.setState({ aiScenario: scenario });
  // Act
  const enabled = isInterviewHintMode();
  // Assert
  expect(enabled).toBe(false);
});

it("uses the running meeting's scenario rather than a different pending selection", () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: { id: "m", ai_scenario: "team_meeting" } as never, aiScenario: "interview" });
  // Act
  const enabled = isInterviewHintMode();
  // Assert
  expect(enabled).toBe(false);
});

it("disables hints after the interview ends without changing the saved preference", () => {
  // Arrange
  useMeetingStore.setState({ activeMeeting: null });
  // Act
  const enabled = isInterviewHintMode();
  // Assert
  expect(enabled).toBe(false);
  expect(useConfigStore.getState().hintsEnabled).toBe(true);
});

it("respects the user disabling hints inside an interview", () => {
  // Arrange
  useConfigStore.setState({ hintsEnabled: false });
  // Act
  const enabled = isInterviewHintMode();
  // Assert
  expect(enabled).toBe(false);
});
