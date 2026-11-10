export type ScreenAction = "solve" | "review";

import type { TranscriptSegment } from "../lib/types";

export interface ScreenConversation {
  taskContext?: string;
  question?: string;
  previousAnswer?: string;
}

export interface ScreenCapture {
  id: string;
  image_url: string;
  width: number;
  height: number;
}

export interface ScreenRegion { x: number; y: number; width: number; height: number }
export interface ScreenPoint { x: number; y: number }
interface Size { width: number; height: number }

/** The selector spans the virtual desktop; its CSS pixels may have a different scale. */
export function selectionRegion(start: ScreenPoint, end: ScreenPoint, viewport: Size, image: Size): ScreenRegion | null {
  if (viewport.width <= 0 || viewport.height <= 0 || image.width <= 0 || image.height <= 0) return null;
  const scaleX = image.width / viewport.width;
  const scaleY = image.height / viewport.height;
  const left = Math.max(0, Math.floor(Math.min(start.x, end.x) * scaleX));
  const top = Math.max(0, Math.floor(Math.min(start.y, end.y) * scaleY));
  const right = Math.min(image.width, Math.ceil(Math.max(start.x, end.x) * scaleX));
  const bottom = Math.min(image.height, Math.ceil(Math.max(start.y, end.y) * scaleY));
  if (right - left < 8 || bottom - top < 8) return null;
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** STT sources send either epoch timestamps or offsets from the meeting start. */
export function recentScreenTranscript(
  segments: TranscriptSegment[],
  elapsedMs: number | null,
  meetingStartTime: number | null = null,
  windowSeconds = 60,
): string | undefined {
  if (elapsedMs === null) return undefined;
  const text = segments
    .filter((segment) => {
      if (!segment.is_final) return false;
      const timestamp = meetingStartTime !== null && segment.timestamp_ms >= meetingStartTime
        ? segment.timestamp_ms - meetingStartTime
        : segment.timestamp_ms;
      return timestamp >= Math.max(0, elapsedMs - windowSeconds * 1000) && timestamp <= elapsedMs;
    })
    .map((segment) => `${segment.speaker}: ${segment.text}`)
    .join("\n");
  return Array.from(text).slice(-6000).join("") || undefined;
}