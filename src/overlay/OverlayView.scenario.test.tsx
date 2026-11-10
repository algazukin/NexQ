import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Meeting } from "../lib/types";
import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useScenarioStore } from "../stores/scenarioStore";
import { OverlayView } from "./OverlayView";

const { invoke, emit } = vi.hoisted(() => ({
  invoke: vi.fn(async (command: string, _args?: unknown) => {
    if (command === "start_meeting") {
      return JSON.stringify({ id: "meeting", title: "Test meeting" });
    }
  }),
  emit: vi.fn(async (_name: string, _payload?: unknown) => {}),
}));
vi.mock("@tauri-apps/api/core", () => ({ invoke }));
vi.mock("@tauri-apps/api/event", () => ({ emit, listen: async () => () => {} }));
vi.mock("@tauri-apps/plugin-store", () => ({
  load: async () => ({ set: async () => {} }),
}));
vi.mock("../components/ServiceStatusBar", () => ({ ServiceStatusBar: () => null }));

beforeEach(() => {
  invoke.mockClear();
  emit.mockClear();
  useConfigStore.setState({ hintsEnabled: false });
  useMeetingStore.setState({ activeMeeting: null, aiScenario: "team_meeting", audioMode: "online" });
  useScenarioStore.setState({ activeScenarioId: "team_meeting" });
});

afterEach(() => {
  cleanup();
  useMeetingStore.getState().stopTimer();
});

it("displays the active interview and opens hints despite a stale window preference", () => {
  // Arrange
  useMeetingStore.setState({
    activeMeeting: { id: "meeting", title: "Test meeting" } as Meeting,
    aiScenario: "interview",
  });

  // Act
  render(<OverlayView />);

  // Assert
  expect(screen.getByText("Interview")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Подсказки" }));
  expect(screen.getByRole("button", { name: "Подскажи сейчас" })).toBeInTheDocument();
});

it("uses the remembered interview setup when starting without explicit options", async () => {
  // Arrange
  useConfigStore.setState({ rememberedMeetingSetup: { audioMode: "online", scenario: "interview" } });

  // Act
  await useMeetingStore.getState().startMeetingFlow();

  // Assert
  expect(useMeetingStore.getState().activeMeeting).toMatchObject({ ai_scenario: "interview", audio_mode: "online" });
  expect(invoke).toHaveBeenCalledWith("update_meeting_mode", {
    meetingId: "meeting", aiScenario: "interview", audioMode: "online",
  });
  await waitFor(() => expect(emit).toHaveBeenCalledWith("nexq:meeting_started", expect.objectContaining({
    meeting: expect.objectContaining({ ai_scenario: "interview" }),
    aiScenario: "interview",
  })));
});

it("keeps an explicit team meeting selection over the remembered interview", async () => {
  // Arrange
  useConfigStore.setState({ rememberedMeetingSetup: { audioMode: "online", scenario: "interview" } });

  // Act
  await useMeetingStore.getState().startMeetingFlow(undefined, "online", "team_meeting");

  // Assert
  expect(useMeetingStore.getState().activeMeeting).toMatchObject({ ai_scenario: "team_meeting" });
  await waitFor(() => expect(emit).toHaveBeenCalledWith("nexq:meeting_started", expect.objectContaining({
    aiScenario: "team_meeting",
  })));
});
