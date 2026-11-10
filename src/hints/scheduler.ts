import type { TranscriptSegment } from "../lib/types";

export function looksLikeHintQuestion(text: string): boolean {
  const words = text.match(/[\p{L}\p{N}]+/gu) ?? [];
  if (words.length < 2) {
    return false;
  }
  return /\?\s*$/.test(text) || /^\s*(а если|а почему|а как|а что|а можно|what|how|why|when|where|who|which|can you|could you|would you|tell me|explain|describe|что|как|почему|зачем|когда|чем|какой|какая|какие|расскажи|расскажите|объясни|объясните|в чём|в чем)(?:\s|:)/iu.test(text);
}

function questionKey(text: string): string {
  return (text.toLowerCase().match(/[\p{L}\p{N}+#]+/gu) ?? []).join(" ");
}

/** One owner per meeting: merge speech before generating, then keep the answer readable. */
export class HintScheduler {
  private checked = new Map<string, TranscriptSegment>();
  private recent = new Map<string, number>();
  private answered = new Map<string, string>();
  private unfinishedRemote = false;
  private pending: { lines: Map<string, string>; updated: number } | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private holdUntil = 0;
  private inFlight = false;
  private disposed = false;

  constructor(
    private request: (question: string) => Promise<void>,
    private allowed: () => boolean,
    initial: TranscriptSegment[] = [],
  ) {
    for (const segment of initial) {
      this.checked.set(segment.id, segment);
    }
  }

  observe(segments: TranscriptSegment[]): void {
    if (this.disposed) {
      return;
    }
    const latest = segments[segments.length - 1];
    this.unfinishedRemote = !!latest && (latest.speaker === "Them" || latest.speaker === "Interviewer") && (!latest.is_final || !!latest.pending_text);
    let lastUserIndex = -1;
    for (let index = segments.length - 1; index >= 0; index--) {
      if (segments[index].speaker === "User") {
        lastUserIndex = index;
        break;
      }
    }
    for (const [index, segment] of segments.entries()) {
      const previous = this.checked.get(segment.id);
      if (previous === segment || (previous?.text === segment.text && previous.pending_text === segment.pending_text && previous.is_final === segment.is_final && previous.speaker === segment.speaker)) {
        continue;
      }
      this.checked.set(segment.id, segment);
      if (index < lastUserIndex) {
        continue;
      }
      if (segment.speaker === "User") {
        this.pending = null;
        continue;
      }
      if (segment.speaker !== "Them" && segment.speaker !== "Interviewer") {
        continue;
      }
      if (!segment.is_final || segment.pending_text) {
        if (this.pending) {
          this.schedule(750);
        }
        continue;
      }
      const answered = this.answered.get(segment.id);
      const text = answered && segment.text.startsWith(answered) ? segment.text.slice(answered.length) : segment.text;
      if (answered && !looksLikeHintQuestion(text)) {
        continue;
      }
      const key = questionKey(text);
      const now = Date.now();
      if (this.recent.has(key) && now - this.recent.get(key)! < 90_000) {
        continue;
      }
      if (looksLikeHintQuestion(text)) {
        if (!this.pending || now - this.pending.updated > 1500) {
          this.pending = { lines: new Map(), updated: now };
        }
        this.pending.lines.set(segment.id, text);
        this.pending.updated = now;
      } else if (this.pending) {
        this.pending.lines.set(segment.id, segment.text);
        this.pending.updated = now;
      }
      if (this.pending) {
        this.schedule(750);
      }
    }
  }

  acknowledge(question: string): void {
    this.pending = null;
    this.recent.set(questionKey(question), Date.now());
  }

  holdForReading(): void {
    this.holdUntil = Date.now() + 8000;
  }

  dispose(): void {
    this.disposed = true;
    this.pending = null;
    clearTimeout(this.timer);
  }

  private schedule(delay: number): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    const pending = this.pending;
    if (!pending || this.disposed) {
      return;
    }
    const now = Date.now();
    if (now - pending.updated >= 15_000) {
      this.pending = null;
      return;
    }
    if (now < this.holdUntil) {
      this.schedule(this.holdUntil - now);
      return;
    }
    if (this.unfinishedRemote || this.inFlight || !this.allowed()) {
      this.schedule(500);
      return;
    }
    this.pending = null;
    const question = [...pending.lines.values()].join(" ");
    for (const [key, at] of this.recent) {
      if (now - at >= 90_000) {
        this.recent.delete(key);
      }
    }
    this.recent.set(questionKey(question), now);
    for (const [id, line] of pending.lines) {
      this.recent.set(questionKey(line), now);
      this.answered.set(id, this.checked.get(id)?.text ?? line);
    }
    this.inFlight = true;
    this.request(question).catch(() => {}).finally(() => {
      this.inFlight = false;
      this.holdForReading();
    });
  }
}
