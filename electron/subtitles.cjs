// Subtitle helpers: reads .srt/.vtt/.ass files (local or remote) and serves them
// in the format each renderer understands.
// - DLNA TVs (Hisense, Samsung, LG) load external SRT via the sec:CaptionInfo
//   DIDL element + the CaptionInfo.sec HTTP header.
// - Chromecast only accepts WebVTT, so SRT is converted on the fly.

const fs = require("node:fs");
const path = require("node:path");

const SUB_EXT = [".srt", ".vtt", ".ass", ".ssa", ".sub"];

function isSubtitleFile(file) {
  return SUB_EXT.includes(path.extname(String(file)).toLowerCase());
}

function subtitleMime(file) {
  const ext = path.extname(String(file).split("?")[0]).toLowerCase();
  if (ext === ".vtt") return "text/vtt";
  if (ext === ".ass" || ext === ".ssa") return "text/x-ssa";
  return "application/x-subrip";
}

/** Converts SubRip / SubStation timing to WebVTT (idempotent for real VTT). */
function toVtt(text) {
  const raw = String(text || "").replace(/^\uFEFF/, "");
  if (/^\s*WEBVTT/i.test(raw)) return raw;

  if (/^\s*\[Script Info\]/i.test(raw)) {
    const cues = [];
    for (const line of raw.split(/\r?\n/)) {
      const m = /^Dialogue:\s*[^,]*,([^,]+),([^,]+),(?:[^,]*,){6}(.*)$/i.exec(line);
      if (!m) continue;
      const fix = (t) => {
        const [h, mm, rest] = t.trim().split(":");
        const [s, cs = "0"] = rest.split(".");
        return `${String(h).padStart(2, "0")}:${mm}:${String(s).padStart(2, "0")}.${cs.padEnd(3, "0")}`;
      };
      const body = m[3]
        .replace(/\{[^}]*\}/g, "")
        .replace(/\\N/gi, "\n")
        .trim();
      if (body) cues.push(`${fix(m[1])} --> ${fix(m[2])}\n${body}`);
    }
    return `WEBVTT\n\n${cues.join("\n\n")}\n`;
  }

  const body = raw
    .replace(/\r\n/g, "\n")
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, "$1.$2")
    .replace(/^\d+\s*$/gm, "");
  return `WEBVTT\n\n${body.replace(/\n{3,}/g, "\n\n").trim()}\n`;
}

function readLocal(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

/** "00:12:34" ⇄ seconds, used by the seek bar on both protocols. */
function timeToSeconds(value) {
  const parts = String(value || "")
    .trim()
    .split(":")
    .map((n) => Number(n) || 0);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function secondsToTime(total) {
  const s = Math.max(0, Math.floor(Number(total) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return [h, m, sec].map((n) => String(n).padStart(2, "0")).join(":");
}

module.exports = {
  isSubtitleFile,
  subtitleMime,
  toVtt,
  readLocal,
  timeToSeconds,
  secondsToTime,
  SUB_EXT,
};
