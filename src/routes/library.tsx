import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { Captions, Cast, Copy, Film, MonitorPlay, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { VlcButton } from "@/components/VlcButton";
import { openInAppPlayer, openPlayer } from "@/lib/player-store";
import {
  GENRES,
  GENRE_LABEL,
  libraryStreamUrl,
  useDevices,
  useLibrary,
  usePlaylist,
  useSettings,
  type Genre,
  type TvDevice,
} from "@/lib/ums-store";
import { WEB_MODE_MESSAGE, getUms, useDesktop, type DeviceTarget } from "@/lib/ums-bridge";
import { healthDotClass, healthTitle, useStreamHealth } from "@/lib/health";

/** Cast devices are addressed by ip:port, DLNA renderers by their SOAP URL. */
function deviceTarget(device: TvDevice): DeviceTarget {
  return device.protocol === "Cast"
    ? { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 }
    : { protocol: device.protocol, controlUrl: device.avTransportUrl || "" };
}

export const Route = createFileRoute("/library")({
  head: () => ({
    meta: [
      { title: "مخزن فیلم‌ها | مدیا سرور" },
      {
        name: "description",
        content:
          "سازماندهی فیلم‌ها و ویدیوها بر اساس ژانر اکشن، درام، خانوادگی و موزیک ویدیو و اشتراک آن‌ها روی تلویزیون.",
      },
      { property: "og:title", content: "مخزن فیلم‌ها" },
      {
        property: "og:description",
        content: "کتابخانه ویدیویی دسته‌بندی‌شده برای پخش روی تلویزیون.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: LibraryPage,
});

function LibraryPage() {
  const [library, setLibrary] = useLibrary();
  const [devices, setDevices] = useDevices();
  const [settings] = useSettings();
  const [, setPlaylist] = usePlaylist();

  const [filter, setFilter] = useState<Genre | "all">("all");
  const [title, setTitle] = useState("");
  const [source, setSource] = useState("");
  const [genre, setGenre] = useState<Genre>("action");

  const online = devices.filter((d) => d.status !== "offline");
  const [target, setTarget] = useState("");
  const selectedDevice = target || online[0]?.id || "";

  const shown = useMemo(
    () => (filter === "all" ? library : library.filter((f) => f.genre === filter)),
    [library, filter],
  );

  const desktop = useDesktop();
  const health = useStreamHealth(
    shown.map((f) => f.source),
    Boolean(desktop && shown.length),
  );


  const counts = useMemo(() => {
    const map: Partial<Record<Genre, number>> = {};
    for (const f of library) map[f.genre] = (map[f.genre] ?? 0) + 1;
    return map;
  }, [library]);

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !source.trim()) {
      toast.error("عنوان و مسیر/آدرس فایل را وارد کنید.");
      return;
    }
    setLibrary((prev) => [
      {
        id: `f-${Date.now().toString(36)}`,
        title: title.trim(),
        genre,
        source: source.trim(),
        sizeMb: 0,
        addedAt: Date.now(),
      },
      ...prev,
    ]);
    setTitle("");
    setSource("");
    toast.success("فایل به مخزن اضافه شد.");
  };

  const pickSubtitle = async (fileId: string) => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const picked = await api.pickSubtitle({ mediaId: fileId });
    if (!picked) return;
    setLibrary((prev) =>
      prev.map((f) =>
        f.id === fileId ? { ...f, subtitle: picked.path, subtitleName: picked.name } : f,
      ),
    );
    toast.success(`زیرنویس «${picked.name}» به این فایل وصل شد.`);
  };

  const share = async (id: string) => {
    const file = library.find((f) => f.id === id);
    const device = devices.find((d) => d.id === selectedDevice);
    if (!file || !device) {
      toast.error("دستگاه آنلاینی برای اشتراک‌گذاری وجود ندارد.");
      return;
    }
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    if (device.protocol !== "Cast" && !device.avTransportUrl) {
      toast.error("این دستگاه سرویس AVTransport ندارد؛ دوباره جست‌وجو کنید.");
      return;
    }
    let res;
    try {
      res = await api.play({
        ...deviceTarget(device),
        mediaId: file.id,
        title: file.title,
        ...(file.subtitle ? { subtitle: file.subtitle } : {}),
      });
    } catch {
      toast.error("ارسال به تلویزیون ناموفق بود؛ دوباره تلاش کنید.");
      return;
    }
    if (!res.ok) {
      toast.error(res.error || "تلویزیون پخش را نپذیرفت.");
      return;
    }
    setDevices((prev) =>
      prev.map((d) =>
        d.id === device.id ? { ...d, status: "playing", nowPlaying: file.title } : d,
      ),
    );
    setPlaylist((prev) => [
      {
        id: `m-${file.id}`,
        title: file.title,
        url: res.url || libraryStreamUrl(file, settings),
        kind: "http",
        addedAt: Date.now(),
        lastPlayedAt: Date.now(),
        ...(file.subtitle ? { subtitle: file.subtitle, subtitleName: file.subtitleName } : {}),
      },
      ...prev.filter((p) => p.id !== `m-${file.id}`),
    ]);
    openPlayer({ device, title: file.title });
    toast.success(`«${file.title}» روی ${device.name} پخش شد.`);
  };

  return (
    <AppLayout title="مخزن فیلم‌ها" subtitle="ذخیره و سازماندهی ویدیوها بر اساس ژانر">
      <form
        onSubmit={add}
        className="mb-5 grid gap-3 rounded-2xl border border-primary/30 bg-card/70 p-4 sm:grid-cols-[1fr_1fr_auto_auto]"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان فیلم"
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <div className="flex gap-2">
          <input
            dir="ltr"
            value={source}
            onChange={(e) => setSource(e.target.value)}
            placeholder="D:\Movies\file.mp4 یا https://..."
            className="min-w-0 flex-1 rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
          <button
            type="button"
            onClick={async () => {
              const api = getUms();
              if (!api) {
                toast.error(WEB_MODE_MESSAGE);
                return;
              }
              const picked = await api.pickFiles();
              if (!picked.length) return;
              setSource(picked[0]!.path);
              if (!title.trim()) setTitle(picked[0]!.name.replace(/\.[^.]+$/, ""));
            }}
            className="shrink-0 rounded-lg border border-border px-3 text-xs transition-colors hover:bg-accent"
          >
            انتخاب فایل
          </button>
        </div>
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
          <Plus className="size-4" />
          افزودن
        </button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            filter === "all"
              ? "border-primary/60 bg-primary/15 text-primary"
              : "border-border text-muted-foreground hover:bg-accent"
          }`}
        >
          همه ({library.length})
        </button>
        {GENRES.map((g) => (
          <button
            key={g}
            onClick={() => setFilter(g)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === g
                ? "border-primary/60 bg-primary/15 text-primary"
                : "border-border text-muted-foreground hover:bg-accent"
            }`}
          >
            {GENRE_LABEL[g]} ({counts[g] ?? 0})
          </button>
        ))}

        <div className="ms-auto flex items-center gap-2">
          <span className="text-xs text-muted-foreground">تلویزیون مقصد:</span>
          <select
            value={selectedDevice}
            onChange={(e) => setTarget(e.target.value)}
            className="rounded-lg border border-input bg-background px-3 py-2 text-xs outline-none focus:border-primary"
          >
            {online.length === 0 ? <option value="">دستگاه آنلاینی نیست</option> : null}
            {online.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-card/50 p-10 text-center text-sm text-muted-foreground">
          فایلی در این دسته وجود ندارد.
        </div>
      ) : (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {shown.map((file) => (
            <li
              key={file.id}
              className="rounded-2xl border border-primary/30 bg-card/70 p-4 shadow-[var(--glow-gold)]"
            >
              <div className="flex items-start gap-3">
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Film className="size-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-2 truncate font-medium">
                    <span
                      title={healthTitle(health.statusOf(file.source))}
                      className={`inline-block size-2.5 shrink-0 rounded-full ${healthDotClass(
                        health.statusOf(file.source),
                      )}`}
                    />
                    <span className="truncate">{file.title}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-primary">
                    {GENRE_LABEL[file.genre]}
                    {file.platform ? ` — ${file.platform}` : ""}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">
                    {file.source}
                  </p>
                  <p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">
                    {libraryStreamUrl(file, settings)}
                  </p>
                  {file.subtitleName ? (
                    <p className="mt-1 truncate text-xs text-primary">
                      زیرنویس: {file.subtitleName}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <button
                  onClick={() =>
                    openInAppPlayer({ title: file.title, source: file.source, mediaId: file.id })
                  }
                  aria-label="پخش در برنامه"
                  title="پخش در برنامه"
                  className="rounded-lg border border-primary/40 p-2 text-primary transition-colors hover:bg-accent"
                >
                  <MonitorPlay className="size-4" />
                </button>
          <VlcButton url={file.source} title={file.title} />
                <button
                  onClick={() => void share(file.id)}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                >
                  <Cast className="size-4" />
                  اشتراک روی تلویزیون
                </button>
                <button
                  onClick={() => void pickSubtitle(file.id)}
                  aria-label="انتخاب فایل زیرنویس"
                  title={file.subtitleName ? `زیرنویس: ${file.subtitleName}` : "انتخاب زیرنویس"}
                  className={`rounded-lg border p-2 transition-colors hover:bg-accent ${
                    file.subtitle ? "border-primary text-primary" : "border-border"
                  }`}
                >
                  <Captions className="size-4" />
                </button>
                <button
                  onClick={() => {
                    navigator.clipboard
                      .writeText(libraryStreamUrl(file, settings))
                      .then(() => toast.success("آدرس کپی شد."))
                      .catch(() => toast.error("کپی انجام نشد."));
                  }}
                  aria-label="کپی آدرس"
                  className="rounded-lg border border-border p-2 transition-colors hover:bg-accent"
                >
                  <Copy className="size-4" />
                </button>
                <button
                  onClick={() => setLibrary((prev) => prev.filter((f) => f.id !== file.id))}
                  aria-label="حذف فایل"
                  className="rounded-lg border border-border p-2 text-destructive transition-colors hover:bg-accent"
                >
                  <Trash2 className="size-4" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppLayout>
  );
}
