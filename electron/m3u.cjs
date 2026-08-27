// VLC-style playlist reader: takes an M3U/M3U8 URL (or local file) and returns
// every channel/entry inside it. Handles IPTV #EXTINF playlists as well as HLS
// master playlists (#EXT-X-STREAM-INF variants).

const fs = require("node:fs");
const { fetchText } = require("./resolve.cjs");

function attr(line, name) {
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(line);
  return m ? m[1] : "";
}

function absolute(url, base) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

/** @returns {{ ok: boolean, kind: string, channels: any[], error?: string }} */
function parse(text, base) {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { ok: false, kind: "", channels: [], error: "پلی‌لیست خالی است" };

  const channels = [];
  let pending = null;
  let variant = null;
  let index = 0;

  for (const line of lines) {
    if (/^#EXTINF/i.test(line)) {
      // The display name is what follows the LAST comma that is outside quotes.
      // Attributes such as tvg-logo="…" or http-user-agent="Mozilla/5.0 (…)
      // like Gecko) Chrome/…" contain commas and parentheses themselves, so we
      // remove every key="value" pair before reading the title.
      const bare = line.replace(/\s+[\w.-]+="[^"]*"/g, "");
      const title = bare.slice(bare.indexOf(",") + 1).trim();
      pending = {
        title: title || `کانال ${channels.length + 1}`,
        group: attr(line, "group-title"),
        logo: attr(line, "tvg-logo"),
        id: attr(line, "tvg-id"),
      };
      continue;
    }
    if (/^#EXT-X-STREAM-INF/i.test(line)) {
      const res = attr(line, "RESOLUTION");
      const bw = /BANDWIDTH=(\d+)/i.exec(line);
      variant = {
        title: `کیفیت ${res || (bw ? `${Math.round(Number(bw[1]) / 1000)}kbps` : "نامشخص")}`,
        group: "کیفیت‌های استریم",
        logo: "",
        id: "",
      };
      continue;
    }
    // #EXTVLCOPT / #EXTGRP / #KODIPROP are directives, never URLs.
    if (line.startsWith("#")) {
      if (/^#EXTGRP:/i.test(line) && pending) pending.group = line.slice(8).trim() || pending.group;
      continue;
    }
    if (!/^(https?|rtsp|rtmp|udp|rtp|file):/i.test(line) && !/^\//.test(line) && !/\.\w{2,5}($|\?)/.test(line)) {
      continue;
    }

    const meta = pending || variant || { title: `مورد ${channels.length + 1}`, group: "", logo: "", id: "" };
    channels.push({
      key: `ch-${index++}`,
      title: meta.title,
      group: meta.group || "",
      logo: meta.logo || "",
      tvgId: meta.id || "",
      url: absolute(line, base),
    });
    pending = null;
    variant = null;
  }

  return {
    ok: channels.length > 0,
    kind: /#EXT-X-STREAM-INF/i.test(text) ? "hls-master" : "iptv",
    channels,
    ...(channels.length ? {} : { error: "هیچ کانالی در این پلی‌لیست پیدا نشد" }),
  };
}

/** Loads a playlist from a remote URL or a local path and parses it. */
async function load(source) {
  const src = String(source || "").trim();
  if (!src) return { ok: false, kind: "", channels: [], error: "آدرس پلی‌لیست خالی است" };
  if (/^https?:\/\//i.test(src)) {
    const { body, finalUrl } = await fetchText(src);
    if (!body) return { ok: false, kind: "", channels: [], error: "پلی‌لیست دریافت نشد" };
    if (!/#EXTM3U|#EXTINF|#EXT-X/i.test(body) && !/\.(m3u8?|ts|mp4)/i.test(body)) {
      return { ok: false, kind: "", channels: [], error: "این آدرس یک پلی‌لیست M3U نیست" };
    }
    return parse(body, finalUrl || src);
  }
  try {
    return parse(fs.readFileSync(src, "utf8"), src);
  } catch {
    return { ok: false, kind: "", channels: [], error: "فایل پلی‌لیست خوانده نشد" };
  }
}

module.exports = { load, parse };
