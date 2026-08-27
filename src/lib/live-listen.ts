// Live audio translation: the app *listens* to the film's speech and shows a
// running Persian caption.
//
// Recognition uses the Chromium Web Speech API (available in the packaged
// Electron desktop app and in Android WebView/Chrome). The recognised text is
// then translated with the same online engine the subtitle translator uses
// (desktop bridge first → CORS-free; browser falls back to the public endpoint).

import { useCallback, useEffect, useRef, useState } from "react";
import { translateChunk } from "@/lib/subtitle-translate";

type SpeechRecognitionLike = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  start(): void;
  stop(): void;
  abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<
    { isFinal: boolean; 0: { transcript: string } }
  > }) => void) | null;
  onerror: ((e: { error?: string }) => void) | null;
  onend: (() => void) | null;
};

type SpeechCtor = new () => SpeechRecognitionLike;

function getRecognition(): SpeechCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as Record<string, unknown>;
  return (w["SpeechRecognition"] || w["webkitSpeechRecognition"] || null) as SpeechCtor | null;
}

export function liveListenSupported() {
  return Boolean(getRecognition());
}

/**
 * Starts/stops live listening. `sourceLang` "auto" keeps the recogniser on the
 * browser locale; a concrete BCP-47 tag (en-US, ar-SA, tr-TR…) is more accurate.
 */
export function useLiveTranslate(sourceLang = "auto", target = "fa") {
  const [active, setActive] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState("");
  const recRef = useRef<SpeechRecognitionLike | null>(null);
  const stoppedRef = useRef(true);

  const stop = useCallback(() => {
    stoppedRef.current = true;
    setActive(false);
    setCaption("");
    try {
      recRef.current?.abort();
    } catch {
      /* already stopped */
    }
    recRef.current = null;
  }, []);

  const start = useCallback(() => {
    const Ctor = getRecognition();
    if (!Ctor) {
      setError("تشخیص گفتار در این نسخه پشتیبانی نمی‌شود.");
      return;
    }
    setError("");
    const rec = new Ctor();
    rec.lang = sourceLang === "auto" ? navigator.language || "en-US" : sourceLang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i += 1) {
        const r = e.results[i];
        if (!r) continue;
        const text = r[0].transcript.trim();
        if (!text) continue;
        if (!r.isFinal) {
          setCaption(text);
          continue;
        }
        void translateChunk(text, target)
          .then((res: { text: string }) => setCaption(res.text || text))
          .catch(() => setCaption(text));
      }
    };
    rec.onerror = (e) => {
      if (e?.error === "not-allowed") setError("دسترسی به میکروفون/صدا داده نشد.");
    };
    rec.onend = () => {
      // Chromium stops after a silence window; keep listening while enabled.
      if (stoppedRef.current) return;
      try {
        rec.start();
      } catch {
        /* restart race */
      }
    };
    stoppedRef.current = false;
    try {
      rec.start();
      recRef.current = rec;
      setActive(true);
    } catch {
      setError("شروع شنیدن صدا ممکن نشد.");
    }
  }, [sourceLang, target]);

  useEffect(() => () => stop(), [stop]);

  return { active, caption, error, start, stop, supported: liveListenSupported() };
}
