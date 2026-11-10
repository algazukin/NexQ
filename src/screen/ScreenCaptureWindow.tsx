import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { selectionRegion, type ScreenCapture, type ScreenPoint } from "./capture";

/** A separate root keeps meeting hooks and global shortcuts off the frozen desktop. */
export function ScreenCaptureWindow() {
  const [capture, setCapture] = useState<ScreenCapture | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [start, setStart] = useState<ScreenPoint | null>(null);
  const [end, setEnd] = useState<ScreenPoint | null>(null);
  const [status, setStatus] = useState("Loading screen…");
  const drag = useRef<{ point: ScreenPoint; pointerId: number } | null>(null);
  const submitted = useRef(false);
  const cancelled = useRef(false);
  const captureRef = useRef<ScreenCapture | null>(null);

  useEffect(() => {
    let active = true;
    invoke<ScreenCapture>("get_screen_capture").then((image) => {
      if (!active) return;
      captureRef.current = image;
      if (cancelled.current) return;
      setCapture(image);
    }).catch((err) => {
      if (active) setStatus(`Couldn't load the screen: ${String(err)}`);
    });
    return () => { active = false; };
  }, []);

  const cancel = () => {
    if (submitted.current || cancelled.current) return;
    cancelled.current = true;
    drag.current = null;
    setStart(null);
    setEnd(null);
    const captureId = captureRef.current?.id ?? new URLSearchParams(window.location.search).get("captureId");
    if (captureId) invoke("cancel_screen_capture", { captureId }).catch((err) => {
      cancelled.current = false;
      setStatus(`Couldn't cancel: ${String(err)}`);
    });
  };

  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        cancel();
      }
    };
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, []);

  return (
    <div
      role="application"
      aria-label="Select a screen task"
      className="fixed inset-0 overflow-hidden bg-black select-none cursor-crosshair"
      style={{ touchAction: "none" }}
      onContextMenu={(event) => event.preventDefault()}
      onPointerDown={(event) => {
        if (event.button !== 0 || !loaded || submitted.current || cancelled.current || drag.current) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        drag.current = { point, pointerId: event.pointerId };
        setStart(point);
        setEnd(point);
        try { event.currentTarget.setPointerCapture?.(event.pointerId); }
        catch { /* The fullscreen surface still receives pointer-up while capture is unavailable. */ }
      }}
      onPointerMove={(event) => {
        if (!drag.current || drag.current.pointerId !== event.pointerId) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        setEnd({
          x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
          y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
        });
      }}
      onPointerCancel={() => {
        drag.current = null;
        setStart(null);
        setEnd(null);
      }}
      onPointerUp={(event) => {
        const currentDrag = drag.current;
        if (!currentDrag || currentDrag.pointerId !== event.pointerId || !capture || submitted.current || cancelled.current) return;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) {
          event.currentTarget.releasePointerCapture(event.pointerId);
        }
        const bounds = event.currentTarget.getBoundingClientRect();
        const point = { x: event.clientX - bounds.left, y: event.clientY - bounds.top };
        const region = selectionRegion(currentDrag.point, point, bounds, capture);
        if (!region) {
          setStart(null);
          setEnd(null);
          setStatus("Select an area at least 8 × 8 pixels");
          return;
        }
        submitted.current = true;
        setStatus("Opening your answer…");
        invoke("finish_screen_capture", { captureId: capture.id, region }).catch((err) => {
          submitted.current = false;
          setStart(null);
          setEnd(null);
          setStatus(`Couldn't select this area: ${String(err)}`);
        });
      }}
    >
      {capture && (
        <img
          src={capture.image_url}
          alt="Frozen desktop"
          draggable={false}
          className="pointer-events-none absolute inset-0 h-full w-full"
          onLoad={() => { setLoaded(true); setStatus("Drag around the task"); }}
          onError={() => setStatus("Couldn't display the screen. Press Esc to cancel.")}
        />
      )}
      {(!start || !end) && <div className="pointer-events-none absolute inset-0 bg-black/35" />}
      {start && end && (
        <div
          className="pointer-events-none absolute border-2 border-white"
          style={{
            left: Math.min(start.x, end.x),
            top: Math.min(start.y, end.y),
            width: Math.abs(end.x - start.x),
            height: Math.abs(end.y - start.y),
            boxShadow: "0 0 0 99999px rgb(0 0 0 / 35%)",
          }}
        />
      )}
      <div className="pointer-events-none absolute left-1/2 top-6 -translate-x-1/2 rounded-xl bg-zinc-950/95 px-5 py-3 text-center text-sm text-white shadow-xl">
        <p className="font-semibold">Release to analyze · Esc to cancel</p>
        <p role="status" className="mt-1 text-xs text-zinc-300">{status}</p>
      </div>
    </div>
  );
}
