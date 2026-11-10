import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";
import type { AIScenario, Meeting } from "../lib/types";

export function isInterviewHintMode(
  enabled = useConfigStore.getState().hintsEnabled,
  meeting: { activeMeeting: Meeting | null; aiScenario: AIScenario } = useMeetingStore.getState(),
): boolean {
  return enabled && meeting.activeMeeting !== null
    && (meeting.activeMeeting.ai_scenario ?? meeting.aiScenario) === "interview";
}

export function useInterviewHintMode(): boolean {
  const enabled = useConfigStore((state) => state.hintsEnabled);
  const activeMeeting = useMeetingStore((state) => state.activeMeeting);
  const aiScenario = useMeetingStore((state) => state.aiScenario);
  return isInterviewHintMode(enabled, { activeMeeting, aiScenario });
}
