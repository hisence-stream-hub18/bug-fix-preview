import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import {
  BookmarkPlus,
  FolderOpen,
  FolderPlus,
  ListVideo,
  MonitorPlay,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2,
  Tv,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { VlcButton } from "@/components/VlcButton";
import {
  STREAM_CATEGORIES,
  STREAM_CATEGORY_LABEL,
  detectKind,
  deviceLabel,
  guessStreamCategory,
  useDevices,
  usePlaylistPages,
  useActivePlaylistPage,
  useStreamVault,
  type PlaylistChannel,
  type PlaylistPage,
  type SavedStream,
  type StreamCategory,
  type TvDevice,
} from "@/lib/ums-store";
import { openInAppPlayer, openPlayer } from "@/lib/player-store";
import { isLowPower } from "@/lib/perf";
import { healthDotClass, healthTitle, useStreamHealth } from "@/lib/health";
import { WEB_MODE_MESSAGE, getUms, useDesktop, type DeviceTarget } from "@/lib/ums-bridge";

export const Route = createFileRoute("/channels")({
  head: () => ({
    meta: [
      { title: "کانال‌های استریم | مدیا سرور" },
      {
        name: "description",
        content:
          "برای هر پلی‌لیست M3U/IPTV یک صفحه مستقل بسازید، کانال‌ها را گروه‌بندی و نشان‌گذاری کنید و هر کانال را روی تلویزیون DLNA یا Google Cast بفرستید.",
      },
      { property: "og:title", content: "صفحه‌های پلی‌لیست کانال‌های استریم" },
      {
        property: "og:description",
        content:
          "صفحه‌های مستقل پلی‌لیست با ذخیره دائمی، پوشه گروه‌بندی، کانال‌های مورد علاقه و نمایش وضعیت روشن/خاموش هر کانال.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ChannelsPage,
});

function deviceTarget(device: TvDevice): DeviceTarget {
  if (device.protocol === "Cast") {
    return { protocol: "Cast", ip: device.ip, port: device.port ?? 8009 };
  }
  return { protocol: device.protocol, controlUrl: device.avTransportUrl || "" };
}

function newId() {
  return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}

function emptyPage(index: number): PlaylistPage {
  const now = Date.now();
  return {
    id: newId(),
    name: `پلی‌لیست ${index}`,
    source: "",
    kind: "",
    channels: [],
    folders: [],
    createdAt: now,
    updatedAt: now,
  };
}

function ChannelsPage() {
  const [devices, setDevices] = useDevices();
  const desktop = useDesktop();
  const [pages, setPages, pagesReady] = usePlaylistPages();
  const [activeId, setActiveId] = useActivePlaylistPage();
  const [vault, setVault] = useStreamVault();

  const [source, setSource] = useState("");
  const [loading, setLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [group, setGroup] = useState("all");
  const [folderFilter, setFolderFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState<StreamCategory | "all">("all");
  const [onlyFavorites, setOnlyFavorites] = useState(false);
  const [target, setTarget] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [seeded, setSeeded] = useState(false);
  const [pageNum, setPageNum] = useState(1);

  // First run: always keep at least one page so the "+" flow has a home.
  useEffect(() => {
    if (!pagesReady || seeded) return;
    setSeeded(true);
    if (!pages.length) {
      const page = emptyPage(1);
      setPages([page]);
      setActiveId(page.id);
      return;
    }
    if (!pages.some((p) => p.id === activeId)) setActiveId(pages[0]!.id);
  }, [pagesReady, seeded, pages, activeId, setPages, setActiveId]);

  const page = useMemo(
    () => pages.find((p) => p.id === activeId) ?? pages[0],
    [pages, activeId],
  );

  useEffect(() => {
    setSource(page?.source ?? "");
    setQuery("");
    setGroup("all");
    setFolderFilter("all");
    setCategoryFilter("all");
    setOnlyFavorites(false);
  }, [page?.id]);

  const channels = page?.channels ?? [];
  const saved = useMemo(() => new Set(vault.map((s) => s.url)), [vault]);

  const patchPage = (id: string, patch: Partial<PlaylistPage>) =>
    setPages((prev) =>
      prev.map((p) => (p.id === id ? { ...p, ...patch, updatedAt: Date.now() } : p)),
    );

  const patchChannel = (key: string, patch: Partial<PlaylistChannel>) => {
    if (!page) return;
    patchPage(page.id, {
      channels: page.channels.map((c) => (c.key === key ? { ...c, ...patch } : c)),
    });
  };

  const addPage = () => {
    const created = emptyPage(pages.length + 1);
    setPages((prev) => [...prev, created]);
    setActiveId(created.id);
  };

  const removePage = (id: string) => {
    const rest = pages.filter((p) => p.id !== id);
    const next = rest.length ? rest : [emptyPage(1)];
    setPages(next);
    if (activeId === id) setActiveId(next[0]!.id);
    toast.success("صفحه پلی‌لیست حذف شد.");
  };

  const groups = useMemo(
    () => Array.from(new Set(channels.map((c) => c.group).filter(Boolean))),
    [channels],
  );

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    return channels.filter(
      (c) =>
        (group === "all" || c.group === group) &&
        (categoryFilter === "all" || c.category === categoryFilter) &&
        (folderFilter === "all" || (c.folder || "") === folderFilter) &&
        (!onlyFavorites || c.favorite) &&
        (!q || c.title.toLowerCase().includes(q)),
    );
  }, [channels, group, categoryFilter, folderFilter, onlyFavorites, query]);

  // Paging keeps the DOM (and the TV control panel) small: a 3000-channel IPTV
  // list used to render at once, which is what made loading take many seconds.
  const perPage = isLowPower() ? 24 : 48;
  const pageCount = Math.max(1, Math.ceil(shown.length / perPage));
  const listPage = Math.min(pageNum, pageCount);
  const visible = useMemo(
    () => shown.slice((listPage - 1) * perPage, listPage * perPage),
    [shown, listPage, perPage],
  );

  // Reset to the first page whenever the filters change the result set.
  useEffect(() => {
    setPageNum(1);
  }, [query, group, categoryFilter, folderFilter, onlyFavorites, activeId]);

  // Only the channels actually on screen are probed — weak machines were
  // spending all their CPU on 120 parallel health checks.
  const health = useStreamHealth(
    visible.map((c) => c.url),
    Boolean(desktop && visible.length),
  );

  // Publish the current page to the on-TV mouse control panel (/remote).
  useEffect(() => {
    const api = getUms();
    if (!api?.remoteSetChannels) return;
    void api.remoteSetChannels({
      channels: visible.map((c) => ({ id: c.url, title: c.title, group: c.group || "" })),
    });
  }, [visible]);


  const online = devices.filter((d) => d.status !== "offline");
  const selectedDevice = target || online[0]?.id || "";

  const load = async (path?: string) => {
    if (!page) return;
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const src = (path ?? source).trim();
    if (!src) {
      toast.error("آدرس پلی‌لیست M3U یا لینک استریم را وارد کنید.");
      return;
    }
    setLoading(true);
    try {
      const res = await api.loadPlaylist({ source: src });
      if (!res.ok) {
        toast.error(res.error || "پلی‌لیست خوانده نشد.");
        return;
      }
      // نشان‌گذاری‌های قبلی (علاقه‌مندی/پوشه/نوع شبکه) حفظ می‌شود.
      const previous = new Map(page.channels.map((c) => [c.url, c]));
      const next: PlaylistChannel[] = (res.channels ?? []).map((c) => {
        const old = previous.get(c.url);
        return {
          key: c.key,
          title: c.title,
          group: c.group || "",
          logo: c.logo || "",
          url: c.url,
          category: old?.category ?? guessStreamCategory(`${c.title} ${c.group || ""} ${c.url}`),
          ...(old?.favorite ? { favorite: true } : {}),
          ...(old?.folder ? { folder: old.folder } : {}),
        };
      });
      const autoName =
        page.name.startsWith("پلی‌لیست ") && next.length
          ? (src.split(/[\\/]/).pop() || page.name).slice(0, 40)
          : page.name;
      patchPage(page.id, { source: src, kind: res.kind || "", channels: next, name: autoName });
      setGroup("all");
      toast.success(`${next.length} کانال خوانده و در این صفحه ذخیره شد.`);
    } catch {
      toast.error("خواندن پلی‌لیست با خطا مواجه شد.");
    } finally {
      setLoading(false);
    }
  };

  const pickFile = async () => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    let picked;
    try {
      picked = await api.pickPlaylistFile();
    } catch {
      toast.error("انتخاب فایل پلی‌لیست انجام نشد.");
      return;
    }
    if (!picked) return;
    setSource(picked.path);
    await load(picked.path);
  };

  const addFolder = () => {
    if (!page) return;
    const name = window.prompt("نام پوشه گروه‌بندی جدید:")?.trim();
    if (!name) return;
    if (page.folders.includes(name)) {
      toast.info("این پوشه از قبل وجود دارد.");
      return;
    }
    patchPage(page.id, { folders: [...page.folders, name] });
    toast.success(`پوشه «${name}» ساخته شد.`);
  };

  const toVaultItem = (c: PlaylistChannel, id: string): SavedStream => ({
    id,
    title: c.title,
    url: c.url,
    category: c.category,
    kind: detectKind(c.url),
    addedAt: Date.now(),
    ...(c.favorite ? { favorite: true } : {}),
    ...(c.folder ? { folder: c.folder } : {}),
    ...(c.group ? { group: c.group } : {}),
    ...(c.logo ? { logo: c.logo } : {}),
  });

  const saveOne = (c: PlaylistChannel) => {
    if (saved.has(c.url)) {
      toast.info("این کانال قبلاً در مخزن ذخیره شده است.");
      return;
    }
    setVault((prev) => [
      toVaultItem(c, `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`),
      ...prev,
    ]);
    toast.success(`«${c.title}» در مخزن استریم ذخیره شد.`);
  };

  const saveAll = () => {
    const fresh = shown.filter((c) => !saved.has(c.url));
    if (!fresh.length) {
      toast.info("همه کانال‌های نمایش‌داده‌شده از قبل ذخیره شده‌اند.");
      return;
    }
    const now = Date.now();
    setVault((prev) => [...fresh.map((c, i) => toVaultItem(c, `s-${now.toString(36)}-${i}`)), ...prev]);
    toast.success(`${fresh.length} کانال در مخزن استریم ذخیره شد.`);
  };

  const share = async (channel: PlaylistChannel) => {
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
    // پخش خوش‌بینانه: پلیر شناور بی‌درنگ باز می‌شود تا تغییر سریع کانال حس هنگ ندهد.
    openPlayer({ device, title: channel.title });
    let res;
    try {
      res = await api.play({
        ...deviceTarget(device),
        url: channel.url,
        title: channel.title,
        mime: /\.m3u8(\?|$)/i.test(channel.url)
          ? "application/vnd.apple.mpegurl"
          : /\.ts(\?|$)/i.test(channel.url)
            ? "video/mp2t"
            : "video/mp4",
      });
    } catch {
      toast.error("ارسال این کانال به تلویزیون ناموفق بود؛ دوباره تلاش کنید.");
      return;
    }
    if (!res.ok) {
      // درخواست کنارگذاشته‌شده (تغییر سریع کانال) خطا نیست.
      if (/supersed/i.test(res.error || "")) return;
      toast.error(res.error || "تلویزیون این کانال را نپذیرفت.");
      return;
    }
    setDevices((prev) =>
      prev.map((d) =>
        d.id === device.id ? { ...d, status: "playing", nowPlaying: channel.title } : d,
      ),
    );
    toast.success(`«${channel.title}» روی ${deviceLabel(device)} پخش شد.`);
  };

  // The on-TV control panel (mouse on the TV) sends its clicks here: switching
  // channel, toggling subtitles and toggling the audio-dub translator.
  useEffect(() => {
    const api = getUms();
    if (!api?.onEvent) return;
    return api.onEvent((data) => {
      const ev = data as {
        type?: string;
        action?: string;
        id?: string;
        flags?: { subtitle?: boolean; dub?: boolean };
      };
      if (ev?.type !== "remote") return;
      if (ev.action === "channel") {
        const channel = channels.find((c) => c.url === ev.id);
        if (channel) void share(channel);
        return;
      }
      if (ev.action === "stop") {
        const device = devices.find((d) => d.id === selectedDevice);
        if (device) void api.stop(deviceTarget(device));
        return;
      }

      if (ev.action === "subtitle" || ev.action === "dub") {
        // The player listens for this and turns the matching engine on/off.
        window.dispatchEvent(new CustomEvent("ums:remote-flags", { detail: ev.flags ?? {} }));
        toast.info(
          ev.action === "subtitle"
            ? `زیرنویس ${ev.flags?.subtitle ? "روشن" : "خاموش"} شد.`
            : `دوبله صدا ${ev.flags?.dub ? "روشن" : "خاموش"} شد.`,
        );
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channels, selectedDevice, devices]);

  return (
    <AppLayout
      title="کانال‌های استریم"
      subtitle="هر پلی‌لیست یک صفحه مستقل دارد؛ با دکمه + صفحه تازه بسازید و کانال‌ها را سازمان دهید"
    >
      {/* تب‌های صفحه‌های پلی‌لیست */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {pages.map((p) => (
          <button
            key={p.id}
            onClick={() => setActiveId(p.id)}
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs transition-colors ${
              p.id === page?.id
                ? "border-primary bg-primary/15 text-primary"
                : "border-primary/30 text-muted-foreground hover:bg-accent"
            }`}
          >
            <ListVideo className="size-3.5" />
            <span className="max-w-[10rem] truncate">{p.name}</span>
            <span className="text-[10px] opacity-70">{p.channels.length}</span>
          </button>
        ))}
        <button
          onClick={addPage}
          title="صفحه جدید برای خواندن پلی‌لیست"
          className="inline-flex items-center gap-1 rounded-full bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Plus className="size-3.5" /> صفحه جدید
        </button>
      </div>

      {page ? (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-primary/25 bg-card/60 p-3">
            {renaming ? (
              <>
                <input
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  className="rounded-lg border border-input bg-background px-3 py-1.5 text-sm outline-none focus:border-primary"
                  placeholder="نام این صفحه"
                />
                <button
                  onClick={() => {
                    patchPage(page.id, { name: nameDraft.trim() || page.name });
                    setRenaming(false);
                  }}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground"
                >
                  ذخیره نام
                </button>
                <button
                  onClick={() => setRenaming(false)}
                  className="rounded-lg border border-border p-1.5"
                  aria-label="انصراف"
                >
                  <X className="size-4" />
                </button>
              </>
            ) : (
              <>
                <p className="text-sm font-semibold">{page.name}</p>
                <button
                  onClick={() => {
                    setNameDraft(page.name);
                    setRenaming(true);
                  }}
                  title="تغییر نام صفحه"
                  aria-label="تغییر نام صفحه"
                  className="rounded-lg border border-primary/40 p-1.5 text-primary transition-colors hover:bg-accent"
                >
                  <Pencil className="size-3.5" />
                </button>
              </>
            )}
            <button
              onClick={addFolder}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/40 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-accent"
            >
              <FolderPlus className="size-3.5" /> پوشه جدید
            </button>
            <button
              onClick={() => health.refresh()}
              disabled={health.checking}
              className="inline-flex items-center gap-1 rounded-lg border border-primary/40 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-accent disabled:opacity-60"
            >
              <RefreshCw className={`size-3.5 ${health.checking ? "animate-spin" : ""}`} />
              بررسی وضعیت کانال‌ها
            </button>
            <button
              onClick={() => removePage(page.id)}
              className="ms-auto inline-flex items-center gap-1 rounded-lg border border-destructive/40 px-3 py-1.5 text-xs text-destructive transition-colors hover:bg-accent"
            >
              <Trash2 className="size-3.5" /> حذف این صفحه
            </button>
          </div>

          <div className="mb-5 grid gap-3 rounded-2xl border border-primary/30 bg-card/70 p-5 sm:grid-cols-[1.6fr_auto_auto]">
            <input
              dir="ltr"
              value={source}
              onChange={(e) => setSource(e.target.value)}
              placeholder="https://example.com/playlist.m3u"
              className="rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RefreshCw className={`size-4 ${loading ? "animate-spin" : ""}`} />
              {loading ? "در حال خواندن…" : "خواندن پلی‌لیست"}
            </button>
            <button
              onClick={() => void pickFile()}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/40 px-4 py-2.5 text-sm transition-colors hover:bg-accent"
            >
              <FolderOpen className="size-4" /> فایل M3U
            </button>
            {!desktop ? (
              <p className="text-xs text-destructive sm:col-span-3">{WEB_MODE_MESSAGE}</p>
            ) : null}
          </div>

          {channels.length ? (
            <div className="mb-4 grid gap-3 sm:grid-cols-3">
              <label className="flex items-center gap-2 rounded-lg border border-input bg-background px-3 py-2 text-sm">
                <Search className="size-4 text-muted-foreground" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="جست‌وجوی کانال"
                  className="w-full bg-transparent outline-none"
                />
              </label>
              <select
                value={group}
                onChange={(e) => setGroup(e.target.value)}
                aria-label="گروه پلی‌لیست"
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="all">همه گروه‌ها ({channels.length})</option>
                {groups.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value as StreamCategory | "all")}
                aria-label="نوع شبکه"
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="all">همه نوع شبکه‌ها</option>
                {STREAM_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {STREAM_CATEGORY_LABEL[c]}
                  </option>
                ))}
              </select>
              <select
                value={folderFilter}
                onChange={(e) => setFolderFilter(e.target.value)}
                aria-label="پوشه گروه‌بندی"
                className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
              >
                <option value="all">همه پوشه‌ها</option>
                <option value="">بدون پوشه</option>
                {page.folders.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </select>
              <select
                value={selectedDevice}
                onChange={(e) => setTarget(e.target.value)}
                aria-label="تلویزیون مقصد"
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
              <label className="flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-sm text-primary">
                <input
                  type="checkbox"
                  checked={onlyFavorites}
                  onChange={(e) => setOnlyFavorites(e.target.checked)}
                  className="size-4 accent-primary"
                />
                فقط مورد علاقه‌ها
              </label>
              <button
                onClick={saveAll}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/40 px-4 py-2 text-sm text-primary transition-colors hover:bg-accent sm:col-span-3"
              >
                <Save className="size-4" /> ذخیره همه کانال‌های نمایش‌داده‌شده در مخزن استریم
              </button>
            </div>
          ) : null}

          {channels.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-primary/30 bg-card/50 p-10 text-center text-sm text-muted-foreground">
              <ListVideo className="mx-auto mb-2 size-6 text-primary" />
              آدرس یک پلی‌لیست M3U/IPTV یا یک لینک استریم HLS را در همین صفحه وارد کنید؛ برای
              پلی‌لیست بعدی از دکمه «صفحه جدید» استفاده کنید.
            </div>
          ) : (
            <>
              <p className="mb-2 text-xs text-muted-foreground">
                نوع پلی‌لیست:{" "}
                {page.kind === "hls-master" ? "کیفیت‌های استریم HLS" : "پلی‌لیست IPTV"} —{" "}
                {shown.length} مورد یافت شد — صفحه {listPage} از {pageCount}
              </p>
              <ul className="grid gap-2 md:grid-cols-2">
                {visible.map((c) => (
                  <li
                    key={c.key}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/25 bg-card/70 p-3"
                  >
                    {c.logo ? (
                      <img src={c.logo} alt="" className="size-10 rounded-lg object-contain" />
                    ) : (
                      <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
                        <Tv className="size-5" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="flex items-center gap-2 truncate text-sm font-medium">
                        <span
                          title={healthTitle(health.statusOf(c.url))}
                          className={`inline-block size-2.5 shrink-0 rounded-full ${healthDotClass(
                            health.statusOf(c.url),
                          )}`}
                        />
                        <span className="truncate">{c.title}</span>
                      </p>
                      <p className="truncate text-[11px] text-muted-foreground" dir="ltr">
                        {c.group ? `${c.group} · ` : ""}
                        {c.url}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <select
                          value={c.category}
                          onChange={(e) =>
                            patchChannel(c.key, { category: e.target.value as StreamCategory })
                          }
                          aria-label="نوع شبکه"
                          className="rounded-md border border-input bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                        >
                          {STREAM_CATEGORIES.map((cat) => (
                            <option key={cat} value={cat}>
                              {STREAM_CATEGORY_LABEL[cat]}
                            </option>
                          ))}
                        </select>
                        <select
                          value={c.folder || ""}
                          onChange={(e) => patchChannel(c.key, { folder: e.target.value })}
                          aria-label="پوشه"
                          className="rounded-md border border-input bg-background px-1.5 py-0.5 text-[11px] outline-none focus:border-primary"
                        >
                          <option value="">بدون پوشه</option>
                          {page.folders.map((f) => (
                            <option key={f} value={f}>
                              {f}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <button
                      onClick={() => patchChannel(c.key, { favorite: !c.favorite })}
                      title="کانال مورد علاقه"
                      aria-label="کانال مورد علاقه"
                      className={`shrink-0 rounded-lg border p-1.5 transition-colors hover:bg-accent ${
                        c.favorite
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-primary/40 text-muted-foreground"
                      }`}
                    >
                      <Star className={`size-4 ${c.favorite ? "fill-current" : ""}`} />
                    </button>
                    <button
                      onClick={() => saveOne(c)}
                      title="ذخیره در مخزن استریم"
                      aria-label="ذخیره در مخزن استریم"
                      className={`shrink-0 rounded-lg border p-1.5 transition-colors hover:bg-accent ${
                        saved.has(c.url)
                          ? "border-primary bg-primary/15 text-primary"
                          : "border-primary/40 text-primary"
                      }`}
                    >
                      <BookmarkPlus className="size-4" />
                    </button>
                    <button
                      onClick={() => openInAppPlayer({ title: c.title, source: c.url })}
                      title="پخش در برنامه"
                      aria-label="پخش در برنامه"
                      className="shrink-0 rounded-lg border border-primary/40 p-1.5 text-primary transition-colors hover:bg-accent"
                    >
                      <MonitorPlay className="size-4" />
                    </button>
                    <VlcButton url={c.url} title={c.title} />
                    <button
                      onClick={() => void share(c)}
                      className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                    >
                      اشتراک روی تلویزیون
                    </button>
                  </li>
                ))}
              </ul>
              {pageCount > 1 ? (
                <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
                  <button
                    onClick={() => setPageNum(Math.max(1, listPage - 1))}
                    disabled={listPage === 1}
                    className="rounded-lg border border-border px-4 py-2 text-xs disabled:opacity-40"
                  >
                    صفحه قبل
                  </button>
                  <span className="text-xs text-muted-foreground">
                    {listPage} / {pageCount}
                  </span>
                  <button
                    onClick={() => setPageNum(Math.min(pageCount, listPage + 1))}
                    disabled={listPage === pageCount}
                    className="rounded-lg border border-border px-4 py-2 text-xs disabled:opacity-40"
                  >
                    صفحه بعد
                  </button>
                </div>
              ) : null}
            </>

          )}
        </>
      ) : null}
    </AppLayout>
  );
}
