import { create } from "zustand";
import type { ScreenAction, ScreenCapture, ScreenConversation } from "./capture";

/** The preview lives only in this webview's memory; images never enter meeting storage. */
export const useScreenTaskStore = create<{ capture: ScreenCapture | null; action: ScreenAction; conversation: ScreenConversation | null; requestTranscript: string | undefined }>(() => ({ capture: null, action: "solve", conversation: null, requestTranscript: undefined }));
