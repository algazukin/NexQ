import { useState } from "react";
import { ScanLine, RotateCcw, Square, FileCode2 } from "lucide-react";
import { stopHint } from "../hints/actions";
import { formatShortcut } from "../lib/shortcutLabel";
import { useStreamStore } from "../stores/streamStore";
import { showToast } from "../stores/toastStore";
import { useScreenTaskStore } from "./screenTaskStore";
import { analyzeScreen, startScreenCapture, recaptureScreenRegion, runScreenTask } from "./screenTask";

export function ScreenTaskButtons({ showRepeat = true }: { showRepeat?: boolean }) {
  const capture = useScreenTaskStore((s) => s.capture);
  const action = useScreenTaskStore((s) => s.action);
  const busy = useStreamStore((s) => s.isStreaming || s.phase !== "idle");
  const screenInFlight = useStreamStore((s) => (s.isStreaming || s.phase !== "idle") && (s.currentMode === "ScreenTask" || s.currentMode === "CodeReview"));
  const [opening, setOpening] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (opening) {
      return;
    }
    setOpening(true);
    try { await action(); }
    catch (err) { showToast(err instanceof Error ? err.message : String(err), "error"); }
    finally { setOpening(false); }
  };
  const buttonClass = "flex items-center gap-1 rounded-lg px-2 py-1 text-meta font-medium text-muted-foreground hover:bg-accent/50 hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed";
  const captureLabel = `Capture screen task (${formatShortcut("CmdOrCtrl+Alt+S")})`;
  const repeatLabel = `Repeat last region (${formatShortcut("CmdOrCtrl+Shift+Enter")})`;

  return (
    <div className="flex flex-wrap items-center gap-0.5">
      <button
        type="button"
        className={buttonClass}
        disabled={busy || opening}
        onClick={(event) => run(event.shiftKey ? startScreenCapture : analyzeScreen)}
        aria-label={captureLabel}
        title={`${captureLabel} · active display; Shift+click to select an area`}
      >
        <ScanLine className="h-3 w-3" aria-hidden="true" /><span>Screen task</span>
      </button>
      <button type="button" className={buttonClass} disabled={busy || opening}
        onClick={() => run(() => analyzeScreen("review"))} aria-label="Code Review"
        title="Capture the active display and comment on problematic code lines">
        <FileCode2 className="h-3 w-3" aria-hidden="true" /><span>Code Review</span>
      </button>
      {capture && action === "review" && (
        <button type="button" className={buttonClass} disabled={busy || opening}
          onClick={() => run(() => runScreenTask(capture.id, true, "review"))}
          aria-label="Code Review подробно" title="Explain issues and minimal fixes using the same capture">
          <span>Review подробнее</span>
        </button>
      )}
      {showRepeat && (
        <button
          type="button"
          className={buttonClass}
          disabled={!capture || busy || opening}
          onClick={() => run(recaptureScreenRegion)}
          aria-label={repeatLabel}
          title={repeatLabel}
        >
          <RotateCcw className="h-3 w-3" aria-hidden="true" /><span>Repeat region</span>
        </button>
      )}
      {screenInFlight && (
        <button
          type="button"
          className={buttonClass}
          onClick={() => stopHint().catch(() => showToast("Couldn't stop the answer", "error"))}
          aria-label="Stop screen answer"
        >
          <Square className="h-3 w-3" aria-hidden="true" /><span>Stop</span>
        </button>
      )}
    </div>
  );
}

export function ScreenTaskPreview() {
  const capture = useScreenTaskStore((s) => s.capture);
  if (!capture) {
    return null;
  }
  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border/20 px-3 py-2">
      <img src={capture.image_url} alt="Captured screen task" className="max-h-16 max-w-32 rounded border border-border/30 object-contain" />
      <div className="text-meta text-muted-foreground">
        <p>Last capture</p>
        <p className="tabular-nums text-muted-foreground/60">{capture.width} × {capture.height}</p>
      </div>
    </div>
  );
}
