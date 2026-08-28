// Floating sync tuner for the mirrored desktop.
//
// While the desktop is shared to the TV the picture can drift behind the real
// screen (buffering) or turn into slow motion (the encoder cannot keep up with
// the chosen fps/bitrate). This little popup floats over the desktop and shows
// two vertical bars — capture load and TV closeness — plus two vertical
// sliders the user can drag by hand until the TV matches the desktop.

import { useCallback, useEffect, useRef, useState } from "react";
import { Activity, GripVertical, Minus, Timer, Wand2, X } from "lucide-react";
import { toast } from "sonner";
import { getUms, type ScreenMetrics } from "@/lib/ums-bridge";
import { usePlayerSession } from "@/lib/player-store";

function Bar({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: number;
  hint: string;
  tone: "primary" | "accent";
}) {
  const v = Math.max(0, Math.min(100, Math.round(value)));
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative h-32 w-6 overflow-hidden rounded-full border border-border bg-secondary">
        <div
          className={`absolute inset-x-0 bottom-0 rounded-full transition-all duration-500 ${
            tone === "primary" ? "bg-primary" : "bg-chart-2"
          }`}
          style={{ height: `${v}%` }}
        />
      </div>
      <span className="text-[11px] font-bold text-primary" dir="ltr">
        {v}%
      </span>
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <span className="max-w-[5.5rem] text-center text-[9px] leading-tight text-muted-foreground/80">
        {hint}
      </span>
    </div>
  );
}

export function ScreenSyncPanel() {
  const { session } = usePlayerSession();
  const live = Boolean(session?.live);

  const [pos, setPos] = useState({ x: 24, y: 220 });
  const [open, setOpen] = useState(true);
  const [hidden, setHidden] = useState(false);
  const [metrics, setMetrics] = useState<ScreenMetrics | null>(null);
  const [bufferMs, setBufferMs] = useState(700);
  const [fps, setFps] = useState(20);
  const [busy, setBusy] = useState(false);
  const drag = useRef<{ dx: number; dy: number } | null>(null);
  const applyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Poll the live capture numbers while the share is running.
  useEffect(() => {
    if (!live || hidden) return;
    const api = getUms();
    if (!api?.screenMetrics) return;
    let alive = true;
    const tick = async () => {
      const m = await api.screenMetrics?.().catch(() => null);
      if (alive && m) {
        setMetrics(m);
        setBufferMs((b) => (b === 700 && m.bufferMs ? m.bufferMs : b));
        setFps((f) => (f === 20 && m.targetFps ? m.targetFps : f));
      }
    };
    void tick();
    const id = setInterval(tick, 1500);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [live, hidden]);

  const apply = useCallback((patch: { bufferMs?: number; fps?: number; kbps?: number }) => {
    if (applyTimer.current) clearTimeout(applyTimer.current);
    applyTimer.current = setTimeout(async () => {
      const api = getUms();
      if (!api?.screenTune) return;
      setBusy(true);
      const res = await api.screenTune(patch).catch(() => ({ ok: false }));
      setBusy(false);
      if (!res?.ok) toast.error("تنظیم جدید اعمال نشد؛ دوباره تلاش کنید.");
    }, 450);
  }, []);

  if (!live || hidden) return null;

  const onPointerDown = (e: React.PointerEvent) => {
    drag.current = { dx: e.clientX - pos.x, dy: e.clientY - pos.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    setPos({
      x: Math.max(0, Math.min(window.innerWidth - 260, e.clientX - d.dx)),
      y: Math.max(0, Math.min(window.innerHeight - 80, e.clientY - d.dy)),
    });
  };
  const onPointerUp = () => {
    drag.current = null;
  };

  // One click: shortest buffer the TV tolerates + an fps the machine can hold.
  const autoSync = () => {
    const safeFps = metrics && metrics.capture < 80 ? 15 : 24;
    setBufferMs(300);
    setFps(safeFps);
    apply({ bufferMs: 300, fps: safeFps });
    toast.success("هماهنگ‌سازی خودکار اعمال شد؛ چند ثانیه صبر کنید.");
  };

  const delaySec = ((metrics?.delayMs ?? bufferMs) / 1000).toFixed(1);

  return (
    <div
      dir="rtl"
      style={{ left: pos.x, top: pos.y }}
      className="fixed z-[61] w-[min(16rem,calc(100vw-2rem))] rounded-2xl border-2 border-primary/60 bg-card/95 shadow-[var(--glow-gold)] backdrop-blur"
    >
      <div
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        className="flex cursor-grab touch-none items-center gap-2 rounded-t-2xl border-b border-primary/30 bg-primary/10 px-3 py-2 active:cursor-grabbing"
      >
        <GripVertical className="size-4 text-primary" />
        <p className="min-w-0 flex-1 truncate text-xs font-bold text-primary text-glow">
          هماهنگی تصویر تلویزیون
        </p>
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "کوچک کردن" : "نمایش"}
          className="cursor-pointer rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          {open ? <Minus className="size-3.5" /> : <Activity className="size-3.5" />}
        </button>
        <button
          onClick={() => setHidden(true)}
          aria-label="بستن پنل هماهنگی"
          className="cursor-pointer rounded-md p-1 text-destructive transition-colors hover:bg-destructive/10"
        >
          <X className="size-3.5" />
        </button>
      </div>

      {open ? (
        <div className="space-y-3 p-3">
          <div className="flex items-start justify-around gap-2">
            <Bar
              label="پردازش ارسال"
              value={metrics?.capture ?? 0}
              hint="اگر کم است، تصویر روی تلویزیون کند/اسلوموشن می‌شود"
              tone="primary"
            />
            <Bar
              label="همزمانی با دسکتاپ"
              value={metrics?.delivery ?? 0}
              hint="هرچه بالاتر، تصویر تلویزیون به دسکتاپ نزدیک‌تر است"
              tone="accent"
            />
          </div>

          <div className="flex items-stretch justify-around gap-3 rounded-xl border border-border p-2">
            <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
              <span className="flex items-center gap-1">
                <Timer className="size-3 text-primary" /> تأخیر
              </span>
              <input
                type="range"
                min={200}
                max={4000}
                step={100}
                value={bufferMs}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setBufferMs(v);
                  apply({ bufferMs: v });
                }}
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
                className="h-28 cursor-pointer accent-primary"
                aria-label="تنظیم دستی تأخیر تصویر تلویزیون"
              />
              <span dir="ltr" className="text-[10px] text-foreground">
                {bufferMs} ms
              </span>
            </label>

            <label className="flex flex-col items-center gap-1 text-[10px] text-muted-foreground">
              <span>روانی (FPS)</span>
              <input
                type="range"
                min={10}
                max={60}
                step={1}
                value={fps}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setFps(v);
                  apply({ fps: v });
                }}
                style={{ writingMode: "vertical-lr", direction: "rtl" }}
                className="h-28 cursor-pointer accent-primary"
                aria-label="تنظیم دستی تعداد فریم در ثانیه"
              />
              <span dir="ltr" className="text-[10px] text-foreground">
                {fps}
              </span>
            </label>
          </div>

          <p className="rounded-lg bg-secondary px-2 py-1.5 text-[10px] leading-relaxed text-muted-foreground">
            اختلاف تقریبی با دسکتاپ: <span dir="ltr">{delaySec}s</span> · نرخ واقعی{" "}
            <span dir="ltr">{metrics?.kbps ?? 0} kbps</span>
            {metrics?.hw ? " · شتاب سخت‌افزاری فعال" : " · پردازش نرم‌افزاری"}
          </p>

          <button
            onClick={autoSync}
            disabled={busy}
            className="inline-flex w-full cursor-pointer items-center justify-center gap-1 rounded-xl border border-primary/50 bg-primary/10 px-2.5 py-1.5 text-[11px] font-bold text-primary transition-colors hover:bg-primary/20 disabled:opacity-60"
          >
            <Wand2 className="size-3.5" /> هماهنگ‌سازی خودکار
          </button>
        </div>
      ) : null}
    </div>
  );
}
