// Online subtitle translator: takes any SRT / VTT / ASS subtitle (or a plain
// text track), auto-detects its language and translates it to Persian (fa).
//
// The network call goes through the Electron main process when available
// (no CORS, works behind the packaged app) and falls back to a direct fetch on
// Android / web. Results are cached in memory + localStorage so a re-opened
// movie never pays for the same translation twice.

import { getUms } from "./ums-bridge";

export type Cue = { start: number; end: number; text: string };

export type TranslationResult = {
  vttUrl: string;
  detected: string;
  cues: number;
};

// ------------------------------------------------------------------ parsing

const clock = (v: string) => {
  const m = /(\d+):(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(v.trim());
  if (m) {
    const ms = Number(String(m[4] ?? "0").padEnd(3, "0")) / 1000;
    return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + ms;
  }
  const s = /(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(v.trim());
  if (!s) return 0;
  return Number(s[1]) * 60 + Number(s[2]) + Number(String(s[3] ?? "0").padEnd(3, "0")) / 1000;
};

const stripTags = (t: string) =>
  t
    .replace(/\{\\[^}]*\}/g, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\\N/gi, "\n")
    .trim();

/** Parses SRT, WebVTT and ASS/SSA into a common cue list. */
export function parseSubtitle(raw: string): Cue[] {
  const text = raw.replace(/\r/g, "").replace(/^\uFEFF/, "");

  if (/^\s*\[Script Info\]/i.test(text) || /^\s*Dialogue:/m.test(text)) {
    const cues: Cue[] = [];
    for (const line of text.split("\n")) {
      const m = /^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/i.exec(line);
      if (!m) continue;
      const body = stripTags(m[3] ?? "");
      if (body) cues.push({ start: clock(m[1] ?? ""), end: clock(m[2] ?? ""), text: body });
    }
    return cues;
  }

  const cues: Cue[] = [];
  for (const block of text.split(/\n{2,}/)) {
    const lines = block.split("\n").filter((l) => l.trim() && !/^WEBVTT/i.test(l));
    const idx = lines.findIndex((l) => l.includes("-->"));
    if (idx < 0) continue;
    const [from, to] = String(lines[idx] ?? "").split("-->");
    const body = stripTags(lines.slice(idx + 1).join("\n"));
    if (body) cues.push({ start: clock(from ?? ""), end: clock(to ?? ""), text: body });
  }
  return cues;
}

const stamp = (s: number) => {
  const t = Math.max(0, s);
  const h = String(Math.floor(t / 3600)).padStart(2, "0");
  const m = String(Math.floor((t % 3600) / 60)).padStart(2, "0");
  const sec = String(Math.floor(t % 60)).padStart(2, "0");
  const ms = String(Math.round((t % 1) * 1000)).padStart(3, "0");
  return `${h}:${m}:${sec}.${ms}`;
};

/** Serialises cues back to WebVTT (the only format <track> understands). */
export function toVtt(cues: Cue[], offsetMs = 0): string {
  const off = offsetMs / 1000;
  const body = cues
    .map((c) => `${stamp(c.start + off)} --> ${stamp(c.end + off)}\n${c.text}`)
    .join("\n\n");
  return `WEBVTT\n\n${body}\n`;
}

// -------------------------------------------------------------- translation

const SEP = "\n@@@\n";
const memory = new Map<string, { text: string; detected: string }>();

function cacheKey(text: string, target: string) {
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0;
  return `ums.tr.${target}.${text.length}.${h}`;
}

async function requestTranslate(text: string, target: string, source = "auto") {
  const api = getUms() as unknown as {
    translate?: (p: { text: string; target: string; source?: string }) => Promise<{
      ok: boolean;
      text?: string;
      detected?: string;
      error?: string;
    }>;
  } | null;

  if (api?.translate) {
    const res = await api.translate({ text, target, source });
    if (res?.ok && res.text) return { text: res.text, detected: res.detected || "auto" };
    throw new Error(res?.error || "translate failed");
  }

  const url =
    "https://translate.googleapis.com/translate_a/single?client=gtx&dt=t&sl=" +
    encodeURIComponent(source || "auto") +
    "&tl=" +
    encodeURIComponent(target) +
    "&q=" +
    encodeURIComponent(text);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = (await res.json()) as [Array<[string, string]>, unknown, string];
  const out = (data[0] || []).map((p) => p[0]).join("");
  return { text: out, detected: String(data[2] || "auto") };
}

/** Translates one chunk of text with cache + one retry. */
export async function translateChunk(text: string, target: string, source = "auto") {
  const key = cacheKey(text, `${target}.${source}`);
  const hit = memory.get(key);
  if (hit) return hit;
  try {
    const stored = typeof localStorage !== "undefined" ? localStorage.getItem(key) : null;
    if (stored) {
      const parsed = JSON.parse(stored) as { text: string; detected: string };
      memory.set(key, parsed);
      return parsed;
    }
  } catch {
    /* ignore */
  }

  let last: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const value = await requestTranslate(text, target, source);
      memory.set(key, value);
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {
        /* quota */
      }
      return value;
    } catch (err) {
      last = err;
      await new Promise((r) => setTimeout(r, 600 * (attempt + 1)));
    }
  }
  throw last instanceof Error ? last : new Error("translate failed");
}

/**
 * Translates a whole cue list. Cues are batched (≈1200 chars per request) so a
 * two-hour movie needs a few dozen requests instead of thousands — this is what
 * keeps it usable on a slow mobile connection.
 */
export async function translateCues(
  cues: Cue[],
  target = "fa",
  onProgress?: (done: number, total: number) => void,
  source = "auto",
): Promise<{ cues: Cue[]; detected: string }> {
  const batches: Cue[][] = [];
  let current: Cue[] = [];
  let size = 0;
  for (const cue of cues) {
    current.push(cue);
    size += cue.text.length + SEP.length;
    if (size > 1200) {
      batches.push(current);
      current = [];
      size = 0;
    }
  }
  if (current.length) batches.push(current);

  const out: Cue[] = [];
  let detected = "auto";
  let done = 0;
  for (const batch of batches) {
    const joined = batch.map((c) => c.text.replace(/\n/g, " ")).join(SEP);
    let parts: string[] = [];
    try {
      const res = await translateChunk(joined, target, source);
      if (detected === "auto") detected = res.detected;
      parts = res.text.split(/\n?@@@\n?/);
    } catch {
      parts = [];
    }
    batch.forEach((cue, i) => {
      out.push({ ...cue, text: (parts[i] || cue.text).trim() });
    });
    done += batch.length;
    onProgress?.(done, cues.length);
  }
  return { cues: out, detected };
}

/** Fetches a subtitle URL, translates it and returns a blob URL of Persian VTT. */
export async function translateSubtitleUrl(
  url: string,
  target = "fa",
  onProgress?: (done: number, total: number) => void,
): Promise<TranslationResult> {
  const res = await fetch(url);
  if (!res.ok) throw new Error("زیرنویس دریافت نشد");
  const raw = await res.text();
  const cues = parseSubtitle(raw);
  if (!cues.length) throw new Error("زیرنویس قابل خواندن نبود");
  const translated = await translateCues(cues, target, onProgress);
  const blob = new Blob([toVtt(translated.cues)], { type: "text/vtt" });
  return { vttUrl: URL.createObjectURL(blob), detected: translated.detected, cues: cues.length };
}

export const LANGUAGE_LABEL: Record<string, string> = {
  auto: "تشخیص خودکار",
  en: "انگلیسی",
  ar: "عربی",
  tr: "ترکی",
  fr: "فرانسوی",
  de: "آلمانی",
  es: "اسپانیایی",
  ru: "روسی",
  hi: "هندی",
  ur: "اردو",
  ko: "کره‌ای",
  ja: "ژاپنی",
  zh: "چینی",
  fa: "فارسی",
};
