// Built-in player window (the button next to "اشتراک روی تلویزیون").
//
// Plays every source the app can store:
//   • local files / MP4 / MKV / AVI / MOV → <video> served by the local server
//   • HLS / IPTV (.m3u8)                  → hls.js (lazy)
//   • MPEG-DASH (.mpd)                    → dash.js (lazy)
//   • MPEG-TS / M2TS / FLV                → mpegts.js (lazy)
//   • YouTube                             → official privacy-friendly embed
//   • web pages (Aparat…)                 → resolved to a direct stream
//
// Extras: audio/video sync control, online subtitle translation to Persian and
// an "open in VLC" button. Every heavy engine is imported only when the format
// actually needs it, so weak devices never pay for what they do not play.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ExternalLink,
  Languages,
  Loader2,
  Maximize2,
  PlayCircle,
  Subtitles,
  Timer,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { closeInAppPlayer, useInAppPlayer } from "@/lib/player-store";
import { getUms } from "@/lib/ums-bridge";
import { hlsConfig, isLowPower } from "@/lib/perf";
import {
  AV_OFFSET_LIMIT,
  applyAudioDelay,
  readAvOffset,
  readPreviewDelay,
  startVideoDelay,
  writeAvOffset,
  type VideoDelayHandle,
} from "@/lib/av-sync";
import { openInVlc } from "@/lib/open-in-vlc";
import {
  LANGUAGE_LABEL,
  parseSubtitle,
  toVtt,
  translateCues,
} from "@/lib/subtitle-translate";
import { SubtitleSettings } from "@/components/SubtitleSettings";
import {
  DEFAULT_PREFS,
  languageLabel,
  readSubtitlePrefs,
  writeSubtitlePrefs,
  type SubtitlePrefs,
} from "@/lib/languages";
import { useLiveTranslate } from "@/lib/live-listen";

function youtubeId(url: string) {
  const m =
    /(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{6,})/i.exec(
      url,
    );
  return m ? m[1] : "";
}

type Engine = "native" | "hls" | "dash" | "mpegts";

/** Chooses the playback engine from the URL/extension. */
function pickEngine(url: string, video: HTMLVideoElement | null): Engine {
  const clean = url.split("?")[0]?.toLowerCase() ?? "";
  if (/\.m3u8$/.test(clean) || /\.m3u8(\?|$)/i.test(url)) {
    return video?.canPlayType("application/vnd.apple.mpegurl") ? "native" : "hls";
  }
  if (/\.mpd$/.test(clean)) return "dash";
  if (/\.(ts|m2ts|mts|flv)$/.test(clean)) return "mpegts";
  return "native";
}

export function InAppPlayer() {
  const item = useInAppPlayer();
  if (!item) return null;
  return (
    <PlayerWindow
      key={item.source}
      title={item.title}
      source={item.source}
      {...(item.mediaId ? { mediaId: item.mediaId } : {})}
    />
  );
}

function PlayerWindow({
  title,
  source,
  mediaId,
}: {
  title: string;
  source: string;
  mediaId?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const shellRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const delayRef = useRef<VideoDelayHandle | null>(null);
  const subtitleInputRef = useRef<HTMLInputElement | null>(null);
  // Live speech → Persian caption (listens to the film audio in real time)
  const live = useLiveTranslate("auto", "fa");

  const [src, setSrc] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [offset, setOffset] = useState(0);
  const [showSync, setShowSync] = useState(false);
  const [subtitleUrl, setSubtitleUrl] = useState("");
  const [subtitleName, setSubtitleName] = useState("");
  const [rawCues, setRawCues] = useState<ReturnType<typeof parseSubtitle>>([]);
  const [translating, setTranslating] = useState(0);
  const [detected, setDetected] = useState("");
  const [prefs, setPrefsState] = useState<SubtitlePrefs>(DEFAULT_PREFS);
  const [showSubs, setShowSubs] = useState(false);

  useEffect(() => setPrefsState(readSubtitlePrefs()), []);

  const setPrefs = (next: SubtitlePrefs) => {
    setPrefsState(next);
    writeSubtitlePrefs(next);
  };
  const ytId = youtubeId(source);
  const low = useMemo(() => isLowPower(), []);
  // CORS is only requested when the audio really has to enter WebAudio: many
  // IPTV servers send no CORS headers and would refuse a credential-less
  // cross-origin request, leaving a black screen.
  const needsCors = useMemo(() => readAvOffset() > 0, []);

  useEffect(() => setOffset(readAvOffset()), []);

  // ---------------------------------------------------------------- resolve
  useEffect(() => {
    if (ytId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const run = async () => {
      if (/^https?:\/\//i.test(source)) {
        setSrc(source);
        setLoading(false);
        return;
      }
      const api = getUms();
      if (!api) {
        setError("پخش فایل محلی فقط در نسخه دسکتاپ ممکن است.");
        setLoading(false);
        return;
      }
      try {
        const base = await api.localBase();
        let id = mediaId || "";
        if (!id) {
          const added = await api.addMedia({ id: "", title, source });
          id = added?.id || "";
        }
        if (!id) throw new Error("no id");
        if (!cancelled) setSrc(`${base}/media/${encodeURIComponent(id)}`);
      } catch {
        if (!cancelled) setError("آماده‌سازی پخش در برنامه ناموفق بود.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [source, mediaId, title, ytId]);

  // ------------------------------------------------------- attach the engine
  useEffect(() => {
    const video = videoRef.current;
    if (!video || !src) return;
    const engine = pickEngine(src, video);
    let cancelled = false;
    let destroy = () => {};

    if (engine === "native") {
      video.src = src;
    } else if (engine === "hls") {
      void import("hls.js").then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          video.src = src;
          return;
        }
        const hls = new Hls(hlsConfig());
        hls.loadSource(src);
        hls.attachMedia(video);
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return;
          if (data.type === Hls.ErrorTypes.NETWORK_ERROR) hls.startLoad();
          else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) hls.recoverMediaError();
          else setError("این استریم در پلیر داخلی باز نشد.");
        });
        destroy = () => hls.destroy();
      });
    } else if (engine === "dash") {
      void import("dashjs").then((mod) => {
        if (cancelled) return;
        const dash = mod.MediaPlayer().create();
        dash.updateSettings({
          streaming: { buffer: { bufferTimeAtTopQuality: low ? 8 : 20 } },
        });
        dash.initialize(video, src, true);
        destroy = () => dash.reset();
      });
    } else {
      void import("mpegts.js").then((mod) => {
        if (cancelled) return;
        const mpegts = mod.default ?? mod;
        if (!mpegts.isSupported()) {
          video.src = src;
          return;
        }
        const player = mpegts.createPlayer(
          { type: /\.flv(\?|$)/i.test(src) ? "flv" : "mpegts", url: src, isLive: true },
          { enableWorker: !low, liveBufferLatencyChasing: true, lazyLoad: false },
        );
        player.attachMediaElement(video);
        player.load();
        destroy = () => {
          try {
            player.destroy();
          } catch {
            /* ignore */
          }
        };
      });
    }

    return () => {
      cancelled = true;
      destroy();
    };
  }, [src, low]);

  // -------------------------------------------------------------- A/V sync
  const applyOffset = useCallback((ms: number) => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video) return;
    if (ms >= 0) {
      delayRef.current?.stop();
      delayRef.current = null;
      if (!applyAudioDelay(video, ms) && ms > 0) {
        toast.error("تنظیم تأخیر صدا برای این منبع ممکن نیست (محدودیت CORS).");
      }
    } else {
      applyAudioDelay(video, 0);
      if (!canvas) return;
      if (!delayRef.current) delayRef.current = startVideoDelay(video, canvas, Math.abs(ms));
      else delayRef.current.setDelay(Math.abs(ms));
    }
  }, []);

  useEffect(() => {
    applyOffset(offset);
  }, [offset, src, applyOffset]);

  useEffect(
    () => () => {
      delayRef.current?.stop();
      delayRef.current = null;
    },
    [],
  );

  // ------------------------------------------------- TV delay compensation
  // The TV buffer cannot be removed, so the in-app preview is deliberately held
  // the same number of milliseconds behind the live edge: both screens then
  // show the same moment.
  useEffect(() => {
    const video = videoRef.current;
    const delayMs = readPreviewDelay();
    if (!video || !src || !delayMs) return;
    const id = window.setInterval(() => {
      const range = video.seekable;
      if (!range || !range.length) return;
      const end = range.end(range.length - 1);
      const target = end - delayMs / 1000;
      if (target <= range.start(0)) return;
      if (Math.abs(video.currentTime - target) > 0.8) {
        try {
          video.currentTime = target;
        } catch {
          /* not seekable yet */
        }
      }
    }, 2000);
    return () => window.clearInterval(id);
  }, [src]);

  const changeOffset = (ms: number) => {
    const clamped = Math.max(-AV_OFFSET_LIMIT, Math.min(AV_OFFSET_LIMIT, Math.round(ms)));
    setOffset(clamped);
    writeAvOffset(clamped);
  };

  // ------------------------------------------------------------- subtitles
  const loadSubtitleFile = async (file: File) => {
    const text = await file.text();
    const cues = parseSubtitle(text);
    if (!cues.length) {
      toast.error("این فایل زیرنویس خوانده نشد.");
      return;
    }
    setRawCues(cues);
    setDetected("");
    setSubtitleName(file.name);
    const blob = new Blob([toVtt(cues, prefs.offsetMs)], { type: "text/vtt" });
    setSubtitleUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(blob);
    });
    toast.success(`زیرنویس «${file.name}» بارگذاری شد.`);
  };

  const translateToPersian = async () => {
    const target = prefs.target || "fa";
    if (!rawCues.length) {
      toast.error("ابتدا یک فایل زیرنویس انتخاب کنید.");
      return;
    }
    setTranslating(1);
    try {
      const res = await translateCues(
        rawCues,
        target,
        (done, total) => setTranslating(Math.max(1, Math.round((done / total) * 100))),
        prefs.source || "auto",
      );
      const blob = new Blob([toVtt(res.cues, prefs.offsetMs)], { type: "text/vtt" });
      setSubtitleUrl((old) => {
        if (old) URL.revokeObjectURL(old);
        return URL.createObjectURL(blob);
      });
      setDetected(res.detected);
      toast.success(
        `زیرنویس از ${LANGUAGE_LABEL[res.detected] || res.detected} به ${languageLabel(target)} ترجمه شد.`,
      );
    } catch {
      toast.error("ترجمه آنلاین انجام نشد؛ اتصال اینترنت را بررسی کنید.");
    } finally {
      setTranslating(0);
    }
  };

  const openOutside = () => {
    const api = getUms();
    if (api && /^https?:\/\//i.test(source)) void api.openExternal(source);
    else toast.error("این مورد لینک اینترنتی نیست.");
  };

  const toggleFullscreen = () => {
    const el = shellRef.current;
    if (!el) return;
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => null);
    else void el.requestFullscreen?.().catch(() => null);
  };

  const negative = offset < 0;

  return (
    <div
      dir="rtl"
      ref={shellRef}
      className="fixed inset-0 z-[60] flex flex-col overflow-auto bg-black"
    >
      <div className="flex items-center gap-2 border-b border-primary/30 bg-primary/10 px-4 py-2">
        <button
          onClick={() => setShowSync((v) => !v)}
          aria-label="تنظیم همخوانی صدا و تصویر"
          title="همخوانی صدا و تصویر"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Timer className="size-4" />
        </button>
        <button
          onClick={() => void openInVlc(src || source, title)}
          aria-label="پخش در VLC"
          title="پخش در VLC"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <PlayCircle className="size-4" />
        </button>
        <button
          onClick={openOutside}
          aria-label="باز کردن در مرورگر"
          className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <ExternalLink className="size-4" />
        </button>
        <button
          onClick={toggleFullscreen}
          aria-label="تمام‌صفحه"
          title="تمام‌صفحه"
          className="rounded-md p-1.5 text-primary transition-colors hover:bg-primary/15"
        >
          <Maximize2 className="size-4" />
        </button>
        <span className="flex-1" />
        <button
          onClick={closeInAppPlayer}
          aria-label="بستن پلیر داخلی"
          className="rounded-md p-1.5 text-destructive transition-colors hover:bg-destructive/10"
        >
          <X className="size-4" />
        </button>
      </div>

      <div className="relative min-h-0 flex-1 bg-black">

          {ytId ? (
            <iframe
              title={title}
              src={`https://www.youtube-nocookie.com/embed/${ytId}?autoplay=1&rel=0`}
              allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              className="size-full border-0"
            />
          ) : error ? (
            <div className="grid size-full place-items-center px-6 text-center text-sm text-destructive">
              {error}
            </div>
          ) : loading ? (
            <div className="relative grid size-full place-items-center overflow-hidden bg-background">
              <div
                className="absolute inset-0 bg-cover bg-center opacity-30"
                style={{ backgroundImage: "url(/splash-bg.jpg)" }}
              />
              <div className="absolute inset-0 bg-gradient-to-b from-background/60 via-background/30 to-background" />
              <div className="relative flex flex-col items-center gap-4 px-6 text-center">
                <img
                  src="/app-logo.png"
                  alt="Universal Media Server"
                  className="w-[min(38vw,200px)] animate-pulse drop-shadow-[0_0_40px_rgba(255,190,60,0.4)]"
                />
                <p className="text-xs font-semibold tracking-widest text-primary">
                  UNIVERSAL MEDIA SERVER
                </p>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="size-4 animate-spin text-primary" />
                  در حال آماده‌سازی پخش…
                </div>
              </div>
            </div>

          ) : (
            <>
              <video
                ref={videoRef}
                controls
                autoPlay
                playsInline
                {...(needsCors ? { crossOrigin: "anonymous" as const } : {})}
                preload={low ? "metadata" : "auto"}
                onError={() => setError("پخش این منبع در پلیر داخلی پشتیبانی نشد.")}
                className={`size-full bg-black ${negative ? "invisible absolute inset-0" : ""}`}
              >
                {subtitleUrl ? (
                  <track
                    key={subtitleUrl}
                    default
                    kind="subtitles"
                    srcLang="fa"
                    label="فارسی"
                    src={subtitleUrl}
                  />
                ) : null}
              </video>
              {negative ? (
                <canvas ref={canvasRef} className="size-full bg-black object-contain" />
              ) : null}
              {live.active && live.caption ? (
                <p className="pointer-events-none absolute inset-x-4 bottom-16 rounded-lg bg-black/70 px-3 py-2 text-center text-sm text-white">
                  {live.caption}
                </p>
              ) : null}
            </>
          )}
        </div>

        {showSync ? (
          <div className="space-y-3 border-t border-border px-4 py-3">
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">صدا زودتر</span>
              <input
                type="range"
                min={-AV_OFFSET_LIMIT}
                max={AV_OFFSET_LIMIT}
                step={50}
                value={offset}
                onChange={(e) => changeOffset(Number(e.target.value))}
                className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
                aria-label="اختلاف زمانی صدا و تصویر"
              />
              <span className="text-xs text-muted-foreground">تصویر زودتر</span>
              <span className="w-16 text-center text-xs font-semibold text-primary" dir="ltr">
                {offset > 0 ? "+" : ""}
                {offset} ms
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {[-500, -100, 0, 100, 500].map((step) => (
                <button
                  key={step}
                  onClick={() => changeOffset(step === 0 ? 0 : offset + step)}
                  className="rounded-md border border-border px-2 py-1 transition-colors hover:bg-accent"
                >
                  {step === 0 ? "صفر" : `${step > 0 ? "+" : ""}${step}`}
                </button>
              ))}
              <span className="text-muted-foreground">
                {offset > 0
                  ? "صدا با تأخیر پخش می‌شود تا با تصویر برابر شود."
                  : offset < 0
                    ? "تصویر با تأخیر نمایش داده می‌شود تا به صدا برسد."
                    : "بدون اختلاف؛ در صورت ناهماهنگی اسلایدر را جابه‌جا کنید."}
              </span>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-t border-border px-4 py-3">
          <input
            ref={subtitleInputRef}
            type="file"
            accept=".srt,.vtt,.ass,.ssa,.sub,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) void loadSubtitleFile(file);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => subtitleInputRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
          >
            <Subtitles className="size-3.5" />
            انتخاب زیرنویس
          </button>
          <button
            onClick={() => void translateToPersian()}
            disabled={!rawCues.length || translating > 0}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {translating > 0 ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Languages className="size-3.5" />
            )}
            {translating > 0
              ? `ترجمه… ${translating}%`
              : `ترجمه آنلاین به ${languageLabel(prefs.target || "fa")}`}
          </button>
          <button
            onClick={() => setShowSubs((v) => !v)}
            className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
          >
            <Subtitles className="size-3.5" />
            تنظیمات زیرنویس
          </button>
          <button
            onClick={() => (live.active ? live.stop() : live.start())}
            disabled={!live.supported}
            className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-xs transition-colors disabled:opacity-40 ${
              live.active ? "border-primary bg-primary/15 text-primary" : "border-border hover:bg-accent"
            }`}
            title="صدای فیلم را می‌شنود و هم‌زمان به فارسی زیرنویس می‌کند"
          >
            <Languages className="size-3.5" />
            {live.active ? "توقف ترجمه هم‌زمان صدا" : "ترجمه هم‌زمان صدا"}
          </button>
          <span className="truncate text-[11px] text-muted-foreground">
            {live.error ||
              (live.active ? "در حال شنیدن صدا…" : "")}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">
            {subtitleName
              ? `${subtitleName}${detected ? ` — زبان اصلی: ${LANGUAGE_LABEL[detected] || detected}` : ""}`
              : "زبان مبدأ به‌صورت خودکار تشخیص داده می‌شود."}
          </span>
        </div>

      {showSubs ? <SubtitleSettings prefs={prefs} onChange={setPrefs} /> : null}

      <style>{`video::cue{font-size:${prefs.size}%}`}</style>
    </div>

  );
}
