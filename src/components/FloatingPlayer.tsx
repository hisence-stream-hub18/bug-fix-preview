// Floating, draggable player popup. It stays visible on every page (rendered by
// AppLayout) so the user can keep controlling the TV while browsing the library,
// channels or downloads. Opened through src/lib/player-store.ts.

import { useEffect, useRef, useState } from "react";
import {
  FastForward,
  GripVertical,
  Maximize2,
  Minus,
  Pause,
  Play,
  Rewind,
  Square,
  Tv,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  WEB_MODE_MESSAGE,
  formatClock,
  getUms,
  usePlayback,
  type DeviceTarget,
} from "@/lib/ums-bridge";
import {
  closePlayer,
  minimizePlayer,
  setBuffering,
  usePlayerSession,
} from "@/lib/player-store";
import { deviceLabel, type TvDevice } from "@/lib/ums-store";

function targetOf(device: TvDevice, control: "transport" | "volume"): DeviceTarget {
  if (device.protocol === "Cast") {
    return { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 };
  }
  return {
    protocol: device.protocol,
    controlUrl: (control === "volume" ? device.renderingControlUrl : device.avTransportUrl) || "",
  };
}

export function FloatingPlayer() {
  const { session, minimized, buffering } = usePlayerSession();

  // Buffering / stall-guard events from the desktop backend.
  useEffect(() => {
    const api = getUms();
    if (!api) return;
    return api.onEvent((data) => {
      if (data?.type === "buffering") setBuffering(Boolean(data["showingLogo"]));
    });
  }, []);

  // Desktop mirroring has its own dedicated panel (ScreenSharePanel).
  if (!session || session.live) return null;
  return (
    <PlayerWindow
      device={session.device}
      title={session.title}
      live={Boolean(session.live)}
      minimized={minimized}
      buffering={buffering}
    />
  );
}

function PlayerWindow({
  device,
  title,
  live,
  minimized,
  buffering,
}: {
  device: TvDevice;
  title: string;
  live: boolean;
  minimized: boolean;
  buffering: boolean;
}) {
  const transport = targetOf(device, "transport");
  const canControl = Boolean(transport.controlUrl || transport.ip);
  const { playback, refresh } = usePlayback(canControl && !minimized ? transport : null);
  const [seeking, setSeeking] = useState<number | null>(null);
  const [muted, setMuted] = useState(false);
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const position = playback?.position;
  const duration = live ? 0 : Number(position?.durationSeconds) || 0;
  const current = seeking ?? (Number(position?.relSeconds) || 0);
  const percent = duration > 0 ? Math.min(100, (current / duration) * 100) : 0;
  const playing = /PLAY/i.test(String(playback?.state || ""));

  // Keep the popup inside the viewport when the window is resized.
  useEffect(() => {
    const clamp = () => {
      setPos((p) => ({
        x: Math.min(p.x, Math.max(0, window.innerWidth - 340)),
        y: Math.min(p.y, Math.max(0, window.innerHeight - 140)),
      }));
    };
    window.addEventListener("resize", clamp);
    clamp();
    return () => window.removeEventListener("resize", clamp);
  }, []);

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 320, e.clientX - d.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 90, e.clientY - d.dy)),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  const command = async (action: "pause" | "resume" | "stop" | "mute") => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    if (!canControl) {
      toast.error("این دستگاه سرویس کنترل پخش را ندارد.");
      return;
    }
    let res;
    if (action === "mute") {
      res = await api.setMute({ ...targetOf(device, "volume"), mute: !muted });
      if (res.ok) setMuted((m) => !m);
    } else if (action === "pause") {
      res = await api.pause(transport);
    } else if (action === "resume") {
      res = await api.resume(transport);
    } else {
      res = await api.stop(transport);
      if (live) await api.stopScreenShare(transport).catch(() => null);
    }
    if (!res.ok) {
      toast.error(res.error || "دستگاه فرمان را نپذیرفت.");
      return;
    }
    if (action === "stop") {
      closePlayer();
      return;
    }
    void refresh();
  };

  const seekTo = async (seconds: number) => {
    const api = getUms();
    if (!api || live) return;
    const clamped = Math.max(0, duration > 0 ? Math.min(duration - 1, seconds) : seconds);
    setSeeking(clamped);
    const res = await api.seek({ ...transport, seconds: clamped });
    setSeeking(null);
    if (!res.ok) {
      toast.error(res.error || "دستگاه فرمان جابه‌جایی را نپذیرفت.");
      return;
    }
    void refresh();
  };

  const goFullscreen = async () => {
    const api = getUms();
    if (!api?.hostKey) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.hostKey({ action: "fullscreen", repeat: 1 });
    if (!res.ok) toast.error(res.error || "فرمان تمام‌صفحه اجرا نشد.");
  };

  const close = () => {
    const api = getUms();
    if (live && api) void api.stopScreenShare(transport);
    closePlayer();
  };

  return (
    <div
      dir="rtl"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-50 w-[min(22rem,calc(100vw-2rem))] rounded-2xl border border-primary/50 bg-card/95 shadow-[var(--glow-gold)] backdrop-blur"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-grab touch-none items-center gap-2 rounded-t-2xl border-b border-primary/30 bg-primary/10 px-3 py-2 active:cursor-grabbing"
      >
        <GripVertical className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-semibold text-primary">{title}</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <Tv className="size-3 text-primary" />
            <span className="truncate font-medium text-foreground">{deviceLabel(device)}</span>
            <span dir="ltr">· {device.ip} · {device.protocol}</span>
          </p>
        </div>
        <button
          onClick={() => minimizePlayer(!minimized)}
          aria-label={minimized ? "نمایش پلیر" : "کوچک کردن پلیر"}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {minimized ? <Play className="size-3.5" /> : <Minus className="size-3.5" />}
        </button>
        <button
          onClick={close}
          aria-label="بستن پلیر"
          className="rounded-md p-1 text-destructive transition-colors hover:bg-destructive/10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {minimized ? null : (
        <div className="p-3">
          {buffering ? (
            <p className="mb-2 rounded-lg bg-primary/15 px-2 py-1.5 text-[11px] text-primary">
              اینترنت ضعیف است — لوگوی برنامه روی تلویزیون نمایش داده می‌شود و پخش از همان ثانیه
              ادامه پیدا می‌کند.
            </p>
          ) : null}

          {live ? (
            <p className="mb-2 rounded-lg bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
              پخش زنده صفحه دسکتاپ (بدون نوار زمان)
            </p>
          ) : (
            <>
              <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                <span dir="ltr">{formatClock(current)}</span>
                <span dir="ltr">{duration > 0 ? formatClock(duration) : "--:--"}</span>
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(1, duration)}
                value={current}
                disabled={duration <= 0}
                onChange={(e) => setSeeking(Number(e.target.value))}
                onMouseUp={(e) => void seekTo(Number((e.target as HTMLInputElement).value))}
                onTouchEnd={(e) => void seekTo(Number((e.target as HTMLInputElement).value))}
                aria-label="نوار پیشرفت پخش"
                className="mt-1 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary disabled:cursor-not-allowed"
                style={{
                  background: `linear-gradient(to left, var(--color-primary) ${percent}%, var(--color-secondary) ${percent}%)`,
                }}
              />
            </>
          )}

          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {live ? null : (
              <>
                <button
                  onClick={() => void seekTo(current - 30)}
                  aria-label="۳۰ ثانیه عقب"
                  className="rounded-lg border border-border p-1.5 transition-colors hover:bg-accent"
                >
                  <Rewind className="size-3.5" />
                </button>
                <button
                  onClick={() => void seekTo(current + 30)}
                  aria-label="۳۰ ثانیه جلو"
                  className="rounded-lg border border-border p-1.5 transition-colors hover:bg-accent"
                >
                  <FastForward className="size-3.5" />
                </button>
              </>
            )}
            <button
              onClick={() => void command(playing ? "pause" : "resume")}
              className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent"
            >
              {playing ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
              {playing ? "توقف موقت" : "ادامه"}
            </button>
            <button
              onClick={() => void command("mute")}
              aria-label={muted ? "باصدا" : "بی‌صدا"}
              className="rounded-lg border border-border p-1.5 transition-colors hover:bg-accent"
            >
              {muted ? <VolumeX className="size-3.5" /> : <Volume2 className="size-3.5" />}
            </button>
            <button
              onClick={() => void goFullscreen()}
              aria-label="تمام‌صفحه"
              title="تمام‌صفحه روی صفحه پخش"
              className="rounded-lg border border-primary/50 p-1.5 text-primary transition-colors hover:bg-primary/15"
            >
              <Maximize2 className="size-3.5" />
            </button>
            <button
              onClick={() => void command("stop")}
              className="inline-flex items-center gap-1 rounded-lg border border-destructive/50 px-2.5 py-1.5 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <Square className="size-3.5" /> توقف
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
