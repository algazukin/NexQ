import { formatShortcut } from "../lib/shortcutLabel";
import { useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { GripHorizontal, Maximize2, Pause, Play, Settings, Square } from "lucide-react";
import { useConfigStore } from "../stores/configStore";
import { useMeetingStore } from "../stores/meetingStore";
import { useAIActionsStore } from "../stores/aiActionsStore";
import { useStreamStore } from "../stores/streamStore";
import { analyzeScreen, startScreenCapture } from "../screen/screenTask";
import { useScreenTaskStore } from "../screen/screenTaskStore";
import { EMPTY_HINT, useHintStore } from "./hintStore";
import { requestHint, stopHint } from "./actions";

export function HintOverlay() {
  const hint = useHintStore();
  const busy = useStreamStore((state) => state.isStreaming || state.phase !== "idle");
  const automatic = useAIActionsStore((state) => state.configs.globalDefaults.autoTrigger);
  const meeting = useMeetingStore((state) => state.activeMeeting);
  const hintShortcut = useConfigStore((state) => state.hotkeys.hint_now ?? "CmdOrCtrl+Alt+Space");
  const detailsShortcut = useConfigStore((state) => state.hotkeys.hint_details ?? "CmdOrCtrl+Alt+Enter");
  const opacity = useConfigStore((state) => state.overlayOpacity);
  const scroll = useRef<HTMLDivElement>(null);
  const content = hint.expanded ? hint.details || hint.shortAnswer : hint.shortAnswer;
  const run = (action: () => Promise<void>) => {
    action().catch((error) => useHintStore.setState({ error: error instanceof Error ? error.message : String(error) }));
  };
  const iconClass = "rounded-md p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground";
  const buttonClass = "rounded-lg border border-border/30 px-3 py-1.5 text-xs text-foreground/90 hover:bg-accent/50 disabled:cursor-not-allowed disabled:opacity-40";

  return (
    <section className="overlay-bg flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-border/30 text-foreground shadow-xl" style={{ background: `hsl(var(--background) / ${opacity})` }}>
      <header data-tauri-drag-region className="flex shrink-0 cursor-move items-center gap-2 border-b border-border/15 px-3 py-1.5">
        <GripHorizontal aria-hidden="true" className="h-3 w-3 text-muted-foreground/50" />
        <span data-tauri-drag-region className="flex-1 text-xs text-muted-foreground">
          {hint.kind === "screen" ? hint.screenAction === "review" ? "Code Review" : "Задача с экрана" : busy ? "Готовлю подсказку…" : automatic && meeting ? "Подсказки · авто" : "Подсказки"}
        </span>
        {meeting && <button className={iconClass} aria-label={automatic ? "Приостановить автоответы" : "Включить автоответы"} title={automatic ? "Приостановить автоответы" : "Включить автоответы"} onClick={() => useAIActionsStore.getState().updateGlobalDefaults({ autoTrigger: !automatic })}>
          {automatic ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
        </button>}
        <button className={iconClass} aria-label="Открыть полный режим" title="Полный режим: история и транскрипт" onClick={() => useConfigStore.getState().setHintsEnabled(false)}><Maximize2 className="h-3 w-3" /></button>
        <button className={iconClass} aria-label="Настройки" title="Настройки" onClick={() => useMeetingStore.getState().setCurrentView("settings")}><Settings className="h-3 w-3" /></button>
      </header>
      <div ref={scroll} className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {content ? <div className={`prose prose-sm prose-invert max-w-none break-words text-[14px] leading-relaxed prose-p:my-1 prose-ul:my-1 prose-pre:overflow-x-auto [&_ul]:list-disc [&_ul]:pl-4 [&_li]:my-1 [&_pre]:rounded-md [&_pre]:bg-black/20 [&_pre]:p-3 ${hint.kind === "screen" && hint.screenAction === "review" ? "code-review" : ""}`}>
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
        </div> : <p className="text-sm leading-relaxed text-muted-foreground/70">{busy ? "Готовлю ответ…" : meeting ? "Подсказка появится после вопроса собеседника." : "Разбери задачу с экрана одной командой."}</p>}
        {hint.error && <p role="alert" className="mt-2 text-xs text-destructive">{hint.error}</p>}
      </div>
      <footer className="flex shrink-0 flex-wrap items-center gap-1.5 border-t border-border/15 px-3 py-2">
        <button className={buttonClass} aria-label="Подскажи сейчас" title={`${formatShortcut(hintShortcut)} · можно изменить в Hotkeys`} disabled={busy || !meeting} onClick={() => run(() => requestHint())}>Подскажи</button>
        <button className={buttonClass} disabled={busy || !hint.shortAnswer} title={`${formatShortcut(detailsShortcut)} · подробности / кратко`} onClick={() => {
          if (hint.expanded) {
            useHintStore.setState({ expanded: false });
          } else {
            run(() => requestHint(true));
          }
          if (scroll.current) {
            scroll.current.scrollTop = 0;
          }
        }}>{hint.expanded ? "Кратко" : "Подробнее"}</button>
        <button className={buttonClass} aria-label="Разобрать экран" title="Ctrl+Alt+S · найти задачу на активном мониторе; Shift+клик — выделить область" disabled={busy} onClick={(event) => run(event.shiftKey ? startScreenCapture : analyzeScreen)}>Экран</button>
        <button className={buttonClass} aria-label="Code Review" title="Снимок активного монитора и короткие комментарии у проблемных строк кода" disabled={busy} onClick={() => run(() => analyzeScreen("review"))}>Code Review</button>
        {busy && <button className={iconClass} aria-label="Остановить ответ" onClick={() => run(stopHint)}><Square className="h-3 w-3" /></button>}
        {!busy && hint.kind === "screen" && meeting && <button className="ml-auto text-xs text-muted-foreground hover:text-foreground" title="Отключить контекст текущего снимка и вернуться к устным вопросам" onClick={() => {
          useHintStore.setState({ ...EMPTY_HINT });
          useScreenTaskStore.setState({ conversation: null, requestTranscript: undefined });
        }}>К вопросам</button>}
      </footer>
    </section>
  );
}
