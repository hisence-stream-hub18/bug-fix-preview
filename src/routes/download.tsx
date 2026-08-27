import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { CloudDownload, FolderOpen, Music, Trash2, Tv } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import {
  GENRES,
  GENRE_LABEL,
  detectPlatform,
  useDevices,
  useDownloads,
  useLibrary,
  type Genre,
  type TvDevice,
} from "@/lib/ums-store";
import { openPlayer } from "@/lib/player-store";
import { deviceLabel } from "@/lib/ums-store";
import { WEB_MODE_MESSAGE, getUms, type DeviceTarget } from "@/lib/ums-bridge";

function deviceTarget(device: TvDevice): DeviceTarget {
  if (device.protocol === "Cast") {
    return { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 };
  }
  return { protocol: device.protocol, controlUrl: device.avTransportUrl || "" };
}

export const Route = createFileRoute("/download")({
  head: () => ({
    meta: [
      { title: "دانلود از شبکه‌های اجتماعی | مدیا سرور" },
      {
        name: "description",
        content:
          "دانلود ویدیو از یوتیوب، اینستاگرام، تیک‌تاک، فیسبوک و آپارات و ذخیره خودکار در مخزن فیلم‌ها.",
      },
      { property: "og:title", content: "دانلود از وب" },
      { property: "og:description", content: "دریافت ویدیو از شبکه‌های اجتماعی و ذخیره در مخزن." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: DownloadPage,
});

function DownloadPage() {
  const [jobs, setJobs] = useDownloads();
  const [, setLibrary] = useLibrary();
  const [devices, setDevices] = useDevices();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [genre, setGenre] = useState<Genre>("music");
  const [target, setTarget] = useState("");
  const [audioOnly, setAudioOnly] = useState(false);

  const platform = url.trim() ? detectPlatform(url) : null;
  const online = devices.filter((d) => d.status !== "offline");
  const selectedDevice = target || online[0]?.id || "";

  // Sends the page/share link straight to the TV: the desktop backend resolves
  // it to a direct stream first, so the TV never sees an HTML page.
  const shareToTv = async (jobTitle: string, jobUrl: string) => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const device = devices.find((d) => d.id === selectedDevice);
    if (!device) {
      toast.error("ابتدا در صفحه «دستگاه‌های شبکه» تلویزیون را جست‌وجو کنید.");
      return;
    }
    if (device.protocol !== "Cast" && !device.avTransportUrl) {
      toast.error("این دستگاه سرویس AVTransport ندارد؛ دوباره جست‌وجو کنید.");
      return;
    }
    const res = await api.play({ ...deviceTarget(device), url: jobUrl, title: jobTitle });
    if (!res.ok) {
      toast.error(res.error || "تلویزیون این لینک را نپذیرفت.");
      return;
    }
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, status: "playing", nowPlaying: jobTitle } : d)),
    );
    openPlayer({ device, title: jobTitle });
    toast.success(`«${jobTitle}» روی ${deviceLabel(device)} پخش شد.`);
  };

  // Real downloads run in the desktop backend (yt-dlp for social links, direct
  // HTTP otherwise). The page mirrors the backend job list; finished files are
  // added to the library so they can be streamed to the TV straight away.
  const desktop = Boolean(getUms()?.downloadStart);

  useEffect(() => {
    const api = getUms();
    if (!api?.downloadList) return;
    let alive = true;
    const pull = async () => {
      const list = await api.downloadList!().catch(() => []);
      if (!alive || !Array.isArray(list)) return;
      setJobs(
        list
          .filter((j) => j.status !== "canceled")
          .map((j) => ({
            id: j.id,
            title: j.title,
            url: j.url,
            platform: detectPlatform(j.url),
            genre: (j.genre as Genre) || "other",
            progress: Math.round(j.progress),
            status: j.status === "canceled" ? "error" : j.status,
            createdAt: j.createdAt,
          })),
      );
      for (const j of list) {
        if (j.status !== "done" || !j.file) continue;
        setLibrary((lib) =>
          lib.some((f) => f.id === `f-${j.id}`)
            ? lib
            : [
                {
                  id: `f-${j.id}`,
                  title: j.title,
                  genre: (j.genre as Genre) || "other",
                  source: j.file || j.url,
                  sizeMb: j.sizeMb || 0,
                  addedAt: Date.now(),
                  platform: detectPlatform(j.url),
                },
                ...lib,
              ],
        );
      }
    };
    void pull();
    const timer = window.setInterval(pull, 1200);
    const off = api.onEvent?.((data) => {
      if (data?.type === "download") void pull();
    });
    return () => {
      alive = false;
      window.clearInterval(timer);
      off?.();
    };
  }, [setJobs, setLibrary]);

  const start = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("آدرس ویدیو را وارد کنید.");
      return;
    }
    const api = getUms();
    if (!api?.downloadStart) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.downloadStart({
      url: url.trim(),
      title: title.trim() || `ویدیو ${detectPlatform(url)}`,
      genre,
      audioOnly,
    });
    if (!res?.ok) {
      toast.error(res?.error || "شروع دانلود ناموفق بود.");
      return;
    }
    setUrl("");
    setTitle("");
    toast.success("دانلود واقعی شروع شد؛ پیشرفت را همین‌جا ببینید.");
  };

  const cancel = async (id: string) => {
    const api = getUms();
    if (api?.downloadCancel) await api.downloadCancel({ id }).catch(() => null);
    setJobs((prev) => prev.filter((x) => x.id !== id));
  };

  return (
    <AppLayout title="دانلود از وب" subtitle="دریافت ویدیو از شبکه‌های اجتماعی و ذخیره در مخزن">
      <form
        onSubmit={(e) => void start(e)}
        className="mb-6 grid gap-3 rounded-2xl border border-primary/30 bg-card/70 p-5 sm:grid-cols-[1.4fr_1fr_auto_auto]"
      >
        <input
          dir="ltr"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://www.youtube.com/watch?v=..."
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان دلخواه (اختیاری)"
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <select
          value={genre}
          onChange={(e) => setGenre(e.target.value as Genre)}
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        >
          {GENRES.map((g) => (
            <option key={g} value={g}>
              {GENRE_LABEL[g]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <CloudDownload className="size-4" />
          شروع دانلود
        </button>
        <div className="flex flex-wrap items-center gap-3 sm:col-span-4">
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
            <input
              type="checkbox"
              checked={audioOnly}
              onChange={(e) => setAudioOnly(e.target.checked)}
              className="size-4 accent-[var(--primary)]"
            />
            <Music className="size-3.5" /> فقط صدا (m4a)
          </label>
          <button
            type="button"
            onClick={() => void getUms()?.downloadFolder?.()}
            className="inline-flex items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
          >
            <FolderOpen className="size-3.5" /> پوشه دانلودها
          </button>
          {platform ? <span className="text-xs text-primary">پلتفرم: {platform}</span> : null}
          {!desktop ? (
            <span className="text-xs text-destructive">{WEB_MODE_MESSAGE}</span>
          ) : null}
        </div>
      </form>

      {jobs.length ? (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card/60 p-3 text-sm">
          <span className="text-muted-foreground">تلویزیون مقصد برای اشتراک:</span>
          <select
            value={selectedDevice}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {online.length ? (
              online.map((d) => (
                <option key={d.id} value={d.id}>
                  {deviceLabel(d)}
                </option>
              ))
            ) : (
              <option value="">دستگاهی پیدا نشده</option>
            )}
          </select>
        </div>
      ) : null}

      {jobs.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-card/50 p-10 text-center text-sm text-muted-foreground">
          هنوز دانلودی ثبت نشده است.
        </div>
      ) : (
        <ul className="space-y-3">
          {jobs.map((j) => (
            <li key={j.id} className="rounded-2xl border border-primary/30 bg-card/70 p-4">
              <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{j.title}</p>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">
                    {j.url}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className="rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
                    {j.platform}
                  </span>
                  <span className="rounded-md bg-primary/15 px-2 py-1 text-xs text-primary">
                    {GENRE_LABEL[j.genre]}
                  </span>
                  <button
                    onClick={() => void shareToTv(j.title, j.url)}
                    className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Tv className="size-3.5" /> اشتراک روی تلویزیون
                  </button>
                  <button
                    onClick={() => void cancel(j.id)}
                    aria-label="حذف"
                    className="rounded-lg border border-border p-2 text-destructive transition-colors hover:bg-accent"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
              <div className="mt-3 h-2 overflow-hidden rounded-full bg-secondary">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${j.progress}%` }}
                />
              </div>
              <p className="mt-1.5 text-xs text-muted-foreground">
                {j.status === "done"
                  ? "دانلود کامل شد و در مخزن فیلم‌ها ذخیره شد"
                  : j.status === "error"
                    ? "دانلود ناموفق بود؛ لینک یا اینترنت را بررسی کنید."
                    : `در حال دریافت — ${Math.round(j.progress)}٪`}
              </p>
            </li>
          ))}
        </ul>
      )}
    </AppLayout>
  );
}
