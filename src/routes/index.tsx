import { createFileRoute, Link } from "@tanstack/react-router";
import { Activity, ListVideo, MonitorSpeaker, PlusCircle, Radio, Wifi } from "lucide-react";
import { AppLayout } from "@/components/AppLayout";
import { usePlaylist, useDevices, useSettings, KIND_LABEL } from "@/lib/ums-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "مدیا سرور خانگی برای تلویزیون شبکه" },
      {
        name: "description",
        content:
          "پخش لینک‌های یوتیوب، HLS، RTSP و IPTV روی تلویزیون از طریق DLNA و UPnP در شبکه داخلی.",
      },
      { property: "og:title", content: "مدیا سرور خانگی برای تلویزیون شبکه" },
      {
        property: "og:description",
        content: "پخش مستقیم لینک‌های آنلاین روی تلویزیون از طریق DLNA/UPnP بدون دانلود فایل.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

function Index() {
  const [playlist] = usePlaylist();
  const [devices] = useDevices();
  const [settings] = useSettings();

  const online = devices.filter((d) => d.status !== "offline").length;

  const stats = [
    { label: "آیتم‌های لیست پخش", value: playlist.length, icon: ListVideo },
    { label: "دستگاه‌های آنلاین", value: online, icon: MonitorSpeaker },
    { label: "پورت سرور", value: settings.port, icon: Radio },
    {
      label: "وضعیت سرویس",
      value: settings.dlnaEnabled || settings.upnpEnabled ? "فعال" : "غیرفعال",
      icon: Activity,
    },
  ];

  return (
    <AppLayout title="خانه" subtitle="پخش لینک‌های آنلاین روی تلویزیون‌های شبکه محلی">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map(({ label, value, icon: Icon }) => (
          <div key={label} className="rounded-xl border border-border bg-card p-4">
            <div className="flex items-center justify-between">
              <p className="text-xs text-muted-foreground">{label}</p>
              <Icon className="size-4 text-primary" />
            </div>
            <p className="mt-3 text-2xl font-bold">{value}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-5 lg:col-span-2">
          <h2 className="text-base font-semibold">آخرین لینک‌های افزوده‌شده</h2>
          {playlist.length === 0 ? (
            <p className="mt-4 text-sm text-muted-foreground">
              هنوز لینکی اضافه نشده است. از بخش «افزودن لینک» شروع کنید.
            </p>
          ) : (
            <ul className="mt-4 divide-y divide-border">
              {playlist.slice(0, 5).map((item) => (
                <li key={item.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{item.title}</p>
                    <p className="truncate text-xs text-muted-foreground" dir="ltr">
                      {item.url}
                    </p>
                  </div>
                  <span className="shrink-0 rounded-md bg-secondary px-2 py-1 text-xs text-muted-foreground">
                    {KIND_LABEL[item.kind]}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Link
            to="/add"
            className="mt-5 inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <PlusCircle className="size-4" />
            افزودن لینک جدید
          </Link>
        </div>

        <div className="rounded-xl border border-border bg-card p-5">
          <h2 className="text-base font-semibold">دستگاه‌های شبکه</h2>
          <ul className="mt-4 space-y-3">
            {devices.map((d) => (
              <li key={d.id} className="flex items-center gap-3">
                <Wifi
                  className={`size-4 ${d.status === "offline" ? "text-muted-foreground" : "text-primary"}`}
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{d.name}</p>
                  <p className="text-xs text-muted-foreground" dir="ltr">
                    {d.ip}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">
                  {d.status === "offline"
                    ? "آفلاین"
                    : d.status === "playing"
                      ? "در حال پخش"
                      : "آنلاین"}
                </span>
              </li>
            ))}
          </ul>
          <Link
            to="/devices"
            className="mt-5 inline-flex w-full items-center justify-center rounded-lg border border-border px-4 py-2 text-sm transition-colors hover:bg-accent"
          >
            مدیریت دستگاه‌ها
          </Link>
        </div>
      </div>
    </AppLayout>
  );
}
