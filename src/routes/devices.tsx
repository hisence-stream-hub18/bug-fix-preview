import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  Cast as CastIcon,
  Check,
  MonitorSpeaker,
  MonitorUp,
  Settings2,
  Pencil,
  RefreshCw,
  Radar,
  Square,
  Play,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Slider } from "@/components/ui/slider";
import { deviceLabel, useDevices, useSettings, type TvDevice } from "@/lib/ums-store";
import { closePlayer, openPlayer } from "@/lib/player-store";
import {
  WEB_MODE_MESSAGE,
  getUms,
  useDesktop,
  useServerStatus,
  type DeviceTarget,
} from "@/lib/ums-bridge";

export const Route = createFileRoute("/devices")({
  head: () => ({
    meta: [
      { title: "دستگاه‌های شبکه | مدیا سرور" },
      {
        name: "description",
        content:
          "شناسایی تلویزیون‌های DLNA/UPnP و دستگاه‌های Google Cast در شبکه داخلی همراه با نوار پیشرفت و کنترل پخش.",
      },
      { property: "og:title", content: "دستگاه‌های شبکه" },
      {
        property: "og:description",
        content: "لیست تلویزیون‌ها، کروم‌کست‌ها و رندررهای شبکه با کنترل کامل پخش.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Devices,
});

const statusLabel: Record<TvDevice["status"], string> = {
  online: "آنلاین",
  offline: "آفلاین",
  playing: "در حال پخش",
};

type ShareSpeed = "auto" | "compatible" | "balanced" | "fast" | "manual";

const speedOptions: Record<
  ShareSpeed,
  { label: string; detail: string; fps?: number; kbps?: number; gop?: number }
> = {
  auto: { label: "خودکار", detail: "انتخاب بر اساس سخت‌افزار" },
  compatible: { label: "سازگار", detail: "تلویزیون قدیمی یا شبکه ضعیف", fps: 12, kbps: 2200, gop: 30 },
  balanced: { label: "متعادل", detail: "کیفیت و تأخیر متوازن", fps: 15, kbps: 3200, gop: 30 },
  fast: { label: "سریع", detail: "شبکه و سخت‌افزار قوی", fps: 25, kbps: 5000, gop: 30 },
  manual: { label: "دستی", detail: "FPS و نرخ ارسال دلخواه" },
};

/** Everything the desktop backend needs to address this renderer. */
function targetOf(device: TvDevice, control: "transport" | "volume" = "transport"): DeviceTarget {
  if (device.protocol === "Cast") {
    return { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 };
  }
  return {
    protocol: device.protocol,
    controlUrl: (control === "volume" ? device.renderingControlUrl : device.avTransportUrl) || "",
  };
}

function Devices() {
  const [devices, setDevices] = useDevices();
  const [settings] = useSettings();
  const [scanning, setScanning] = useState(false);
  const [progress, setProgress] = useState(0);
  const timer = useRef<number | null>(null);
  const desktop = useDesktop();

  // Smooth, honest-looking progress for the 4.5s SSDP + mDNS sweep.
  useEffect(() => {
    if (!scanning) {
      if (timer.current) window.clearInterval(timer.current);
      timer.current = null;
      return;
    }
    setProgress(4);
    timer.current = window.setInterval(() => {
      setProgress((v) => (v >= 96 ? 96 : v + 100 / 45));
    }, 100);
    return () => {
      if (timer.current) window.clearInterval(timer.current);
    };
  }, [scanning]);
  const { status } = useServerStatus();

  const scan = async () => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    if (!settings.dlnaEnabled && !settings.upnpEnabled) {
      toast.error("برای جست‌وجو، DLNA یا UPnP را در تنظیمات فعال کنید.");
      return;
    }
    setScanning(true);
    try {
      const found = await api.scanDevices({ timeout: 4500 });
      setDevices((prev) =>
        found.map((d) => {
          const before = prev.find((p) => p.id === d.id);
          return {
            id: d.id,
            name: d.name,
            ...(d.model ? { model: d.model } : {}),
            ...(d.manufacturer ? { manufacturer: d.manufacturer } : {}),
            ip: d.ip,
            ...(d.port ? { port: d.port } : {}),
            protocol: d.protocol,
            status: (before?.status === "playing" ? "playing" : "online") as TvDevice["status"],
            ...(before?.nowPlaying ? { nowPlaying: before.nowPlaying } : {}),
            avTransportUrl: d.avTransportUrl,
            renderingControlUrl: d.renderingControlUrl,
            location: d.location,
          };
        }),
      );
      const casts = found.filter((d) => d.protocol === "Cast").length;
      toast[found.length ? "success" : "error"](
        found.length
          ? `${found.length} دستگاه پیدا شد${casts ? ` (${casts} دستگاه Google Cast)` : ""}.`
          : "دستگاهی پیدا نشد. تلویزیون روشن و روی همان شبکه باشد و فایروال پورت‌های UDP 1900 و 5353 را باز کند.",
      );
    } catch {
      toast.error("جست‌وجوی شبکه با خطا مواجه شد.");
    } finally {
      setProgress(100);
      setScanning(false);
      window.setTimeout(() => setProgress(0), 700);
    }
  };

  const rename = (id: string, value: string) =>
    setDevices((prev) => prev.map((d) => (d.id === id ? { ...d, customName: value.trim() } : d)));

  const clearPlaying = (id: string) =>
    setDevices((prev) =>
      prev.map((d) => {
        if (d.id !== id) return d;
        const { nowPlaying: _drop, ...rest } = d;
        return { ...rest, status: "online" as TvDevice["status"] };
      }),
    );

  return (
    <AppLayout title="دستگاه‌های شبکه" subtitle="تلویزیون‌های DLNA/UPnP و دستگاه‌های Google Cast">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4">
        <div className="text-sm text-muted-foreground">
          <p>
            آدرس سرور:{" "}
            <span dir="ltr">
              {status?.baseUrl ?? `http://${settings.networkIp || "—"}:${settings.port}`}
            </span>{" "}
            — پروتکل‌های فعال:{" "}
            {[settings.dlnaEnabled && "DLNA", settings.upnpEnabled && "UPnP", "Google Cast"]
              .filter(Boolean)
              .join(" و ") || "هیچ‌کدام"}
          </p>
          {!desktop ? <p className="mt-1 text-xs text-destructive">{WEB_MODE_MESSAGE}</p> : null}
        </div>
        <button
          onClick={scan}
          disabled={scanning}
          className="group relative inline-flex items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-l from-primary to-primary/70 px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:shadow-primary/40 disabled:opacity-70"
        >
          {scanning ? (
            <Radar className="size-4 animate-spin" />
          ) : (
            <RefreshCw className="size-4 transition-transform group-hover:rotate-180" />
          )}
          {scanning ? "پویش شبکه…" : "جست‌وجوی هوشمند تلویزیون"}
          {scanning ? (
            <span className="absolute inset-x-0 bottom-0 h-1 bg-primary-foreground/20">
              <span
                className="block h-full bg-primary-foreground/80 transition-all"
                style={{ width: `${progress}%` }}
              />
            </span>
          ) : null}
        </button>
      </div>

      {scanning ? (
        <div className="mb-4 overflow-hidden rounded-xl border border-primary/30 bg-card/70 p-4">
          <div className="flex items-center gap-3 text-sm">
            <span className="relative grid size-9 place-items-center">
              <span className="absolute inset-0 animate-ping rounded-full bg-primary/30" />
              <Radar className="size-5 text-primary" />
            </span>
            <div className="flex-1">
              <p className="font-medium">ارسال بسته‌های SSDP و پرس‌وجوی mDNS…</p>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>
            <span className="text-xs text-muted-foreground">{Math.round(progress)}٪</span>
          </div>
        </div>
      ) : null}

      {devices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/60 p-8 text-center text-sm text-muted-foreground">
          هنوز دستگاهی شناسایی نشده است. دکمه «جست‌وجوی دستگاه‌ها» را بزنید تا بسته‌های SSDP و
          پرس‌وجوی mDNS روی شبکه ارسال شود.
        </div>
      ) : null}

      <ul className="grid gap-3 md:grid-cols-2">
        {devices.map((d) => (
          <DeviceCard
            key={d.id}
            device={d}
            onStopped={() => clearPlaying(d.id)}
            onRename={(value) => rename(d.id, value)}
          />
        ))}
      </ul>
    </AppLayout>
  );
}

function DeviceCard({
  device,
  onStopped,
  onRename,
}: {
  device: TvDevice;
  onStopped: () => void;
  onRename: (value: string) => void;
}) {
  const transport = targetOf(device, "transport");
  const canControl = Boolean(transport.controlUrl || transport.ip);
  const [sharing, setSharing] = useState(false);
  const [settings] = useSettings();
  const [shareSpeed, setShareSpeed] = useState<ShareSpeed>("auto");
  const [manualFps, setManualFps] = useState(15);
  const [manualKbps, setManualKbps] = useState(3200);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(deviceLabel(device));
  const label = deviceLabel(device);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(`ums.share-speed.${device.id}`);
      if (!raw) return;
      const saved = JSON.parse(raw) as { mode?: ShareSpeed; fps?: number; kbps?: number };
      if (saved.mode && saved.mode in speedOptions) setShareSpeed(saved.mode);
      if (saved.fps) setManualFps(Math.max(10, Math.min(60, saved.fps)));
      if (saved.kbps) setManualKbps(Math.max(1200, Math.min(12000, saved.kbps)));
    } catch {
      // Corrupt per-device preferences fall back to automatic mode.
    }
  }, [device.id]);

  const saveShareSpeed = (mode: ShareSpeed, fps = manualFps, kbps = manualKbps) => {
    setShareSpeed(mode);
    try {
      window.localStorage.setItem(
        `ums.share-speed.${device.id}`,
        JSON.stringify({ mode, fps, kbps }),
      );
    } catch {
      // Sharing still works when storage is unavailable.
    }
  };

  const saveName = () => {
    onRename(draft);
    setEditing(false);
    toast.success(
      draft.trim() ? `نام دستگاه به «${draft.trim()}» تغییر کرد.` : "نام پیش‌فرض بازگشت.",
    );
  };

  const stop = async () => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    if (!canControl) {
      toast.error("این دستگاه سرویس کنترل موردنیاز را ندارد.");
      return;
    }
    const res = await api.stop(transport);
    await api.stopScreenShare(transport).catch(() => null);
    if (!res.ok) {
      toast.error(res.error || "دستگاه فرمان را نپذیرفت.");
      return;
    }
    closePlayer();
    onStopped();
    toast.success("پخش متوقف شد.");
  };

  const shareScreen = async () => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    if (!canControl) {
      toast.error("این دستگاه سرویس AVTransport ندارد؛ دوباره جست‌وجو کنید.");
      return;
    }
    setSharing(true);
    try {
      const selected = speedOptions[shareSpeed];
      const fps = shareSpeed === "manual" ? manualFps : selected.fps;
      const kbps = shareSpeed === "manual" ? manualKbps : selected.kbps;
      const res = await api.shareScreen({
        ...transport,
        // Per-TV speed wins; automatic mode can still use the global tuning.
        ...(fps || settings.captureFps ? { fps: fps || settings.captureFps } : {}),
        ...(kbps || settings.captureKbps ? { kbps: kbps || settings.captureKbps } : {}),
        ...(selected.gop ? { gop: selected.gop } : {}),
        // No sound from the computer — the TV is the only speaker.
        muteLocal: true,
        // Controls belong to the floating desktop panel, never burned into
        // the picture sent to the TV.
        panel: false,
      });
      if (!res.ok) {
        toast.error(res.error || "اشتراک صفحه شروع نشد.");
        return;
      }
      openPlayer({ device, title: "صفحه دسکتاپ", live: true });
      toast.success(`صفحه دسکتاپ روی ${label} پخش می‌شود.`);
      const note = (res as { note?: string }).note;
      if (note) toast.info(note);
    } finally {
      setSharing(false);
    }
  };

  return (
    <li className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start gap-3">
        <div className="grid size-10 place-items-center rounded-lg bg-primary/15 text-primary">
          {device.protocol === "Cast" ? (
            <CastIcon className="size-5" />
          ) : (
            <MonitorSpeaker className="size-5" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="flex items-center gap-1">
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") saveName();
                  if (e.key === "Escape") setEditing(false);
                }}
                placeholder="نام دلخواه برای این تلویزیون"
                className="w-full rounded-lg border border-primary/50 bg-background px-2 py-1 text-sm outline-none"
              />
              <button
                onClick={saveName}
                aria-label="ذخیره نام"
                className="rounded-md p-1 text-primary"
              >
                <Check className="size-4" />
              </button>
              <button
                onClick={() => setEditing(false)}
                aria-label="لغو"
                className="rounded-md p-1 text-muted-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ) : (
            <p className="flex items-center gap-1.5 font-medium">
              {label}
              <button
                onClick={() => {
                  setDraft(label);
                  setEditing(true);
                }}
                title="تغییر نام دستگاه"
                aria-label="تغییر نام دستگاه"
                className="rounded-md p-1 text-muted-foreground transition-colors hover:text-primary"
              >
                <Pencil className="size-3.5" />
              </button>
            </p>
          )}
          {device.model || device.manufacturer ? (
            <p className="text-xs text-muted-foreground">
              {[device.manufacturer, device.model].filter(Boolean).join(" · ")}
            </p>
          ) : null}
          <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
            {device.ip} · {device.protocol}
            {device.protocol === "Cast"
              ? ` · castv2:${device.port ?? 8009}`
              : device.avTransportUrl
                ? " · AVTransport"
                : ""}
          </p>
        </div>
        <span
          className={`rounded-md px-2 py-1 text-xs ${
            device.status === "offline"
              ? "bg-secondary text-muted-foreground"
              : "bg-primary/15 text-primary"
          }`}
        >
          {statusLabel[device.status]}
        </span>
      </div>

      {/* Playback controls live in the floating player popup, so they stay
          available while the user browses other pages. */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => openPlayer({ device, title: device.nowPlaying || label })}
          className="inline-flex items-center gap-1 rounded-lg border border-primary/50 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10"
        >
          <Play className="size-3" /> پلیر شناور
        </button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => void shareScreen()}
          disabled={sharing}
        >
          <MonitorUp className="size-3" /> {sharing ? "در حال شروع…" : "اشتراک صفحه دسکتاپ"}
        </Button>
        <Popover>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="icon"
              aria-label="تنظیم سرعت اشتراک صفحه"
              title="تنظیم سرعت اشتراک صفحه"
              className="size-8"
            >
              <Settings2 className="size-3.5" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="start" className="w-72" dir="rtl">
            <p className="text-sm font-semibold">سرعت ارسال به {label}</p>
            <div className="mt-3 grid gap-1.5">
              {(Object.keys(speedOptions) as ShareSpeed[]).map((mode) => (
                <Button
                  key={mode}
                  type="button"
                  variant={shareSpeed === mode ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => saveShareSpeed(mode)}
                  className="h-auto justify-start whitespace-normal py-2 text-right"
                >
                  <span className="block">
                    <span className="block font-medium">{speedOptions[mode].label}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {speedOptions[mode].detail}
                    </span>
                  </span>
                </Button>
              ))}
            </div>
            {shareSpeed === "manual" ? (
              <div className="mt-4 space-y-4 border-t border-border pt-4">
                <label className="block text-xs">
                  <span className="mb-2 flex justify-between">
                    <span>نرمی تصویر</span><span dir="ltr">{manualFps} FPS</span>
                  </span>
                  <Slider
                    value={[manualFps]}
                    min={10}
                    max={30}
                    step={1}
                    onValueChange={([value]) => {
                      if (typeof value !== "number") return;
                      setManualFps(value);
                      saveShareSpeed("manual", value, manualKbps);
                    }}
                  />
                </label>
                <label className="block text-xs">
                  <span className="mb-2 flex justify-between">
                    <span>نرخ ارسال</span><span dir="ltr">{manualKbps} kbps</span>
                  </span>
                  <Slider
                    value={[manualKbps]}
                    min={1200}
                    max={12000}
                    step={200}
                    onValueChange={([value]) => {
                      if (typeof value !== "number") return;
                      setManualKbps(value);
                      saveShareSpeed("manual", manualFps, value);
                    }}
                  />
                </label>
              </div>
            ) : null}
          </PopoverContent>
        </Popover>
        <button
          onClick={() => void stop()}
          className="inline-flex items-center gap-1 rounded-lg border border-destructive/50 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-destructive/10"
        >
          <Square className="size-3" /> توقف پخش
        </button>
      </div>

      {device.nowPlaying ? (
        <div className="mt-3 truncate rounded-lg bg-secondary px-3 py-2 text-xs">
          در حال پخش: {device.nowPlaying}
        </div>
      ) : null}
    </li>
  );
}
