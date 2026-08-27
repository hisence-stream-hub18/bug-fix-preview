import { createFileRoute } from "@tanstack/react-router";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { useDevices, usePlaylist, useSettings } from "@/lib/ums-store";
import { WEB_MODE_MESSAGE, getUms, useServerStatus } from "@/lib/ums-bridge";

export const Route = createFileRoute("/status")({
  head: () => ({
    meta: [
      { title: "وضعیت سرور | مدیا سرور خانگی" },
      {
        name: "description",
        content: "نمایش وضعیت واقعی سرویس‌های DLNA، UPnP و HTTP streaming به همراه آمار ترافیک.",
      },
      { property: "og:title", content: "وضعیت سرور" },
      { property: "og:description", content: "سلامت سرویس‌های پخش و گزارش لحظه‌ای سرور رسانه." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Status,
});

function Status() {
  const [settings] = useSettings();
  const [devices] = useDevices();
  const [playlist] = usePlaylist();
  const { status, available, refresh } = useServerStatus(2000);

  const uptime = status?.uptimeSec ?? 0;
  const hh = String(Math.floor(uptime / 3600)).padStart(2, "0");
  const mm = String(Math.floor((uptime % 3600) / 60)).padStart(2, "0");
  const ss = String(uptime % 60).padStart(2, "0");

  const services = [
    {
      name: "HTTP Streaming (Range/206)",
      active: Boolean(status?.running),
      detail: status?.baseUrl ?? `${settings.networkIp || "—"}:${settings.port}`,
    },
    {
      name: "DLNA Media Server (SSDP alive)",
      active: Boolean(status?.advertising) && settings.dlnaEnabled,
      detail: status ? `${status.name} · ${status.uuid ?? ""}` : settings.serverName,
    },
    {
      name: "UPnP / SSDP Discovery",
      active: Boolean(status?.advertising) && settings.upnpEnabled,
      detail: "239.255.255.250:1900",
    },
    {
      name: "آیتم‌های قابل سرو (/media/:id)",
      active: Boolean(status?.items),
      detail: `${status?.items ?? 0} آیتم`,
    },
  ];

  const restart = async () => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.restartServer();
    await refresh();
    if (res.ok === false) toast.error(res.error || "سرور اجرا نشد.");
    else toast.success(`سرور روی پورت ${res.port} اجرا شد.`);
  };

  const mb = (status?.bytesSent ?? 0) / 1048576;
  const playing = devices.filter((d) => d.status === "playing");

  return (
    <AppLayout title="وضعیت سرور" subtitle="سلامت واقعی سرویس‌ها و آمار ترافیک">
      {!available ? (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {WEB_MODE_MESSAGE}
        </div>
      ) : null}

      {status?.lastError ? (
        <div className="mb-4 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          خطای سرور: {status.lastError}
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold">سرویس‌ها</h2>
            <button
              onClick={restart}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
            >
              <RefreshCw className="size-3" /> راه‌اندازی مجدد سرور
            </button>
          </div>
          <ul className="mt-4 space-y-3">
            {services.map((s) => (
              <li
                key={s.name}
                className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3"
              >
                <div className="min-w-0">
                  <p className="text-sm font-medium">{s.name}</p>
                  <p className="truncate text-xs text-muted-foreground" dir="ltr">
                    {s.detail}
                  </p>
                </div>
                <span
                  className={`flex shrink-0 items-center gap-2 text-xs ${s.active ? "text-primary" : "text-muted-foreground"}`}
                >
                  <span
                    className={`size-2 rounded-full ${s.active ? "bg-primary" : "bg-muted-foreground"}`}
                  />
                  {s.active ? "در حال اجرا" : "متوقف"}
                </span>
              </li>
            ))}
          </ul>

          {status?.interfaces?.length ? (
            <div className="mt-4 rounded-lg border border-border p-4">
              <p className="text-xs text-muted-foreground">کارت‌های شبکه شناسایی‌شده</p>
              <ul className="mt-2 space-y-1 text-xs" dir="ltr">
                {status.interfaces.map((i) => (
                  <li key={`${i.name}-${i.address}`}>
                    {i.name}: {i.address}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">مدت فعالیت سرور</p>
            <p className="mt-2 text-2xl font-bold tabular-nums" dir="ltr">
              {hh}:{mm}:{ss}
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">درخواست‌های سرویس‌شده</p>
            <p className="mt-2 text-2xl font-bold tabular-nums">{status?.requests ?? 0}</p>
            <p className="mt-1 text-xs text-muted-foreground" dir="ltr">
              {mb.toFixed(1)} MB sent
            </p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">آیتم‌های اشتراک‌گذاری‌شده</p>
            <p className="mt-2 text-2xl font-bold">{playlist.length}</p>
          </div>
          <div className="rounded-xl border border-border bg-card p-5">
            <p className="text-xs text-muted-foreground">جلسات فعال پخش</p>
            <p className="mt-2 text-2xl font-bold">{playing.length}</p>
            {playing.map((d) => (
              <p key={d.id} className="mt-2 truncate text-xs text-muted-foreground">
                {d.name} — {d.nowPlaying}
              </p>
            ))}
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
