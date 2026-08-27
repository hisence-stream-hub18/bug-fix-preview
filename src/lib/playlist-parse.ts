// Browser/Android port of electron/m3u.cjs: turns an M3U/M3U8 text into a list
// of channels (IPTV #EXTINF entries or HLS master #EXT-X-STREAM-INF variants).

import type { PlaylistChannel, PlaylistResult } from "./ums-bridge";

function attr(line: string, name: string): string {
  const m = new RegExp(`${name}="([^"]*)"`, "i").exec(line);
  return m?.[1] ?? "";
}

function absolute(url: string, base: string) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

export function parsePlaylist(text: string, base: string): PlaylistResult {
  const lines = String(text || "")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (!lines.length) return { ok: false, kind: "", channels: [], error: "پلی‌لیست خالی است" };

  const channels: PlaylistChannel[] = [];
  type Meta = { title: string; group: string; logo: string; id: string };
  let meta: Meta | null = null;
  let index = 0;

  for (const line of lines) {
    if (/^#EXTINF/i.test(line)) {
      const title = line.split(",").slice(1).join(",").trim();
      meta = {
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
      meta = {
        title: `کیفیت ${res || (bw ? `${Math.round(Number(bw[1]) / 1000)}kbps` : "نامشخص")}`,
        group: "کیفیت‌های استریم",
        logo: "",
        id: "",
      };
      continue;
    }
    if (line.startsWith("#")) continue;

    const info = meta ?? {
      title: `مورد ${channels.length + 1}`,
      group: "",
      logo: "",
      id: "",
    };
    channels.push({
      key: `ch-${index++}`,
      title: info.title,
      group: info.group,
      logo: info.logo,
      tvgId: info.id,
      url: absolute(line, base),
    });
    meta = null;
  }

  return {
    ok: channels.length > 0,
    kind: /#EXT-X-STREAM-INF/i.test(text) ? "hls-master" : "iptv",
    channels,
    ...(channels.length ? {} : { error: "هیچ کانالی در این پلی‌لیست پیدا نشد" }),
  };
}
