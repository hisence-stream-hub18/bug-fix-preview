// Audio/video synchronisation for the built-in player.
//
// Weak TVs and weak PCs decode audio faster than video, so the sound runs ahead
// of the picture (the Hisense problem). Two directions are handled:
//
//   offset > 0  → the picture is late  → the audio is delayed through a WebAudio
//                 DelayNode (cheap, sample-accurate, no re-decode)
//   offset < 0  → the sound is late    → the picture is delayed by a small frame
//                 queue drawn on a canvas (only enabled while a negative offset
//                 is selected, because it costs GPU time)
//
// The offset is persisted so a device keeps its calibration between sessions.

const KEY = "ums.avOffsetMs";
export const AV_OFFSET_LIMIT = 3000;

// ---------------------------------------------------------------------------
// TV delay compensation
// A TV buffers the incoming stream and there is no way to remove that buffer.
// The only way to see both pictures at the same moment is to hold the in-app
// preview back by the same amount, so the app plays this many ms behind live.
// ---------------------------------------------------------------------------
const PREVIEW_KEY = "ums.previewDelayMs";
export const PREVIEW_DELAY_LIMIT = 8000;

export function readPreviewDelay(): number {
  if (typeof localStorage === "undefined") return 0;
  const v = Number(localStorage.getItem(PREVIEW_KEY) || 0);
  return Number.isFinite(v) ? Math.max(0, Math.min(PREVIEW_DELAY_LIMIT, v)) : 0;
}

export function writePreviewDelay(ms: number) {
  try {
    localStorage.setItem(PREVIEW_KEY, String(Math.max(0, Math.round(ms))));
  } catch {
    /* private mode */
  }
}

export function readAvOffset(): number {
  if (typeof localStorage === "undefined") return 0;
  const v = Number(localStorage.getItem(KEY) || 0);
  return Number.isFinite(v) ? Math.max(-AV_OFFSET_LIMIT, Math.min(AV_OFFSET_LIMIT, v)) : 0;
}

export function writeAvOffset(ms: number) {
  try {
    localStorage.setItem(KEY, String(Math.round(ms)));
  } catch {
    /* ignore */
  }
}

type AudioChain = {
  ctx: AudioContext;
  delay: DelayNode;
};

const chains = new WeakMap<HTMLMediaElement, AudioChain>();

/** Routes the element's audio through a DelayNode (created once per element). */
export function ensureAudioChain(video: HTMLMediaElement): AudioChain | null {
  const existing = chains.get(video);
  if (existing) return existing;
  const Ctor =
    typeof window !== "undefined"
      ? window.AudioContext ||
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      : undefined;
  if (!Ctor) return null;
  try {
    const ctx = new Ctor();
    const source = ctx.createMediaElementSource(video);
    const delay = ctx.createDelay(AV_OFFSET_LIMIT / 1000 + 0.5);
    delay.delayTime.value = 0;
    source.connect(delay);
    delay.connect(ctx.destination);
    const chain = { ctx, delay };
    chains.set(video, chain);
    return chain;
  } catch {
    // Cross-origin media without CORS headers cannot enter WebAudio.
    return null;
  }
}

/** Applies a positive (audio-delay) offset in milliseconds. */
export function applyAudioDelay(video: HTMLMediaElement, ms: number) {
  if (ms <= 0) {
    const chain = chains.get(video);
    if (chain) chain.delay.delayTime.value = 0;
    return true;
  }
  const chain = ensureAudioChain(video);
  if (!chain) return false;
  void chain.ctx.resume().catch(() => {});
  chain.delay.delayTime.value = Math.min(AV_OFFSET_LIMIT, ms) / 1000;
  return true;
}

export type VideoDelayHandle = { stop: () => void; setDelay: (ms: number) => void };

/**
 * Delays the picture by `ms` using a bounded frame queue on a canvas.
 * Frames are captured with requestVideoFrameCallback when available (no polling
 * loop on weak devices) and drawn once they are old enough.
 */
export function startVideoDelay(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
  ms: number,
): VideoDelayHandle {
  const ctx = canvas.getContext("2d", { alpha: false });
  let delayMs = Math.max(0, ms);
  let stopped = false;
  const queue: { at: number; bitmap: ImageBitmap }[] = [];

  const flush = () => {
    if (!ctx) return;
    const now = performance.now();
    while (queue.length && now - queue[0]!.at >= delayMs) {
      const frame = queue.shift()!;
      if (canvas.width !== frame.bitmap.width || canvas.height !== frame.bitmap.height) {
        canvas.width = frame.bitmap.width;
        canvas.height = frame.bitmap.height;
      }
      ctx.drawImage(frame.bitmap, 0, 0);
      frame.bitmap.close();
    }
    // Never grow without bound (a stalled tab would eat all the memory).
    while (queue.length > 90) queue.shift()!.bitmap.close();
  };

  const capture = async () => {
    if (stopped || video.paused || video.ended) return;
    try {
      const bitmap = await createImageBitmap(video);
      if (stopped) {
        bitmap.close();
        return;
      }
      queue.push({ at: performance.now(), bitmap });
    } catch {
      /* frame skipped */
    }
    flush();
  };

  const rvfc = (
    video as HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number }
  ).requestVideoFrameCallback?.bind(video);

  let timer = 0;
  const loop = () => {
    if (stopped) return;
    void capture();
    if (rvfc) rvfc(loop);
  };
  if (rvfc) rvfc(loop);
  else timer = window.setInterval(loop, 40);

  const drain = window.setInterval(flush, 25);

  return {
    setDelay: (next: number) => {
      delayMs = Math.max(0, next);
    },
    stop: () => {
      stopped = true;
      if (timer) window.clearInterval(timer);
      window.clearInterval(drain);
      queue.splice(0).forEach((f) => f.bitmap.close());
    },
  };
}
