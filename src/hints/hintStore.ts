import { create } from "zustand";
import type { ScreenAction } from "../screen/capture";

export interface HintState {
  question: string;
  requestId: string | null;
  requestKind: "short" | "details";
  detailsReady: boolean;
  kind: "speech" | "screen";
  captureId: string | null;
  screenAction: ScreenAction;
  shortAnswer: string;
  details: string;
  expanded: boolean;
  error: string | null;
}

export const EMPTY_HINT: HintState = {
  requestId: null, requestKind: "short", detailsReady: false,
  question: "", kind: "speech", captureId: null, screenAction: "solve", shortAnswer: "", details: "", expanded: false, error: null,
};

export const useHintStore = create<HintState>(() => ({ ...EMPTY_HINT }));
