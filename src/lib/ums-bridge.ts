// Renderer-side bridge to the real Electron backend (window.ums, exposed by
// electron/preload.cjs). In the browser / mobile web build the desktop APIs are
// absent, so every call returns a clearly-labelled "not available" result and
// the UI switches to preview mode instead of pretending the network works.

import { useCallback, useEffect, useState } from "react";

import { getNativeUms } from "./ums-native";
import { pollInterval } from "./perf";

export type SoapResult = { ok: boolean; error?: string; url?: string; subtitle?: string };

export type DeviceProtocol = "DLNA" | "UPnP" | "Cast";

export type DiscoveredDevice = {
  id: string;
  name: string;
  model?: string;
  manufacturer?: string;
  ip: string;
  port?: number;
  protocol: DeviceProtocol;
  avTransportUrl: string;
  renderingControlUrl: string;
  location: string;
};

/** Everything the main process needs to address one renderer (DLNA or Cast). */
export type DeviceTarget = {
  protocol?: DeviceProtocol;
  controlUrl?: string;
  ip?: string;
  port?: number;
};

export type PlaybackState = {
  ok: boolean;
  state?: string;
  error?: string;
  volume?: number;
  muted?: boolean;
  position?: {
    relSeconds?: number;
    durationSeconds?: number;
    uri?: string;
    title?: string;
  };
};

export type ServerStatus = {
  running: boolean;
  port: number;
  host: string;
  name: string;
  uuid?: string;
  ip: string;
  baseUrl: string;
  items: number;
  uptimeSec: number;
  requests: number;
  bytesSent: number;
  advertising: boolean;
  lastError?: string;
  interfaces?: { name: string; address: string }[];
  version?: string;
  restarted?: boolean;
  ok?: boolean;
  error?: string;
};

export type MediaEntry = {
  id: string;
  title: string;
  source: string;
  mime?: string;
  /** Sidecar subtitle path/URL served on /subtitle/:id. */
  subtitle?: string;
};

/** One entry of an IPTV M3U playlist or an HLS master playlist. */
export type PlaylistChannel = {
  key: string;
  title: string;
  group: string;
  logo: string;
  tvgId: string;
  url: string;
};

export type PlaylistResult = {
  ok: boolean;
  kind: string;
  channels: PlaylistChannel[];
  error?: string;
};

export type ScreenStatus = {
  running: boolean;
  audio?: boolean;
  audioDevice?: string;
  viewers: number;
  ffmpeg: string;
  /** Persian note shown when the mirror had to start without audio. */
  audioNote?: string;
  uptimeSec: number;
  lastError?: string;
};

/** Live CPU/RAM pressure of the machine, plus the hang state of the window. */
export type SystemLoad = {
  cpu: number;
  cores: number;
  totalMb: number;
  freeMb: number;
  usedPercent: number;
  appMb: number;
  level: "ok" | "pressure" | "hang";
  autoRestart: boolean;
  hangSeconds: number;
  restarts: number;
  uptimeSec: number;
};

/** One row of the dependency doctor (ffmpeg, yt-dlp, loopback audio…). */
export type DependencyItem = {
  id: string;
  name: string;
  ok: boolean;
  detail: string;
  fixable: boolean;
  required: boolean;
};

export type DependencyReport = {
  ok: boolean;
  items: DependencyItem[];
  binDir: string;
  platform: string;
  test?: { ok: boolean; error?: string };
};

/** An installed plugin (افزونه) living in <userData>/plugins. */
export type AppPlugin = {
  id: string;
  name: string;
  version: string;
  description: string;
  enabled: boolean;
  loaded: boolean;
  error?: string;
  folder: string;
};


/** Emitted by the stall guard while the TV picture is frozen. */
export type BufferingEvent = {
  type: "buffering";
  key: string;
  showingLogo: boolean;
  at?: number;
};

/** A download job as tracked by the desktop backend (yt-dlp / direct HTTP). */
export type BackendDownload = {
  id: string;
  title: string;
  url: string;
  genre?: string;
  progress: number;
  status: "queued" | "downloading" | "done" | "error" | "canceled";
  error?: string;
  file?: string;
  sizeMb?: number;
  speed?: string;
  createdAt: number;
};

export type UmsApi = {
  isDesktop: true;
  platform: string;
  getStatus(): Promise<ServerStatus>;
  getNetwork(): Promise<{ ip: string; interfaces: { name: string; address: string }[] }>;
  applySettings(settings: Record<string, unknown>): Promise<ServerStatus>;
  restartServer(): Promise<ServerStatus>;
  setMedia(items: MediaEntry[]): Promise<{ count: number }>;
  /** Registers one extra item (IPTV channel, ad-hoc link) and returns its id. */
  addMedia(item: MediaEntry): Promise<{ id: string }>;
  /** Loopback base URL of the media server, for the in-app player. */
  localBase(): Promise<string>;
  mediaUrl(id: string): Promise<string>;
  pickFiles(): Promise<{ path: string; name: string; sizeMb: number }[]>;
  pickSubtitle(p?: { mediaId?: string }): Promise<{ path: string; name: string } | null>;
  setSubtitle(p: { mediaId: string; file: string }): Promise<{ ok: boolean }>;
  scanDevices(options?: { timeout?: number }): Promise<DiscoveredDevice[]>;
  play(
    p: DeviceTarget & {
      mediaId?: string;
      url?: string;
      title?: string;
      mime?: string;
      subtitle?: string;
    },
  ): Promise<
    SoapResult & { mediaId?: string; live?: boolean; mime?: string; superseded?: boolean }
  >;

  stop(p: DeviceTarget): Promise<SoapResult>;
  pause(p: DeviceTarget): Promise<SoapResult>;
  resume(p: DeviceTarget): Promise<SoapResult>;
  seek(p: DeviceTarget & { seconds: number }): Promise<SoapResult>;
  setVolume(p: DeviceTarget & { volume: number }): Promise<SoapResult>;
  setMute(p: DeviceTarget & { mute: boolean }): Promise<SoapResult>;
  deviceState(p: DeviceTarget): Promise<PlaybackState>;
  loadPlaylist(p: { source: string }): Promise<PlaylistResult>;
  pickPlaylistFile(): Promise<{ path: string; name: string } | null>;
  shareScreen(
    p: DeviceTarget & {
      fps?: number;
      kbps?: number;
      gop?: number;
      /** Silences the PC speakers so the sound only comes out of the TV. */
      muteLocal?: boolean;
      /** Burns the control-panel strip into the picture sent to the TV. */
      panel?: boolean;
      panelText?: string;
    },
  ): Promise<SoapResult & { live?: boolean; localMuted?: boolean }>;
  stopScreenShare(p?: DeviceTarget): Promise<{ ok: boolean; running?: boolean }>;
  screenStatus(): Promise<ScreenStatus>;
  /** Desktop only: shows/hides/updates the panel drawn on the TV picture. */
  screenPanel?(p: {
    visible?: boolean;
    toggle?: boolean;
    text?: string;
  }): Promise<{ ok: boolean; visible: boolean; text: string }>;
  /** Desktop only: mutes/unmutes the computer speakers. */
  screenMuteLocal?(on: boolean): Promise<{ ok: boolean; muted?: boolean }>;
  /** Desktop only: sends a keystroke/media key to the focused desktop window. */
  hostKey?(p: {
    action:
      | "playpause"
      | "next"
      | "prev"
      | "stop"
      | "volup"
      | "voldown"
      | "mute"
      | "right"
      | "left"
      | "space"
      | "escape"
      | "fullscreen";
    repeat?: number;
  }): Promise<{ ok: boolean; error?: string }>;

  /** Desktop only: enables/disables the floating browser-link catcher. */
  setLinkCatcher?(on: boolean): Promise<boolean>;
  openExternal(url: string): Promise<boolean>;
  /** Desktop only: launches the installed VLC with this URL. */
  openInVlc?(url: string): Promise<{ ok: boolean; error?: string }>;
  /** Desktop only: CORS-free online translation used by the subtitle engine. */
  translate?(p: {
    text: string;
    target: string;
  }): Promise<{ ok: boolean; text?: string; detected?: string; error?: string }>;
  checkUpdate(): Promise<{ current: string; url: string }>;
  appVersion(): Promise<string>;
  /** Desktop only: ffmpeg / yt-dlp availability, auto-repaired after install. */
  toolStatus?(): Promise<{ ffmpeg: string; ytdlp: string; binDir: string }>;
  ensureTools?(): Promise<{ ffmpeg: string; ytdlp: string; binDir: string }>;
  /** Desktop only: full dependency report (ffmpeg, yt-dlp, loopback audio…). */
  depsCheck?(): Promise<DependencyReport>;
  /** Desktop only: 2-second capture dry-run that proves screen sharing works. */
  depsTest?(): Promise<{ ok: boolean; error?: string; ffmpeg?: string }>;
  /** Desktop only: installs/updates every missing dependency, then restarts. */
  depsRepair?(p?: {
    force?: boolean;
    restart?: boolean;
  }): Promise<DependencyReport & { log: string[]; restarting?: boolean }>;
  /** Desktop only: installed plugins. */
  pluginList?(): Promise<AppPlugin[]>;
  pluginInstall?(p?: {
    path?: string;
  }): Promise<{ ok: boolean; error?: string; canceled?: boolean; plugin?: AppPlugin }>;
  pluginSetEnabled?(p: { id: string; enabled: boolean }): Promise<{ ok: boolean; error?: string }>;
  pluginRemove?(p: { id: string }): Promise<{ ok: boolean; error?: string }>;
  pluginReload?(): Promise<{ ok: boolean; count: number }>;
  pluginFolder?(): Promise<string>;

  /** Desktop only: real downloads through yt-dlp / direct HTTP. */
  downloadStart?(p: {
    url: string;
    title?: string;
    genre?: string;
    audioOnly?: boolean;
  }): Promise<{ ok: boolean; id?: string; error?: string; job?: BackendDownload }>;
  downloadCancel?(p: { id: string }): Promise<{ ok: boolean }>;
  downloadList?(): Promise<BackendDownload[]>;
  downloadFolder?(): Promise<string>;
  revealFile?(file: string): Promise<{ ok: boolean }>;
  /** Desktop only: are these channels alive right now? */
  probeStreams?(p: {
    urls: string[];
    timeout?: number;
  }): Promise<{ ok: boolean; results: Record<string, { ok: boolean; status: number }> }>;
  /** Desktop only: live CPU/RAM pressure + hang state. */
  systemLoad?(): Promise<SystemLoad>;
  /** Desktop only: tells the watchdog the UI is still responsive. */
  heartbeat?(): Promise<{ ok: boolean }>;
  /** Desktop only: relaunch the app automatically when it freezes. */
  setAutoRestart?(on: boolean): Promise<boolean>;
  /** Desktop only: relaunch the app right now. */
  restartApp?(): Promise<{ ok: boolean; error?: string }>;
  /** Desktop only: publishes the channel list to the on-TV control panel. */
  remoteSetChannels?(p: {
    channels: { id: string; title: string; group?: string }[];
  }): Promise<{ ok: boolean; count: number }>;
  /** Desktop only: subtitle/dub state shown on the on-TV control panel. */
  remoteSetFlags?(p: {
    subtitle?: boolean;
    dub?: boolean;
    current?: string;
  }): Promise<{ subtitle: boolean; dub: boolean; current: string }>;
  /** Desktop only: URL of the on-TV control panel (open it in the TV browser). */
  remoteUrl?(): Promise<string>;
  onEvent(
    handler: (data: { type: string; to?: string } & Record<string, unknown>) => void,
  ): () => void;
};

declare global {
  interface Window {
    ums?: UmsApi;
  }
}

export const WEB_MODE_MESSAGE =
  "این قابلیت شبکه‌ای فقط در نسخه دسکتاپ (نصب‌شده) فعال است؛ در پیش‌نمایش مرورگر حالت نمایشی است.";

export function getUms(): UmsApi | null {
  if (typeof window === "undefined") return null;
  // Desktop preload bridge first, then the native Android (Capacitor) plugin.
  return window.ums ?? getNativeUms();
}

/** True after hydration when running inside the packaged desktop app. */
export function useDesktop() {
  const [desktop, setDesktop] = useState(false);
  useEffect(() => {
    setDesktop(Boolean(getUms()));
  }, []);
  return desktop;
}

/** Live server status, polled while the page is open. */
export function useServerStatus(intervalMs = 3000) {
  const [status, setStatus] = useState<ServerStatus | null>(null);
  const [available, setAvailable] = useState(false);

  const refresh = useCallback(async () => {
    const api = getUms();
    setAvailable(Boolean(api));
    if (!api) return null;
    try {
      const next = await api.getStatus();
      setStatus(next);
      return next;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    void refresh();
    const api = getUms();
    if (!api) return;
    const t = window.setInterval(() => void refresh(), pollInterval(intervalMs));
    return () => window.clearInterval(t);
  }, [refresh, intervalMs]);

  return { status, available, refresh };
}

/** Keeps the desktop media registry in sync so /media/:id can serve real bytes. */
export function useSyncMedia(entries: MediaEntry[], ready: boolean) {
  useEffect(() => {
    if (!ready) return;
    const api = getUms();
    if (!api) return;
    void api.setMedia(entries);
  }, [entries, ready]);
}

/** Menu → page navigation coming from the Electron application menu. */
export function useMenuNavigation(navigate: (to: string) => void) {
  useEffect(() => {
    const api = getUms();
    if (!api) return;
    return api.onEvent((data) => {
      if (data?.type === "navigate" && typeof data.to === "string") navigate(data.to);
    });
  }, [navigate]);
}

/** "01:02:03" for the seek bar labels. */
export function formatClock(totalSeconds: number | undefined) {
  const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const pad = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(sec)}` : `${pad(m)}:${pad(sec)}`;
}

/**
 * Live playback position for one renderer, polled while the card is visible.
 * Works for both DLNA (GetPositionInfo) and Cast (MEDIA_STATUS).
 */
export function usePlayback(target: DeviceTarget | null, intervalMs = 2000) {
  const [playback, setPlayback] = useState<PlaybackState | null>(null);

  const key = target
    ? `${target.protocol ?? ""}|${target.controlUrl ?? ""}|${target.ip ?? ""}`
    : "";

  const refresh = useCallback(async () => {
    const api = getUms();
    if (!api || !target) return null;
    if (!target.controlUrl && !target.ip) return null;
    try {
      const next = await api.deviceState(target);
      setPlayback(next);
      return next;
    } catch {
      return null;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  useEffect(() => {
    if (!key) return;
    void refresh();
    const api = getUms();
    if (!api) return;
    const t = window.setInterval(() => void refresh(), pollInterval(intervalMs));
    return () => window.clearInterval(t);
  }, [key, refresh, intervalMs]);

  return { playback, refresh };
}

/**
 * System pressure watchdog for the UI: sends a heartbeat so the backend can
 * detect a frozen window, and exposes the current CPU/RAM load plus manual and
 * automatic restart.
 */
export function useSystemHealth(intervalMs = 3000) {
  const [load, setLoad] = useState<SystemLoad | null>(null);

  useEffect(() => {
    const api = getUms();
    if (!api?.systemLoad) return;
    let alive = true;
    const beat = async () => {
      if (!alive) return;
      try {
        await api.heartbeat?.();
        const next = await api.systemLoad?.();
        if (next && alive) setLoad(next);
      } catch {
        /* ignore */
      }
    };
    void beat();
    const t = window.setInterval(() => void beat(), pollInterval(intervalMs));
    const off = api.onEvent((data) => {
      if (data?.type === "health") setLoad(data as unknown as SystemLoad);
    });
    return () => {
      alive = false;
      window.clearInterval(t);
      off?.();
    };
  }, [intervalMs]);

  const restart = useCallback(async () => {
    await getUms()?.restartApp?.();
  }, []);

  const setAutoRestart = useCallback(async (on: boolean) => {
    await getUms()?.setAutoRestart?.(on);
    setLoad((prev) => (prev ? { ...prev, autoRestart: on } : prev));
  }, []);

  return { load, restart, setAutoRestart };
}
