import { useCallback, useEffect, useState } from "react";

export type MediaKind = "youtube" | "hls" | "http" | "rtsp" | "iptv";

export type MediaItem = {
  id: string;
  title: string;
  url: string;
  kind: MediaKind;
  note?: string;
  addedAt: number;
  lastPlayedAt?: number;
  /** Sidecar subtitle file (.srt/.vtt/.ass) chosen by the user. */
  subtitle?: string;
  subtitleName?: string;
};

export type DeviceStatus = "online" | "offline" | "playing";

export type TvDevice = {
  id: string;
  name: string;
  /** User-chosen label, used everywhere instead of the raw SSDP name. */
  customName?: string;
  model?: string;
  manufacturer?: string;
  ip: string;
  status: DeviceStatus;
  protocol: "DLNA" | "UPnP" | "Cast";
  /** Cast devices are addressed by ip:port (castv2), not by a SOAP control URL. */
  port?: number;
  nowPlaying?: string;
  /** UPnP AVTransport control URL — filled by the real SSDP scan. */
  avTransportUrl?: string;
  renderingControlUrl?: string;
  location?: string;
};

/** Display name of a TV: the user's own label wins over the discovered one. */
export function deviceLabel(device: Pick<TvDevice, "name" | "customName">) {
  return (device.customName || "").trim() || device.name;
}

export type ServerSettings = {
  port: number;
  networkIp: string;
  dlnaEnabled: boolean;
  upnpEnabled: boolean;
  serverName: string;
  transcodeHls: boolean;
  /** Audio/video offset (ms) applied to streams remuxed for the TV. */
  avOffsetMs: number;
  /** Performance profile for weak PCs/phones. */
  perfMode: "auto" | "low" | "high";
  /** Manual capture rate for screen sharing (0 = automatic, else 15..60). */
  captureFps: number;
  /** Manual video bitrate in kbps (0 = automatic). */
  captureKbps: number;
  /** Fixed keyframe interval in frames (0 = automatic, 8/15 = short chain). */
  gopFrames: number;
  /** Output chunk length in ms (500–1000 keeps the TV buffer short). */
  segmentMs: number;
  /** Re-read the on-TV text panel once per second instead of every frame. */
  lightPanel: boolean;
  /** Hold the in-app preview back by the TV latency (delay compensation). */
  previewDelayMs: number;
  /** Show the logo splash on the TV whenever the picture is not there yet. */
  tvSplash: boolean;
};

export const KIND_LABEL: Record<MediaKind, string> = {
  youtube: "یوتیوب",
  hls: "‏M3U8 / HLS",
  http: "ویدیو HTTP",
  rtsp: "‏RTSP",
  iptv: "پلی‌لیست IPTV",
};

export const defaultSettings: ServerSettings = {
  port: 5001,
  networkIp: "",
  dlnaEnabled: true,
  upnpEnabled: true,
  serverName: "Universal Media Server",
  transcodeHls: true,
  avOffsetMs: 0,
  perfMode: "auto",
  captureFps: 0,
  captureKbps: 0,
  gopFrames: 0,
  segmentMs: 1000,
  lightPanel: false,
  previewDelayMs: 0,
  tvSplash: true,
};

// No fabricated devices: the list is filled by the real SSDP scan on the
// desktop app (electron/ssdp.cjs).
export const defaultDevices: TvDevice[] = [];

export function detectKind(url: string): MediaKind {
  const u = url.trim().toLowerCase();
  if (u.includes("youtube.com") || u.includes("youtu.be")) return "youtube";
  if (u.startsWith("rtsp://")) return "rtsp";
  if (u.endsWith(".m3u") || u.includes("get.php") || u.includes("/iptv")) return "iptv";
  if (u.includes(".m3u8")) return "hls";
  return "http";
}

export function streamUrl(item: MediaItem, settings: ServerSettings) {
  return `http://${settings.networkIp}:${settings.port}/stream/${item.id}${
    item.kind === "youtube" || item.kind === "rtsp" ? "/index.m3u8" : ""
  }`;
}

function useLocal<T>(key: string, initial: T) {
  const [value, setValue] = useState<T>(initial);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(key);
      if (raw) setValue(JSON.parse(raw) as T);
    } catch {
      /* ignore */
    }
    setReady(true);
  }, [key]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setValue((prev) => {
        const resolved = typeof next === "function" ? (next as (p: T) => T)(prev) : next;
        try {
          window.localStorage.setItem(key, JSON.stringify(resolved));
        } catch {
          /* ignore */
        }
        return resolved;
      });
    },
    [key],
  );

  return [value, update, ready] as const;
}

export const usePlaylist = () => useLocal<MediaItem[]>("ums.playlist", []);
export const useDevices = () => useLocal<TvDevice[]>("ums.devices", defaultDevices);
export const useSettings = () => useLocal<ServerSettings>("ums.settings", defaultSettings);

export type Genre =
  | "action"
  | "drama"
  | "family"
  | "music"
  | "comedy"
  | "documentary"
  | "animation"
  | "series"
  | "other";

export const GENRE_LABEL: Record<Genre, string> = {
  action: "اکشن",
  drama: "درام",
  family: "خانوادگی",
  music: "موزیک ویدیو",
  comedy: "کمدی",
  documentary: "مستند",
  animation: "انیمیشن",
  series: "سریال",
  other: "متفرقه",
};

export const GENRES = Object.keys(GENRE_LABEL) as Genre[];

export type LibraryFile = {
  id: string;
  title: string;
  genre: Genre;
  source: string;
  sizeMb: number;
  addedAt: number;
  platform?: string;
  poster?: string;
  /** Sidecar subtitle file (.srt/.vtt/.ass) chosen by the user. */
  subtitle?: string;
  subtitleName?: string;
};

export type DownloadJob = {
  id: string;
  title: string;
  url: string;
  platform: string;
  genre: Genre;
  progress: number;
  status: "queued" | "downloading" | "done" | "error";
  createdAt: number;
};

export const SOCIAL_PLATFORMS = [
  "یوتیوب",
  "اینستاگرام",
  "تیک‌تاک",
  "فیسبوک",
  "توییتر / X",
  "تلگرام",
  "آپارات",
  "سایر",
] as const;

export function detectPlatform(url: string): string {
  const u = url.trim().toLowerCase();
  if (u.includes("youtu")) return "یوتیوب";
  if (u.includes("instagram")) return "اینستاگرام";
  if (u.includes("tiktok")) return "تیک‌تاک";
  if (u.includes("facebook") || u.includes("fb.watch")) return "فیسبوک";
  if (u.includes("twitter") || u.includes("x.com")) return "توییتر / X";
  if (u.includes("t.me") || u.includes("telegram")) return "تلگرام";
  if (u.includes("aparat")) return "آپارات";
  return "سایر";
}

export function libraryStreamUrl(file: LibraryFile, settings: ServerSettings) {
  return `http://${settings.networkIp}:${settings.port}/media/${file.id}.mp4`;
}

export const useLibrary = () => useLocal<LibraryFile[]>("ums.library", []);
export const useDownloads = () => useLocal<DownloadJob[]>("ums.downloads", []);

// ------------------------------------------------- مخزن استریم ماهواره/شبکه اجتماعی
export type StreamCategory =
  | "satellite"
  | "social"
  | "news"
  | "sport"
  | "music"
  | "movie"
  | "kids"
  | "religious"
  | "radio"
  | "other";

export const STREAM_CATEGORY_LABEL: Record<StreamCategory, string> = {
  satellite: "ماهواره‌ای",
  social: "شبکه اجتماعی",
  news: "خبری",
  sport: "ورزشی",
  music: "موسیقی",
  movie: "فیلم و سریال",
  kids: "کودک",
  religious: "مذهبی",
  radio: "رادیو",
  other: "متفرقه",
};

export const STREAM_CATEGORIES = Object.keys(STREAM_CATEGORY_LABEL) as StreamCategory[];

export type SavedStream = {
  id: string;
  title: string;
  url: string;
  category: StreamCategory;
  group?: string;
  logo?: string;
  kind: MediaKind;
  addedAt: number;
  lastPlayedAt?: number;
  /** Marked as a favourite channel by the user. */
  favorite?: boolean;
  /** Optional user folder inside the vault (manual organisation). */
  folder?: string;
};

export function guessStreamCategory(text: string): StreamCategory {
  const t = text.toLowerCase();
  if (/(youtu|instagram|tiktok|facebook|twitch|x\.com|t\.me|telegram|aparat)/.test(t))
    return "social";
  if (/(news|خبر|press|cnn|bbc|irinn)/.test(t)) return "news";
  if (/(sport|ورزش|varzesh|football)/.test(t)) return "sport";
  if (/(music|موسیقی|radio\s?javan|mtv)/.test(t)) return "music";
  if (/(movie|cinema|film|فیلم|سریال|series)/.test(t)) return "movie";
  if (/(kids|cartoon|کودک|انیمیشن|pooya)/.test(t)) return "kids";
  if (/(quran|قرآن|مذهب|islam|church)/.test(t)) return "religious";
  if (/(radio|رادیو)/.test(t)) return "radio";
  if (/(sat|ماهواره|hotbird|nilesat|yahsat|astra)/.test(t)) return "satellite";
  return "other";
}

/** پلی‌لیست خوانده‌شده تا در حالت آفلاین از بین نرود. */
export type ChannelCache = {
  source: string;
  kind: string;
  channels: {
    key: string;
    title: string;
    group: string;
    logo: string;
    tvgId?: string;
    url: string;
  }[];
  savedAt: number;
};

export const useStreamVault = () => useLocal<SavedStream[]>("ums.streams", []);
export const useChannelCache = () =>
  useLocal<ChannelCache>("ums.channelCache", { source: "", kind: "", channels: [], savedAt: 0 });

// -------------------------------------------------- صفحه‌های مستقل پلی‌لیست
// هر لینک پلی‌لیست یک صفحه مستقل می‌گیرد (با دکمه + صفحه جدید ساخته می‌شود) و
// همه صفحه‌ها به‌صورت دائمی ذخیره می‌شوند، بنابراین تعداد زیادی پلی‌لیست
// می‌تواند در برنامه نگه داشته شود.

export type PlaylistChannel = {
  key: string;
  title: string;
  group: string;
  logo: string;
  url: string;
  /** دسته‌بندی خودکار یا دستی */
  category: StreamCategory;
  favorite?: boolean;
  /** پوشه گروه‌بندی دلخواه کاربر */
  folder?: string;
};

export type PlaylistPage = {
  id: string;
  name: string;
  source: string;
  kind: string;
  channels: PlaylistChannel[];
  /** پوشه‌های گروه‌بندی ساخته‌شده در همین صفحه */
  folders: string[];
  createdAt: number;
  updatedAt: number;
};

export const usePlaylistPages = () => useLocal<PlaylistPage[]>("ums.playlistPages", []);
export const useActivePlaylistPage = () => useLocal<string>("ums.playlistPage.active", "");
