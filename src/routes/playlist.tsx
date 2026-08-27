import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Cast, Captions, Copy, FolderPlus, MonitorPlay, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { VlcButton } from "@/components/VlcButton";
import { openInAppPlayer, openPlayer } from "@/lib/player-store";
import {
  KIND_LABEL,
  streamUrl,
  useDevices,
  usePlaylist,
  useSettings,
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


export const Route = createFileRoute("/playlist")({
  head: () => ({
    meta: [
      { title: "لیست پخش | مدیا سرور خانگی" },
      {
        name: "description",
        content: "مدیریت لینک‌های ذخیره‌شده و ارسال آن‌ها برای پخش روی تلویزیون شبکه.",
      },
      { property: "og:title", content: "لیست پخش مدیا سرور" },
      { property: "og:description", content: "انتخاب لینک و ارسال آن به تلویزیون در شبکه داخلی." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Playlist,
});

function Playlist() {
  const [playlist, setPlaylist] = usePlaylist();
  const [devices, setDevices] = useDevices();
  const [settings] = useSettings();
  const online = devices.filter((d) => d.status !== "offline");
  const desktop = useDesktop();
  const health = useStreamHealth(
    playlist.map((i) => i.url),
    Boolean(desktop && playlist.length),
  );
  const [target, setTarget] = useState<string>(online[0]?.id ?? "");

  const selectedId = target || online[0]?.id || "";

  const play = async (itemId: string) => {
    const device = devices.find((d) => d.id === selectedId);
    const item = playlist.find((i) => i.id === itemId);
    if (!device || !item) {
      toast.error("ابتدا یک دستگاه آنلاین انتخاب کنید.");
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
      mediaId: item.id,
      title: item.title,
      mime: item.kind === "hls" ? "application/vnd.apple.mpegurl" : "video/mp4",
      ...(item.subtitle ? { subtitle: item.subtitle } : {}),
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
        d.id === device.id ? { ...d, status: "playing", nowPlaying: item.title } : d,
      ),
    );
    setPlaylist((prev) =>
      prev.map((i) => (i.id === item.id ? { ...i, lastPlayedAt: Date.now() } : i)),
    );
    openPlayer({ device, title: item.title });
    toast.success(`پخش «${item.title}» روی ${device.name} آغاز شد.`);
  };

  const pickSubtitle = async (itemId: string) => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    let picked;
    try {
      picked = await api.pickSubtitle({ mediaId: itemId });
    } catch {
      toast.error("انتخاب زیرنویس انجام نشد.");
      return;
    }
    if (!picked) return;
    setPlaylist((prev) =>
      prev.map((i) =>
        i.id === itemId ? { ...i, subtitle: picked.path, subtitleName: picked.name } : i,
      ),
    );
    toast.success(`زیرنویس «${picked.name}» انتخاب شد.`);
  };

  // Adds video files from this computer to the list; they are then playable both
  // in the built-in player and on the TV (served with Range support).
  const addLocalFiles = async () => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    let files;
    try {
      files = await api.pickFiles();
    } catch {
      toast.error("انتخاب فایل ویدیویی انجام نشد.");
      return;
    }
    if (!files?.length) return;
    setPlaylist((prev) => [
      ...files.map((f, i) => ({
        id: `local-${Date.now().toString(36)}-${i}`,
        title: f.name,
        url: f.path,
        kind: "http" as const,
        note: f.sizeMb ? `${f.sizeMb} مگابایت — فایل کامپیوتر` : "فایل کامپیوتر",
        addedAt: Date.now(),
      })),
      ...prev,
    ]);
    toast.success(`${files.length} فایل ویدیویی اضافه شد.`);
  };

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("آدرس استریم کپی شد.");
    } catch {
      toast.error("کپی انجام نشد.");
    }
  };

  return (
    <AppLayout title="لیست پخش" subtitle="لینک‌های آماده ارسال به تلویزیون">
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card p-4">
        <span className="text-sm text-muted-foreground">دستگاه مقصد:</span>
        <select
          value={selectedId}
          onChange={(e) => setTarget(e.target.value)}
          className="rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
        >
          {online.length === 0 ? <option value="">دستگاه آنلاینی یافت نشد</option> : null}
          {online.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name} — {d.ip}
            </option>
          ))}
        </select>
        <button
          onClick={() => void addLocalFiles()}
          className="inline-flex items-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-sm text-primary transition-colors hover:bg-accent"
        >
          <FolderPlus className="size-4" /> افزودن فایل ویدیویی از کامپیوتر
        </button>
      </div>

      {playlist.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card p-10 text-center text-sm text-muted-foreground">
          لیست پخش خالی است.
        </div>
      ) : (
        <ul className="space-y-3">
          {playlist.map((item) => (
            <li key={item.id} className="rounded-xl border border-border bg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span
                      title={healthTitle(health.statusOf(item.url))}
                      className={`inline-block size-2.5 shrink-0 rounded-full ${healthDotClass(
                        health.statusOf(item.url),
                      )}`}
                    />
                    <p className="truncate font-medium">{item.title}</p>
                    <span className="rounded-md bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                      {KIND_LABEL[item.kind]}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground" dir="ltr">
                    {item.url}
                  </p>
                  <p className="mt-1 truncate text-xs text-primary" dir="ltr">
                    {streamUrl(item, settings)}
                  </p>
                  {item.note ? (
                    <p className="mt-1 text-xs text-muted-foreground">{item.note}</p>
                  ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button
                    onClick={() =>
                      openInAppPlayer({ title: item.title, source: item.url, mediaId: item.id })
                    }
                    className="inline-flex items-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-sm text-primary transition-colors hover:bg-accent"
                  >
                    <MonitorPlay className="size-4" />
                    پخش در برنامه
                  </button>
        <VlcButton url={item.url} title={item.title} />
                  <button
                    onClick={() => void play(item.id)}
                    className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
                  >
                    <Cast className="size-4" />
                    پخش روی تلویزیون
                  </button>
                  <button
                    onClick={() => void pickSubtitle(item.id)}
                    aria-label="انتخاب فایل زیرنویس"
                    title={item.subtitleName ? `زیرنویس: ${item.subtitleName}` : "انتخاب زیرنویس"}
                    className={`rounded-lg border p-2 transition-colors hover:bg-accent ${
                      item.subtitle ? "border-primary text-primary" : "border-border"
                    }`}
                  >
                    <Captions className="size-4" />
                  </button>
                  <button
                    onClick={() => copy(streamUrl(item, settings))}
                    aria-label="کپی آدرس استریم"
                    className="rounded-lg border border-border p-2 transition-colors hover:bg-accent"
                  >
                    <Copy className="size-4" />
                  </button>
                  <button
                    onClick={() => setPlaylist((prev) => prev.filter((i) => i.id !== item.id))}
                    aria-label="حذف"
                    className="rounded-lg border border-border p-2 text-destructive transition-colors hover:bg-accent"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </AppLayout>
  );
}
