// Performance profile for weak machines (old Windows PCs, low-RAM Android
// phones, Hisense TV browsers). Everything expensive in the UI reads from here:
// polling intervals, buffer sizes, blur/animation effects.

import { useEffect, useState } from "react";

export type PerfMode = "auto" | "low" | "high";

const KEY = "ums.perf";

export function readPerfMode(): PerfMode {
  if (typeof localStorage === "undefined") return "auto";
  const v = localStorage.getItem(KEY);
  return v === "low" || v === "high" ? v : "auto";
}

export function writePerfMode(mode: PerfMode) {
  try {
    localStorage.setItem(KEY, mode);
  } catch {
    /* private mode */
  }
  applyPerfClass();
}

/** True when the current device should run in the lightweight profile. */
export function isLowPower(): boolean {
  const mode = readPerfMode();
  if (mode === "low") return true;
  if (mode === "high") return false;
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { deviceMemory?: number };
  const mem = Number(nav.deviceMemory || 0);
  const cores = Number(nav.hardwareConcurrency || 0);
  const mobile = /android|iphone|ipad|smarttv|hisense|vidaa|tizen|webos/i.test(nav.userAgent || "");
  if (mem && mem <= 3) return true;
  if (cores && cores <= 4) return true;
  return mobile && (!cores || cores <= 6);
}

/**
 * Adds `.perf-low` to <html>; the stylesheet uses it to drop backdrop blur,
 * shadows and animations, which are the main cause of dropped frames on weak
 * GPUs and of audio/video drift on TV browsers.
 */
export function applyPerfClass() {
  if (typeof document === "undefined") return;
  document.documentElement.classList.toggle("perf-low", isLowPower());
}

/** Scales a polling interval: weak devices poll a third as often. */
export function pollInterval(ms: number) {
  return isLowPower() ? Math.round(ms * 3) : ms;
}

/** hls.js tuning: small buffers on weak devices, generous ones otherwise. */
export function hlsConfig() {
  const low = isLowPower();
  return {
    enableWorker: true,
    lowLatencyMode: !low,
    backBufferLength: low ? 10 : 60,
    maxBufferLength: low ? 12 : 30,
    maxMaxBufferLength: low ? 30 : 120,
    maxBufferSize: (low ? 20 : 60) * 1000 * 1000,
    liveSyncDurationCount: low ? 4 : 3,
    fragLoadingMaxRetry: 6,
    manifestLoadingMaxRetry: 4,
    capLevelToPlayerSize: true,
    startLevel: low ? 0 : -1,
    testBandwidth: !low,
  };
}

export function usePerfMode() {
  const [mode, setMode] = useState<PerfMode>("auto");
  const [low, setLow] = useState(false);
  useEffect(() => {
    setMode(readPerfMode());
    setLow(isLowPower());
    applyPerfClass();
  }, []);
  const update = (next: PerfMode) => {
    writePerfMode(next);
    setMode(next);
    setLow(isLowPower());
  };
  return { mode, low, setMode: update };
}
