import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const subscriptions = vi.hoisted(() => ({ count: 0 }));
vi.mock("../hooks/useStreamBuffer", async () => {
  const { useEffect } = await import("react");
  return { useStreamBuffer: () => useEffect(() => { subscriptions.count++; return () => { subscriptions.count--; }; }, []) };
});
vi.mock("../hooks/useMeetingTimer", () => ({ useMeetingTimer: () => {} }));
vi.mock("../hooks/useTranscriptPersistence", () => ({ useTranscriptPersistence: () => {} }));
vi.mock("../hooks/useTranscript", () => ({ useTranscript: () => {} }));
vi.mock("../hooks/useSpeechRecognition", () => ({ useSpeechRecognition: () => {} }));
vi.mock("../hooks/useAudioConfigSync", () => ({ useAudioConfigSync: () => {} }));
vi.mock("../hooks/useCallLogCapture", () => ({ useCallLogCapture: () => {} }));
vi.mock("../hooks/useSTTStatus", () => ({ useSTTStatus: () => {} }));
vi.mock("../hooks/useDevLog", () => ({ useDevLog: () => {} }));
import { ActiveMeetingProvider } from "./ActiveMeetingProvider";
import { useMeetingStore } from "../stores/meetingStore";

beforeEach(() => { subscriptions.count = 0; useMeetingStore.setState({ activeMeeting: null }); });

describe("stream subscription lifetime", () => {
  it("keeps exactly one overlay stream subscription with and without a meeting", () => {
    // Arrange
    const view = render(<ActiveMeetingProvider isLauncherWindow={false} />);
    // Act
    const standalone = subscriptions.count;
    act(() => useMeetingStore.setState({ activeMeeting: { id: "meeting" } as never }));
    const duringMeeting = subscriptions.count;
    act(() => useMeetingStore.setState({ activeMeeting: null }));
    // Assert
    expect([standalone, duringMeeting, subscriptions.count]).toEqual([1, 1, 1]);
    view.unmount();
    expect(subscriptions.count).toBe(0);
  });
});
