// src/hooks/useTranslation.ts
import { useEffect, useRef } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import {
  onTranslationResult,
  onTranslationError,
  onBatchTranslationProgress,
  onTranscriptFinal,
} from "../lib/events";
import { useTranslationStore } from "../stores/translationStore";
import { useMeetingStore } from "../stores/meetingStore";
import { translateSegments, getMeetingTranslations } from "../lib/ipc";
import type { TranscriptUpdateEvent } from "../lib/types";

export function useTranslation(ownsAutoTranslation: boolean) {
  const addTranslation = useTranslationStore((s) => s.addTranslation);
  const addTranslations = useTranslationStore((s) => s.addTranslations);
  const setBatchProgress = useTranslationStore((s) => s.setBatchProgress);
  const targetLang = useTranslationStore((s) => s.targetLang);
  const setTranslating = useTranslationStore((s) => s.setTranslating);

  const activeMeeting = useMeetingStore((s) => s.activeMeeting);
  const meetingId = activeMeeting?.id ?? null;

  // Keep stable refs to avoid stale closures in async event handlers
  const addRef = useRef(addTranslation);
  const addTranslationsRef = useRef(addTranslations);
  const progressRef = useRef(setBatchProgress);
  const setTranslatingRef = useRef(setTranslating);

  useEffect(() => {
    addRef.current = addTranslation;
    addTranslationsRef.current = addTranslations;
    progressRef.current = setBatchProgress;
    setTranslatingRef.current = setTranslating;
  }, [addTranslation, addTranslations, setBatchProgress, setTranslating]);

  // Subscribe to translation result/error/progress events
  useEffect(() => {
    let unResult: UnlistenFn | null = null;
    let unError: UnlistenFn | null = null;
    let unProgress: UnlistenFn | null = null;
    let mounted = true;

    const setup = async () => {
      const u1 = await onTranslationResult((result) => {
        if (!mounted) return;
        addRef.current(result);
      });

      const u2 = await onTranslationError((error) => {
        if (!mounted) return;
        console.warn("[translation] Error:", error.error, error.segment_id);
        // Clear translating state for the failed segment so spinner doesn't hang
        if (error.segment_id) {
          setTranslatingRef.current(error.segment_id, false);
        }
      });

      const u3 = await onBatchTranslationProgress((progress) => {
        if (!mounted) return;
        progressRef.current(
          progress.completed >= progress.total ? null : progress,
        );
      });

      if (mounted) {
        unResult = u1;
        unError = u2;
        unProgress = u3;
      } else {
        u1();
        u2();
        u3();
      }
    };

    setup();

    return () => {
      mounted = false;
      if (unResult) unResult();
      if (unError) unError();
      if (unProgress) unProgress();
    };
  }, []);

  // The overlay owns auto-translation; other windows still receive results.
  useEffect(() => {
    if (!ownsAutoTranslation || !meetingId) {
      return;
    }

    let mounted = true;
    let unlisten: UnlistenFn | null = null;
    // One request per paragraph at a time. Keep only its latest pending version.
    const latestText = new Map<string, string>();

    onTranscriptFinal(async ({ segment }: TranscriptUpdateEvent) => {
      if (!mounted || !segment.is_final || !segment.text || !useTranslationStore.getState().autoTranslateActive) {
        return;
      }

      const { id } = segment;
      const running = latestText.has(id);
      latestText.set(id, segment.text);
      if (running) {
        return;
      }

      try {
        while (mounted && useMeetingStore.getState().activeMeeting?.id === meetingId) {
          const { autoTranslateActive, translations, targetLang, sourceLang, setTranslating } =
            useTranslationStore.getState();
          const text = latestText.get(id);
          if (!autoTranslateActive || !targetLang || !text) {
            break;
          }

          const previous = translations.get(id);
          if (previous?.original_text === text && previous.target_lang === targetLang
            && previous.source_lang === sourceLang) {
            break;
          }

          setTranslating(id, true);
          try {
            await translateSegments([id], [text], meetingId, targetLang,
              sourceLang === "auto" ? undefined : sourceLang, true);
          } catch (err) {
            console.error("[useTranslation] Auto-translate failed:", err);
            setTranslating(id, false);
          }

          if (latestText.get(id) === text) {
            break;
          }
        }
      } finally {
        latestText.delete(id);
      }
    }).then((dispose) => {
      if (mounted) {
        unlisten = dispose;
      } else {
        dispose();
      }
    });

    return () => {
      mounted = false;
      latestText.clear();
      unlisten?.();
    };
  }, [ownsAutoTranslation, meetingId]);

  // Preload cached translations when meeting ID or target language changes
  useEffect(() => {
    if (!meetingId || !targetLang) return;
    getMeetingTranslations(meetingId, targetLang)
      .then((cached) => {
        if (cached.length > 0) {
          addTranslationsRef.current(cached);
        }
      })
      .catch((err) =>
        console.warn("[useTranslation] Failed to preload translations:", err),
      );
  }, [meetingId, targetLang]);
}
