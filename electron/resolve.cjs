// Turns a share / page URL (Aparat, YouTube page, generic HTML) into a direct
// playable media URL. TVs only accept real media streams: when we hand them an
// HTML page they answer "format not supported", so every remote source goes
// through here first. Pure Node http/https, no dependencies.

const http = require("node:http");
const https = require("node:https");
const { URL } = require("node:url");

const DIRECT = /\.(mp4|m4v|mkv|webm|mov|avi|ts|m3u8|mpd|mp3|aac|flac|wav)(\?|#|$)/i;

/** Cache: page URL -> { url, mime, at } */
const cache = new Map();
const TTL = 10 * 60 * 1000;

function isDirect(url) {
  return DIRECT.test(String(url).split("#")[0]);
}

function fetchText(source, redirects = 0) {
  return new Promise((resolve) => {
    let target;
    try {
      target = new URL(source);
    } catch {
      return resolve({ body: "", finalUrl: source, type: "" });
    }
    const client = target.protocol === "https:" ? https : http;
    const req = client.get(
      target,
      {
        timeout: 12000,
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
          Accept: "*/*",
          "Accept-Language": "fa,en;q=0.8",
        },
      },
      (up) => {
        const loc = up.headers.location;
        if (up.statusCode && up.statusCode >= 300 && up.statusCode < 400 && loc && redirects < 5) {
          up.resume();
          return resolve(fetchText(new URL(loc, target).toString(), redirects + 1));
        }
        const type = String(up.headers["content-type"] || "");
        if (!/text|json|xml|mpegurl/i.test(type)) {
          up.destroy();
          return resolve({ body: "", finalUrl: target.toString(), type });
        }
        let body = "";
        up.setEncoding("utf8");
        up.on("data", (c) => {
          body += c;
          if (body.length > 3_000_000) up.destroy();
        });
        up.on("end", () => resolve({ body, finalUrl: target.toString(), type }));
        up.on("close", () => resolve({ body, finalUrl: target.toString(), type }));
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve({ body: "", finalUrl: source, type: "" });
    });
    req.on("error", () => resolve({ body: "", finalUrl: source, type: "" }));
  });
}

function unescapeUrl(u) {
  return String(u)
    .replace(/\\\//g, "/")
    .replace(/\\u002F/gi, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

function pickFromHtml(html, base) {
  const patterns = [
    // Aparat / Namasha player config
    /"file"\s*:\s*"([^"]+?\.(?:mp4|m3u8)[^"]*)"/i,
    /"src"\s*:\s*"([^"]+?\.(?:mp4|m3u8)[^"]*)"/i,
    /"url"\s*:\s*"([^"]+?\.(?:mp4|m3u8)[^"]*)"/i,
    /<source[^>]+src=["']([^"']+?\.(?:mp4|m3u8)[^"']*)["']/i,
    /<video[^>]+src=["']([^"']+?\.(?:mp4|m3u8)[^"']*)["']/i,
    /property=["']og:video(?::url|:secure_url)?["'][^>]+content=["']([^"']+)["']/i,
    /content=["']([^"']+?\.(?:mp4|m3u8)[^"']*)["'][^>]*property=["']og:video/i,
    /(https?:[^\s"'<>\\]+?\.m3u8[^\s"'<>\\]*)/i,
    /(https?:[^\s"'<>\\]+?\.mp4[^\s"'<>\\]*)/i,
  ];
  for (const re of patterns) {
    const m = re.exec(html);
    if (m && m[1]) {
      const raw = unescapeUrl(m[1]);
      try {
        return new URL(raw, base).toString();
      } catch {
        /* keep looking */
      }
    }
  }
  return "";
}

function mimeForUrl(url) {
  const u = String(url).toLowerCase();
  if (u.includes(".m3u8")) return "application/vnd.apple.mpegurl";
  if (u.includes(".mpd")) return "application/dash+xml";
  if (u.includes(".mkv")) return "video/x-matroska";
  if (u.includes(".webm")) return "video/webm";
  if (u.includes(".ts")) return "video/mp2t";
  if (u.includes(".mp3")) return "audio/mpeg";
  return "video/mp4";
}

// ---------------------------------------------------------------------------
// YouTube
// ---------------------------------------------------------------------------
// The watch page only carries ciphered stream URLs, so scraping HTML yields
// nothing playable. The InnerTube "ANDROID" client returns plain URLs plus an
// HLS manifest for live streams, which is exactly what a TV can play.

const YT_ID =
  /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/)|youtu\.be\/)([\w-]{11})/i;

function isYouTube(url) {
  return /(^|\.)(youtube\.com|youtu\.be|youtube-nocookie\.com)$/i.test(safeHost(url));
}

function safeHost(url) {
  try {
    return new URL(url).hostname;
  } catch {
    return "";
  }
}

function postJson(target, payload) {
  return new Promise((resolve) => {
    let parsed;
    try {
      parsed = new URL(target);
    } catch {
      return resolve(null);
    }
    const data = Buffer.from(JSON.stringify(payload));
    const req = https.request(
      parsed,
      {
        method: "POST",
        timeout: 12000,
        headers: {
          "Content-Type": "application/json",
          "Content-Length": data.length,
          "User-Agent": "com.google.android.youtube/19.09.37 (Linux; U; Android 13) gzip",
          "Accept-Language": "en-US,en;q=0.9",
        },
      },
      (up) => {
        let body = "";
        up.setEncoding("utf8");
        up.on("data", (c) => {
          body += c;
          if (body.length > 8_000_000) up.destroy();
        });
        up.on("end", () => {
          try {
            resolve(JSON.parse(body));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
    req.on("error", () => resolve(null));
    req.end(data);
  });
}

const YT_CLIENTS = [
  { clientName: "ANDROID", clientVersion: "19.09.37", androidSdkVersion: 33, hl: "en", gl: "US" },
  {
    clientName: "IOS",
    clientVersion: "19.29.1",
    deviceMake: "Apple",
    deviceModel: "iPhone16,2",
    osName: "iPhone",
    osVersion: "17.5.1.21F90",
    hl: "en",
    gl: "US",
  },
  { clientName: "MWEB", clientVersion: "2.20240726.01.00", hl: "en", gl: "US" },
  { clientName: "WEB", clientVersion: "2.20240726.00.00", hl: "en", gl: "US" },
];

function pickYouTubeStream(streaming) {
  if (!streaming) return null;
  // Live / premiere: HLS is the most TV-friendly option.
  if (streaming.hlsManifestUrl) {
    return { url: String(streaming.hlsManifestUrl), mime: "application/vnd.apple.mpegurl" };
  }
  // Progressive (muxed audio+video) MP4 only — adaptive tracks are video-only
  // and would play without sound on the TV.
  const progressive = (streaming.formats || [])
    .filter((f) => f && f.url && /video\/mp4/i.test(String(f.mimeType || "")))
    .sort((a, b) => (b.height || b.bitrate || 0) - (a.height || a.bitrate || 0));
  const best = progressive[0];
  return best ? { url: String(best.url), mime: "video/mp4" } : null;
}

async function resolveYouTube(src) {
  const id = YT_ID.exec(src)?.[1];
  if (!id) return null;

  // Try the mobile/app InnerTube clients first: they answer with plain URLs.
  for (const client of YT_CLIENTS) {
    const json = await postJson("https://www.youtube.com/youtubei/v1/player", {
      videoId: id,
      contentCheckOk: true,
      racyCheckOk: true,
      context: { client },
    });
    const found = pickYouTubeStream(json?.streamingData);
    if (found) return found;
  }

  // Fallback: the watch page sometimes embeds an unciphered HLS manifest
  // (live streams) or a progressive URL inside ytInitialPlayerResponse.
  const { body } = await fetchText(`https://www.youtube.com/watch?v=${id}&hl=en`);
  if (body) {
    const hls = /"hlsManifestUrl":"([^"]+)"/.exec(body);
    if (hls?.[1]) {
      return { url: unescapeUrl(hls[1]), mime: "application/vnd.apple.mpegurl" };
    }
    const embedded = /"itag":(?:18|22),"url":"([^"]+)"/.exec(body);
    if (embedded?.[1]) return { url: unescapeUrl(embedded[1]), mime: "video/mp4" };
  }
  return null;
}

/**
 * @returns {Promise<{ url: string, mime: string, resolved: boolean, error?: string }>}
 */
async function resolveMedia(source) {
  const src = String(source || "");
  if (!/^https?:\/\//i.test(src)) return { url: src, mime: mimeForUrl(src), resolved: false };
  if (isDirect(src)) return { url: src, mime: mimeForUrl(src), resolved: false };

  const hit = cache.get(src);
  if (hit && Date.now() - hit.at < TTL) return { ...hit.value, resolved: true };

  if (isYouTube(src)) {
    const yt = await resolveYouTube(src);
    if (yt) {
      cache.set(src, { at: Date.now(), value: yt });
      return { ...yt, resolved: true };
    }
    return {
      url: src,
      mime: "video/mp4",
      resolved: false,
      error: "این ویدیوی یوتیوب لینک پخش مستقیم نمی‌دهد (محدودیت سن/منطقه یا حذف‌شده)",
    };
  }

  const { body, finalUrl } = await fetchText(src);
  if (!body) {
    // Not HTML (already a stream with an odd extension) — hand it through.
    return { url: finalUrl || src, mime: mimeForUrl(finalUrl || src), resolved: false };
  }
  const direct = pickFromHtml(body, finalUrl || src);
  if (!direct) {
    return {
      url: src,
      mime: mimeForUrl(src),
      resolved: false,
      error: "لینک مستقیم ویدیو در این صفحه پیدا نشد",
    };
  }
  const value = { url: direct, mime: mimeForUrl(direct) };
  cache.set(src, { at: Date.now(), value });
  return { ...value, resolved: true };
}

module.exports = { resolveMedia, isDirect, mimeForUrl, fetchText, isYouTube };
