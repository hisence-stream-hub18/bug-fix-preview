// Floating control panel for the mirrored desktop.
//
// While the desktop screen is shared to the TV the PC speakers are silenced
// (the sound must come out of the TV only) and the user needs one small panel,
// in the app theme, floating over the desktop, that controls *only* the shared
// picture: play/pause, seek, previous/next item, fullscreen and TV volume.
// Everything is sent to the desktop as real keystrokes, so it works with any
// player that happens to be on screen.

import { useEffect, useRef, useState } from "react";
import {
  ChevronsLeft,
  ChevronsRight,
  GripVertical,
  Maximize2,
  Minus,
  MonitorSpeaker,
  Pause,
  Play,
  Rewind,
  FastForward,
  Square,
  Volume1,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { WEB_MODE_MESSAGE, getUms, type DeviceTarget } from "@/lib/ums-bridge";
import { closePlayer, usePlayerSession } from "@/lib/player-store";
import { deviceLabel, type TvDevice } from "@/lib/ums-store";

type HostAction = "playpause" | "next" | "prev" | "right" | "left" | "fullscreen";

function volumeTarget(device: TvDevice): DeviceTarget {
  if (device.protocol === "Cast") {
    return { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 };
  }
  return { protocol: device.protocol, controlUrl: device.renderingControlUrl || "" };
}

function transportTarget(device: TvDevice): DeviceTarget {
  if (device.protocol === "Cast") {
    return { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 };
  }
  return { protocol: device.protocol, controlUrl: device.avTransportUrl || "" };
}

export function ScreenSharePanel() {
  const { session } = usePlayerSession();
  const [pos, setPos] = useState({ x: 24, y: 24 });
  const [collapsed, setCollapsed] = useState(false);
  const [playing, setPlaying] = useState(true);
  const [volume, setVolume] = useState(35);
  const [tvMuted, setTvMuted] = useState(false);
  const [pcMuted, setPcMuted] = useState(true);
  const drag = useRef<{ dx: number; dy: number } | null>(null);

  const device = session?.live ? session.device : null;

  // Read the TV volume once so the +/- buttons start from the real value.
  useEffect(() => {
    if (!device) return;
    const api = getUms();
    if (!api) return;
    void api
      .deviceState(volumeTarget(device))
      .then((s) => {
        if (typeof s?.volume === "number") setVolume(Math.max(0, Math.min(100, s.volume)));
      })
      .catch(() => null);
  }, [device]);

  useEffect(() => {
    const clamp = () =>
      setPos((p) => ({
        x: Math.min(p.x, Math.max(0, window.innerWidth - 340)),
        y: Math.min(p.y, Math.max(0, window.innerHeight - 140)),
      }));
    window.addEventListener("resize", clamp);
    clamp();
    return () => window.removeEventListener("resize", clamp);
  }, []);

  if (!device || !session) return null;

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

  const key = async (action: HostAction, repeat = 1) => {
    const api = getUms();
    if (!api?.hostKey) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.hostKey({ action, repeat });
    if (!res.ok) toast.error(res.error || "فرمان روی دسکتاپ اجرا نشد.");
  };

  const changeVolume = async (delta: number) => {
    const api = getUms();
    if (!api) return;
    const next = Math.max(0, Math.min(100, volume + delta));
    setVolume(next);
    const res = await api.setVolume({ ...volumeTarget(device), volume: next });
    if (!res.ok) toast.error(res.error || "دستگاه تنظیم صدا را نپذیرفت.");
  };

  const toggleTvMute = async () => {
    const api = getUms();
    if (!api) return;
    const res = await api.setMute({ ...volumeTarget(device), mute: !tvMuted });
    if (res.ok) setTvMuted((m) => !m);
    else toast.error(res.error || "دستگاه فرمان بی‌صدا را نپذیرفت.");
  };

  const togglePcMute = async () => {
    const api = getUms();
    if (!api?.screenMuteLocal) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.screenMuteLocal(!pcMuted);
    if (res.ok) setPcMuted((m) => !m);
    else toast.error("تغییر صدای بلندگوی رایانه ممکن نشد.");
  };

  const stopShare = async () => {
    const api = getUms();
    if (api) {
      await api.stopScreenShare(transportTarget(device)).catch(() => null);
      await api.screenMuteLocal?.(false).catch(() => null);
    }
    closePlayer();
  };

  const btn =
    "grid size-9 place-items-center rounded-xl border border-primary/40 bg-card/80 text-foreground transition-colors hover:bg-primary/15 hover:text-primary";

  return (
    <div
      dir="rtl"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[60] w-[min(21rem,calc(100vw-2rem))] rounded-2xl border-2 border-primary/60 bg-card/95 shadow-[var(--glow-gold)] backdrop-blur"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-grab touch-none items-center gap-2 rounded-t-2xl border-b border-primary/30 bg-primary/10 px-3 py-2 active:cursor-grabbing"
      >
        <GripVertical className="size-4 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-bold text-primary text-glow">کنترل صفحه اشتراکی</p>
          <p className="flex items-center gap-1 truncate text-[11px] text-muted-foreground">
            <MonitorSpeaker className="size-3 text-primary" />
            <span className="truncate">{deviceLabel(device)}</span>
            <span dir="ltr">· {device.ip}</span>
          </p>
        </div>
        <button
          onClick={() => setCollapsed((c) => !c)}
          aria-label={collapsed ? "نمایش پنل" : "کوچک کردن پنل"}
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {collapsed ? <Play className="size-3.5" /> : <Minus className="size-3.5" />}
        </button>
        <button
          onClick={() => void stopShare()}
          aria-label="پایان اشتراک صفحه"
          className="rounded-md p-1 text-destructive transition-colors hover:bg-destructive/10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {collapsed ? null : (
        <div className="space-y-3 p-3">
          <p className="rounded-lg bg-secondary px-2 py-1.5 text-[11px] text-muted-foreground">
            صدای رایانه {pcMuted ? "قطع است" : "روشن است"} و پخش فقط از تلویزیون شنیده می‌شود.
          </p>

          <div className="flex items-center justify-between gap-1.5">
            <button onClick={() => void key("prev")} aria-label="مورد قبلی" className={btn}>
              <ChevronsRight className="size-4" />
            </button>
            <button onClick={() => void key("left", 1)} aria-label="عقب" className={btn}>
              <Rewind className="size-4" />
            </button>
            <button
              onClick={() => {
                setPlaying((p) => !p);
                void key("playpause");
              }}
              aria-label={playing ? "توقف موقت" : "پخش"}
              className="grid size-11 place-items-center rounded-2xl border-2 border-primary/70 bg-primary/15 text-primary shadow-[var(--glow-gold)] transition-colors hover:bg-primary/25"
            >
              {playing ? <Pause className="size-5" /> : <Play className="size-5" />}
            </button>
            <button onClick={() => void key("right", 1)} aria-label="جلو" className={btn}>
              <FastForward className="size-4" />
            </button>
            <button onClick={() => void key("next")} aria-label="مورد بعدی" className={btn}>
              <ChevronsLeft className="size-4" />
            </button>
          </div>

          <div className="flex items-center justify-between gap-1.5">
            <button
              onClick={() => void key("left", 6)}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent"
            >
              <Rewind className="size-3.5" /> ۳۰ ثانیه عقب
            </button>
            <button
              onClick={() => void key("fullscreen")}
              aria-label="تمام‌صفحه"
              className={btn}
            >
              <Maximize2 className="size-4" />
            </button>
            <button
              onClick={() => void key("right", 6)}
              className="inline-flex items-center gap-1 rounded-xl border border-border px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent"
            >
              ۳۰ ثانیه جلو <FastForward className="size-3.5" />
            </button>
          </div>

          <div className="flex items-center gap-1.5 rounded-xl border border-border p-1.5">
            <button onClick={() => void changeVolume(-5)} aria-label="کم کردن صدا" className={btn}>
              <Volume1 className="size-4" />
            </button>
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-secondary">
              <div className="h-full rounded-full bg-primary" style={{ width: `${volume}%` }} />
            </div>
            <span className="w-8 text-center text-[11px] text-muted-foreground" dir="ltr">
              {volume}
            </span>
            <button onClick={() => void changeVolume(5)} aria-label="زیاد کردن صدا" className={btn}>
              <Volume2 className="size-4" />
            </button>
            <button
              onClick={() => void toggleTvMute()}
              aria-label={tvMuted ? "باصدا کردن تلویزیون" : "بی‌صدا کردن تلویزیون"}
              className={btn}
            >
              {tvMuted ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />}
            </button>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              onClick={() => void togglePcMute()}
              className="flex-1 rounded-xl border border-border px-2.5 py-1.5 text-[11px] transition-colors hover:bg-accent"
            >
              {pcMuted ? "روشن کردن بلندگوی رایانه" : "قطع صدای رایانه"}
            </button>
            <button
              onClick={() => void stopShare()}
              className="inline-flex items-center gap-1 rounded-xl border border-destructive/50 px-2.5 py-1.5 text-[11px] text-destructive transition-colors hover:bg-destructive/10"
            >
              <Square className="size-3.5" /> پایان اشتراک
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
