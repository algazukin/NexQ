import { useScreenTaskStore } from "./screenTaskStore";
import { useInterviewHintMode } from "../hints/hintMode";
import { HintOverlay } from "../hints/HintOverlay";
import { GripHorizontal, Minus, Settings } from "lucide-react";
import { AIResponsePanel } from "../overlay/AIResponsePanel";
import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";
import { showLauncherWindow } from "../lib/windows";
import { ScreenTaskButtons, ScreenTaskPreview } from "./ScreenTaskControls";

/** Screen answers use the familiar overlay without starting audio or creating a meeting. */
export function ScreenTaskOverlay() {
  const action = useScreenTaskStore((state) => state.action);
  const opacity = useConfigStore((s) => s.overlayOpacity);
  const hintsEnabled = useInterviewHintMode();
  if (hintsEnabled) {
    return <HintOverlay />;
  }
  return (
    <div
      className="overlay-bg flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/20 text-foreground shadow-xl"
      style={{ background: `hsl(var(--background) / ${opacity})` }}
    >
      <header data-tauri-drag-region className="flex shrink-0 cursor-move items-center gap-2 border-b border-border/20 px-4 py-2">
        <GripHorizontal aria-hidden="true" className="h-3 w-3 text-muted-foreground/50" />
        <h1 data-tauri-drag-region className="flex-1 text-xs font-semibold">{action === "review" ? "Code Review" : "Screen task"}</h1>
        <button
          type="button"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent/50"
          aria-label="Open settings"
          onClick={() => useMeetingStore.getState().setSettingsOpen(true)}
        >
          <Settings className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className="rounded-lg p-2 text-muted-foreground hover:bg-accent/50"
          aria-label="Return to dashboard"
          onClick={() => showLauncherWindow().catch(() => {})}
        >
          <Minus className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      </header>
      <div className="shrink-0 border-b border-border/20 px-2.5 py-1.5"><ScreenTaskButtons /></div>
      <ScreenTaskPreview />
      <div className="flex min-h-0 flex-1 flex-col p-3">
        <AIResponsePanel emptyHint="Capture a screen task to get an answer." />
      </div>
    </div>
  );
}
