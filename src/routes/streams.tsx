import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { FolderPlus, MonitorPlay, Plus, Radio, RefreshCw, Search, Star, Trash2, Tv } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { VlcButton } from "@/components/VlcButton";
import { openInAppPlayer, openPlayer } from "@/lib/player-store";
import {
  STREAM_CATEGORIES,
  STREAM_CATEGORY_LABEL,
  detectKind,
  deviceLabel,
  guessStreamCategory,
  useDevices,
  useStreamVault,
  type SavedStream,
  type StreamCategory,
  type TvDevice,
} from "@/lib/ums-store";
import { WEB_MODE_MESSAGE, getUms, type DeviceTarget } from "@/lib/ums-bridge";
import { healthDotClass, healthTitle, useStreamHealth } from "@/lib/health";

function deviceTarget(device: TvDevice): DeviceTarget {
  return device.protocol === "Cast"
    ? { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 }
    : { protocol: device.protocol, controlUrl: device.avTransportUrl || "" };
}

export const Route = createFileRoute("/streams")({
  head: () => ({
    meta: [
      { title: "مخزن استریم ماهواره و شبکه اجتماعی | مدیا سرور" },
      {
        name: "description",
        content:
          "ذخیره دائمی کانال‌های ماهواره‌ای، شبکه‌های اجتماعی و لینک‌های استریم در دیتابیس نرم‌افزار و پخش آن‌ها روی تلویزیون یا پلیر داخلی.",
      },
      { property: "og:title", content: "مخزن استریم ماهواره و شبکه اجتماعی" },
      {
        property: "og:description",
        content: "کانال‌های ذخیره‌شده به‌صورت آفلاین در دسترس‌اند و با یک کلیک پخش می‌شوند.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: StreamVaultPage,
});

function StreamVaultPage() {
  const [vault, setVault] = useStreamVault();
  const [devices, setDevices] = useDevices();

  const [filter, setFilter] = useState<StreamCategory | "all">("all");
  const [query, setQuery] = useState("");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [category, setCategory] = useState<StreamCategory>("satellite");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [folderFilter, setFolderFilter] = useState("all");

  // Green / red dot: is this channel alive right now?
  const health = useStreamHealth(vault.map((s) => s.url));

  const folders = useMemo(
    () => Array.from(new Set(vault.map((s) => s.folder).filter(Boolean) as string[])).sort(),
    [vault],
  );

  const online = devices.filter((d) => d.status !== "offline");
  const [target, setTarget] = useState("");
  const selectedDevice = target || online[0]?.id || "";

  const counts = useMemo(() => {
    const map: Partial<Record<StreamCategory, number>> = {};
    for (const s of vault) map[s.category] = (map[s.category] ?? 0) + 1;
    return map;
  }, [vault]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return vault.filter(
      (s) =>
        (filter === "all" || s.category === filter) &&
        (!onlyFavorites || s.favorite) &&
        (folderFilter === "all" || (s.folder || "") === folderFilter) &&
        (!q || s.title.toLowerCase().includes(q) || s.url.toLowerCase().includes(q)),
    );
  }, [vault, filter, query, onlyFavorites, folderFilter]);

  const patch = (id: string, changes: Partial<SavedStream>) =>
    setVault((prev) => prev.map((s) => (s.id === id ? { ...s, ...changes } : s)));

  const moveToFolder = (item: SavedStream) => {
    const name = window.prompt("نام پوشه گروه‌بندی مورد علاقه:", item.folder || "");
    if (name === null) return;
    patch(item.id, { folder: name.trim() });
    toast.success(name.trim() ? `در پوشه «${name.trim()}» ذخیره شد.` : "از پوشه خارج شد.");
  };

  const add = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("آدرس استریم را وارد کنید.");
      return;
    }
    const item: SavedStream = {
      id: `s-${Date.now().toString(36)}`,
      title: title.trim() || url.trim().slice(0, 60),
      url: url.trim(),
      category,
      kind: detectKind(url),
      addedAt: Date.now(),
    };
    setVault((prev) => [item, ...prev]);
    setTitle("");
    setUrl("");
    toast.success("استریم در مخزن ذخیره شد.");
  };

  const remove = (id: string) => {
    setVault((prev) => prev.filter((s) => s.id !== id));
    toast.success("از مخزن حذف شد.");
  };

  const share = async (item: SavedStream) => {
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
    let res;
    try {
      res = await api.play({
        ...deviceTarget(device),
        url: item.url,
        title: item.title,
        mime: /\.m3u8(\?|$)/i.test(item.url)
          ? "application/vnd.apple.mpegurl"
          : /\.ts(\?|$)/i.test(item.url)
            ? "video/mp2t"
            : "video/mp4",
      });
    } catch {
      toast.error("ارسال این استریم به تلویزیون ناموفق بود؛ دوباره تلاش کنید.");
      return;
    }
    if (!res.ok) {
      // A newer "share" press superseded this one — that is normal, not an error.
      if (res.superseded) return;
      toast.error(res.error || "تلویزیون این استریم را نپذیرفت.");
      return;
    }
    setDevices((prev) =>
      prev.map((d) => (d.id === device.id ? { ...d, status: "playing", nowPlaying: item.title } : d)),
    );
    setVault((prev) =>
      prev.map((s) => (s.id === item.id ? { ...s, lastPlayedAt: Date.now() } : s)),
    );
    openPlayer({ device, title: item.title });
    toast.success(`«${item.title}» روی ${deviceLabel(device)} پخش شد.`);
  };

  return (
    <AppLayout
      title="مخزن استریم ماهواره و شبکه اجتماعی"
      subtitle="کانال‌ها و لینک‌های استریم به‌صورت دائمی ذخیره می‌شوند و در حالت آفلاین هم در دسترس‌اند"
    >
      <form
        onSubmit={add}
        className="mb-5 grid gap-3 rounded-2xl border border-primary/30 bg-card/70 p-5 sm:grid-cols-[1fr_1.4fr_auto_auto]"
      >
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="عنوان کانال"
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <input
          dir="ltr"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (e.target.value.trim()) setCategory(guessStreamCategory(e.target.value));
          }}
          placeholder="https://example.com/live/channel.m3u8"
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        />
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as StreamCategory)}
          className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
        >
          {STREAM_CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {STREAM_CATEGORY_LABEL[c]}
            </option>
          ))}
        </select>
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-4" /> ذخیره
        </button>
      </form>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter("all")}
          className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
            filter === "all"
              ? "border-primary bg-primary/15 text-primary"
              : "border-primary/30 text-muted-foreground hover:bg-accent"
          }`}
        >
          همه ({vault.length})
        </button>
        {STREAM_CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setFilter(c)}
            className={`rounded-full border px-3 py-1.5 text-xs transition-colors ${
              filter === c
                ? "border-primary bg-primary/15 text-primary"
                : "border-primary/30 text-muted-foreground hover:bg-accent"
            }`}
          >
            {STREAM_CATEGORY_LABEL[c]} ({counts[c] ?? 0})
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setOnlyFavorites((v) => !v)}
          className={`inline-flex items-center gap-1 rounded-full border px-3 py-1.5 text-xs transition-colors ${
            onlyFavorites
              ? "border-primary bg-primary/15 text-primary"
              : "border-primary/30 text-muted-foreground hover:bg-accent"
          }`}
        >
          <Star className={`size-3.5 ${onlyFavorites ? "fill-current" : ""}`} /> مورد علاقه‌ها
        </button>
        <select
          value={folderFilter}
          onChange={(e) => setFolderFilter(e.target.value)}
          className="rounded-full border border-primary/30 bg-background px-3 py-1.5 text-xs outline-none"
        >
          <option value="all">همه پوشه‌ها</option>
          {folders.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
        <button
          onClick={() => void health.refresh()}
          className="inline-flex items-center gap-1 rounded-full border border-primary/30 px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent"
        >
          <RefreshCw className={`size-3.5 ${health.checking ? "animate-spin" : ""}`} /> بررسی وضعیت
          کانال‌ها
        </button>
      </div>

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="جست‌وجو در مخزن"
            className="w-full bg-transparent outline-none"
          />
        </label>
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
            <option value="">دستگاه آنلاینی نیست</option>
          )}
        </select>
      </div>

      {shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-primary/30 bg-card/50 p-10 text-center text-sm text-muted-foreground">
          <Radio className="mx-auto mb-2 size-6 text-primary" />
          هنوز استریمی در این دسته ذخیره نشده است. از صفحه «کانال‌های استریم» با دکمه ذخیره یا از
          فرم بالا اضافه کنید.
        </div>
      ) : (
        <ul className="grid gap-2 md:grid-cols-2">
          {shown.map((s) => (
            <li
              key={s.id}
              className="flex items-center gap-3 rounded-xl border border-primary/25 bg-card/70 p-3"
            >
              {s.logo ? (
                <img src={s.logo} alt="" className="size-10 rounded-lg object-contain" />
              ) : (
                <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Tv className="size-5" />
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 truncate text-sm font-medium">
                  <span
                    title={healthTitle(health.statusOf(s.url))}
                    className={`inline-block size-2.5 shrink-0 rounded-full ${healthDotClass(
                      health.statusOf(s.url),
                    )}`}
                  />
                  <span className="truncate">{s.title}</span>
                </p>
                <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
                  {STREAM_CATEGORY_LABEL[s.category]}
                  {s.folder ? ` · 📁 ${s.folder}` : ""}
                  {s.group ? ` · ${s.group}` : ""} · {s.url}
                </p>
              </div>
              <select
                value={s.category}
                onChange={(e) => patch(s.id, { category: e.target.value as StreamCategory })}
                title="نوع کاربرد شبکه"
                className="shrink-0 rounded-lg border border-input bg-background px-2 py-1 text-[11px] outline-none"
              >
                {STREAM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {STREAM_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <button
                onClick={() => patch(s.id, { favorite: !s.favorite })}
                title="مورد علاقه"
                aria-label="مورد علاقه"
                className={`shrink-0 rounded-lg border p-1.5 transition-colors ${
                  s.favorite
                    ? "border-primary bg-primary/15 text-primary"
                    : "border-primary/30 text-muted-foreground hover:bg-accent"
                }`}
              >
                <Star className={`size-4 ${s.favorite ? "fill-current" : ""}`} />
              </button>
              <button
                onClick={() => moveToFolder(s)}
                title="ذخیره در پوشه گروه‌بندی"
                aria-label="ذخیره در پوشه گروه‌بندی"
                className="shrink-0 rounded-lg border border-primary/30 p-1.5 text-muted-foreground transition-colors hover:bg-accent"
              >
                <FolderPlus className="size-4" />
              </button>
              <button
                onClick={() => openInAppPlayer({ title: s.title, source: s.url })}
                title="پخش در برنامه"
                aria-label="پخش در برنامه"
                className="shrink-0 rounded-lg border border-primary/40 p-1.5 text-primary transition-colors hover:bg-accent"
              >
                <MonitorPlay className="size-4" />
              </button>
        <VlcButton url={s.url} title={s.title} />
              <button
                onClick={() => remove(s.id)}
                title="حذف از مخزن"
                aria-label="حذف از مخزن"
                className="shrink-0 rounded-lg border border-destructive/40 p-1.5 text-destructive transition-colors hover:bg-destructive/10"
              >
                <Trash2 className="size-4" />
              </button>
              <button
                onClick={() => void share(s)}
                className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
              >
                اشتراک روی تلویزیون
              </button>
            </li>
          ))}
        </ul>
      )}
    </AppLayout>
  );
}
