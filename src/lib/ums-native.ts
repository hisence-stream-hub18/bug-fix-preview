// Android (Capacitor) adapter: maps the same UmsApi surface used by the desktop
// preload bridge onto the native UmsNative plugin (SSDP + AVTransport in Java).
// Only the network-facing parts exist natively; desktop-only features (local
// media server, file dialogs, updater) resolve with a clear "not available".

import type {
  DeviceTarget,
  DiscoveredDevice,
  PlaybackState,
  SoapResult,
  UmsApi,
} from "./ums-bridge";
import { parsePlaylist } from "./playlist-parse";

type NativePlugin = {
  scanDevices(o: { timeout?: number }): Promise<{ devices: DiscoveredDevice[] }>;
  play(o: Record<string, unknown>): Promise<SoapResult>;
  stop(o: Record<string, unknown>): Promise<SoapResult>;
  pause(o: Record<string, unknown>): Promise<SoapResult>;
  resume(o: Record<string, unknown>): Promise<SoapResult>;
  seek(o: Record<string, unknown>): Promise<SoapResult>;
  setVolume(o: Record<string, unknown>): Promise<SoapResult>;
  setMute(o: Record<string, unknown>): Promise<SoapResult>;
  deviceState(o: Record<string, unknown>): Promise<PlaybackState>;
  openInVlc?(o: { url: string }): Promise<{ ok: boolean; error?: string }>;
};

const MOBILE_ONLY =
  "در نسخه اندروید فقط ارسال به تلویزیون فعال است؛ سرور رسانه روی همان دستگاه ویندوزی اجرا می‌شود.";

function plugin(): NativePlugin | null {
  if (typeof window === "undefined") return null;
  const cap = (window as unknown as { Capacitor?: { Plugins?: Record<string, unknown> } }).Capacitor;
  return (cap?.Plugins?.["UmsNative"] as NativePlugin | undefined) ?? null;
}

const unavailable = async (): Promise<SoapResult> => ({ ok: false, error: MOBILE_ONLY });

/** Returns a UmsApi backed by the native Android plugin, when it is installed. */
export function getNativeUms(): UmsApi | null {
  const native = plugin();
  if (!native) return null;

  return {
    isDesktop: false,
    platform: "android",
    getStatus: async () => null,
    getNetwork: async () => ({ ip: "", interfaces: [] }),
    applySettings: async () => ({ ok: false, error: MOBILE_ONLY }),
    restartServer: async () => ({ ok: false, error: MOBILE_ONLY }),
    setMedia: async () => ({ count: 0 }),
    addMedia: async () => ({ id: "" }),
    localBase: async () => "",
    mediaUrl: async () => "",
    pickFiles: async () => [],
    pickSubtitle: async () => null,
    setSubtitle: async () => ({ ok: false }),
    scanDevices: async (options?: { timeout?: number }) =>
      (await native.scanDevices({ timeout: options?.timeout ?? 4000 })).devices ?? [],
    play: async (p: DeviceTarget & Record<string, unknown>) => (p.controlUrl ? native.play(p) : unavailable()),
    stop: async (p: DeviceTarget & Record<string, unknown>) => (p.controlUrl ? native.stop(p) : unavailable()),
    pause: async (p: DeviceTarget & Record<string, unknown>) => (p.controlUrl ? native.pause(p) : unavailable()),
    resume: async (p: DeviceTarget & Record<string, unknown>) => (p.controlUrl ? native.resume(p) : unavailable()),
    seek: async (p: DeviceTarget & Record<string, unknown>) => (p.controlUrl ? native.seek(p) : unavailable()),
    setVolume: async (p: DeviceTarget & Record<string, unknown>) => (p.controlUrl ? native.setVolume(p) : unavailable()),
    setMute: async (p: DeviceTarget & Record<string, unknown>) => (p.controlUrl ? native.setMute(p) : unavailable()),
    deviceState: async (p: DeviceTarget & Record<string, unknown>) =>
      p.controlUrl ? native.deviceState(p) : { ok: false, error: MOBILE_ONLY },
    // Playlists are parsed in the app itself on Android (no Node backend).
    loadPlaylist: async ({ source }: { source: string }) => {
      try {
        const res = await fetch(source);
        const text = await res.text();
        return parsePlaylist(text, source);
      } catch {
        return { ok: false, kind: "", channels: [], error: "پلی‌لیست دریافت نشد" };
      }
    },
    pickPlaylistFile: async () => null,
    // Screen mirroring needs the desktop capture pipeline (ffmpeg).
    shareScreen: async () => ({ ok: false, error: MOBILE_ONLY }),
    stopScreenShare: async () => ({ ok: true, running: false }),
    screenStatus: async () => ({ running: false, viewers: 0, ffmpeg: "", uptimeSec: 0 }),
    openExternal: async (url: string) => {
      window.open(url, "_blank", "noopener");
      return true;
    },
    // Android: hand the link to the installed VLC through an explicit intent.
    openInVlc: async (url: string) => {
      if (native.openInVlc) return native.openInVlc({ url });
      const clean = String(url).replace(/^https?:\/\//i, "");
      const scheme = /^https:/i.test(url) ? "https" : "http";
      try {
        window.location.href = `intent://${clean}#Intent;scheme=${scheme};type=video/*;package=org.videolan.vlc;S.browser_fallback_url=${encodeURIComponent(
          url,
        )};end`;
        return { ok: true };
      } catch {
        return { ok: false, error: "VLC روی این گوشی نصب نیست." };
      }
    },
    checkUpdate: async () => ({ current: "android", url: "" }),
    appVersion: async () => "android",
    onEvent: () => () => {},
  } as unknown as UmsApi;
}
