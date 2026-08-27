import { createFileRoute } from "@tanstack/react-router";
import { useEffect } from "react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { defaultSettings, useSettings } from "@/lib/ums-store";
import { WEB_MODE_MESSAGE, getUms, useServerStatus } from "@/lib/ums-bridge";
import { usePerfMode, type PerfMode } from "@/lib/perf";
import {
  AV_OFFSET_LIMIT,
  PREVIEW_DELAY_LIMIT,
  readAvOffset,
  writeAvOffset,
  writePreviewDelay,
} from "@/lib/av-sync";
import { TranslatorSettings } from "@/components/TranslatorSettings";

export const Route = createFileRoute("/settings")({
  head: () => ({
    meta: [
      { title: "تنظیمات سرور | مدیا سرور خانگی" },
      {
        name: "description",
        content: "پیکربندی پورت سرور، IP شبکه و فعال‌سازی سرویس‌های DLNA و UPnP.",
      },
      { property: "og:title", content: "تنظیمات سرور" },
      {
        property: "og:description",
        content: "پورت، آدرس شبکه و سرویس‌های DLNA/UPnP را تنظیم کنید.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: SettingsPage,
});

function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border p-4">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        <span className="mt-1 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="relative inline-flex">
        <input
          type="checkbox"
          className="peer sr-only"
          checked={checked}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span className="block h-6 w-11 rounded-full bg-secondary transition-colors peer-checked:bg-primary" />
        <span className="absolute top-0.5 right-0.5 size-5 rounded-full bg-foreground transition-transform peer-checked:-translate-x-5" />
      </span>
    </label>
  );
}

/** Labelled range control used by the manual performance sub-menu. */
function Slider({
  label,
  hint,
  min,
  max,
  step,
  value,
  unit,
  onChange,
}: {
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  value: number;
  unit: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="mt-3">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs font-semibold text-primary" dir="ltr">
          {`${value} ${unit}`}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="mt-2 h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
      />
    </div>
  );
}

const PERF_LABEL: Record<PerfMode, string> = {
  auto: "خودکار (تشخیص سخت‌افزار)",
  low: "سبک — سیستم/گوشی ضعیف",
  high: "کامل — سیستم قوی",
};

function SettingsPage() {
  const [settings, setSettings, ready] = useSettings();
  const perf = usePerfMode();
  const { status, available, refresh } = useServerStatus(4000);

  // Fill the network IP with the real detected address on first desktop run.
  useEffect(() => {
    if (!ready || settings.networkIp) return;
    const api = getUms();
    if (!api) return;
    void api.getNetwork().then((net) => {
      if (net?.ip) setSettings({ ...settings, networkIp: net.ip });
    });
  }, [ready, settings, setSettings]);

  // Keep the player-side offset (localStorage) and the server-side ffmpeg
  // offset in one place, so the TV and the built-in player stay in step.
  useEffect(() => {
    if (!ready) return;
    const local = readAvOffset();
    if (local !== settings.avOffsetMs) setSettings({ ...settings, avOffsetMs: local });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready]);

  const setOffset = (ms: number) => {
    const v = Math.max(-AV_OFFSET_LIMIT, Math.min(AV_OFFSET_LIMIT, Math.round(ms)));
    writeAvOffset(v);
    setSettings({ ...settings, avOffsetMs: v });
  };

  const apply = async () => {
    const api = getUms();
    if (!api) {
      toast.error(WEB_MODE_MESSAGE);
      return;
    }
    const res = await api.applySettings({ ...settings });
    await refresh();
    if (res.ok === false) {
      toast.error(res.error || "سرور با تنظیمات جدید اجرا نشد.");
      return;
    }
    toast.success(
      res.restarted ? `تنظیمات ذخیره شد و سرور روی ${res.baseUrl} اجرا شد.` : "تنظیمات ذخیره شد.",
    );
  };

  return (
    <AppLayout title="تنظیمات" subtitle="پیکربندی سرویس رسانه محلی">
      {!available ? (
        <div className="mb-4 max-w-2xl rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          {WEB_MODE_MESSAGE}
        </div>
      ) : status ? (
        <div className="mb-4 max-w-2xl rounded-xl border border-primary/40 bg-card/70 p-4 text-sm">
          <p>
            وضعیت فعلی سرور:{" "}
            <span className={status.running ? "text-primary" : "text-destructive"}>
              {status.running ? "در حال اجرا" : "متوقف"}
            </span>{" "}
            — <span dir="ltr">{status.baseUrl}</span>
          </p>
          {status.interfaces?.length ? (
            <p className="mt-2 text-xs text-muted-foreground" dir="ltr">
              {status.interfaces.map((i) => `${i.name}: ${i.address}`).join("  |  ")}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="port">
              پورت سرور
            </label>
            <input
              id="port"
              dir="ltr"
              type="number"
              value={settings.port}
              onChange={(e) => setSettings({ ...settings, port: Number(e.target.value) || 0 })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium" htmlFor="ip">
              IP شبکه
            </label>
            <input
              id="ip"
              dir="ltr"
              value={settings.networkIp}
              onChange={(e) => setSettings({ ...settings, networkIp: e.target.value })}
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
          </div>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="name">
            نام سرور در شبکه
          </label>
          <input
            id="name"
            value={settings.serverName}
            onChange={(e) => setSettings({ ...settings, serverName: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </div>

        <Toggle
          label="فعال‌سازی DLNA"
          hint="معرفی سرور به تلویزیون به‌عنوان Media Server استاندارد DLNA"
          checked={settings.dlnaEnabled}
          onChange={(v) => setSettings({ ...settings, dlnaEnabled: v })}
        />
        <Toggle
          label="فعال‌سازی UPnP"
          hint="کشف خودکار دستگاه‌ها از طریق SSDP و کنترل پخش"
          checked={settings.upnpEnabled}
          onChange={(v) => setSettings({ ...settings, upnpEnabled: v })}
        />
        <Toggle
          label="تبدیل به HLS"
          hint="بازبسته‌بندی لینک‌های یوتیوب و RTSP به استریم سازگار با تلویزیون"
          checked={settings.transcodeHls}
          onChange={(v) => setSettings({ ...settings, transcodeHls: v })}
        />

        <div className="rounded-lg border border-border p-4">
          <p className="text-sm font-medium">همخوانی صدا و تصویر</p>
          <p className="mt-1 text-xs text-muted-foreground">
            اگر روی تلویزیون (مثل هایسنس) صدا از تصویر جلو یا عقب است، این مقدار را تنظیم کنید؛ روی
            استریم ارسالی به تلویزیون و پلیر داخلی اعمال می‌شود.
          </p>
          <div className="mt-3 flex items-center gap-3">
            <span className="text-xs text-muted-foreground">صدا زودتر</span>
            <input
              type="range"
              min={-AV_OFFSET_LIMIT}
              max={AV_OFFSET_LIMIT}
              step={50}
              value={settings.avOffsetMs ?? 0}
              onChange={(e) => setOffset(Number(e.target.value))}
              aria-label="اختلاف زمانی صدا و تصویر"
              className="h-1.5 flex-1 cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
            />
            <span className="text-xs text-muted-foreground">تصویر زودتر</span>
            <span className="w-20 text-center text-xs font-semibold text-primary" dir="ltr">
              {(settings.avOffsetMs ?? 0) > 0 ? "+" : ""}
              {settings.avOffsetMs ?? 0} ms
            </span>
          </div>
        </div>

        <div className="rounded-lg border border-border p-4">
          <label className="text-sm font-medium" htmlFor="perf">
            حالت عملکرد
          </label>
          <p className="mt-1 text-xs text-muted-foreground">
            حالت سبک بافر پخش، افکت‌ها و تعداد درخواست‌های شبکه را کم می‌کند؛ مناسب سیستم‌های کم‌رم و
            گوشی‌های ضعیف.
          </p>
          <select
            id="perf"
            value={perf.mode}
            onChange={(e) => {
              const mode = e.target.value as PerfMode;
              perf.setMode(mode);
              setSettings({ ...settings, perfMode: mode });
            }}
            className="mt-3 w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            {(Object.keys(PERF_LABEL) as PerfMode[]).map((m) => (
              <option key={m} value={m}>
                {PERF_LABEL[m]}
              </option>
            ))}
          </select>
          <p className="mt-2 text-xs text-muted-foreground">
            وضعیت فعلی: {perf.low ? "سبک (فعال)" : "کامل"}
          </p>

          <details className="mt-4 rounded-lg border border-border bg-background/40 p-3">
            <summary className="cursor-pointer text-sm font-medium text-primary">
              تنظیم دستی عملکرد ({PERF_LABEL[perf.mode]})
            </summary>
            <p className="mt-2 text-xs text-muted-foreground">
              این مقادیر روی اشتراک صفحه و استریم ارسالی به تلویزیون اعمال می‌شوند؛ با تغییر
              تدریجی می‌توانید بهترین نتیجه را روی سیستم خودتان پیدا کنید.
            </p>

            <Slider
              label="نرخ ضبط تصویر (FPS)"
              hint="بالاتر = حرکت موس روان‌تر و نزدیک به دسکتاپ؛ روی سیستم ضعیف مقدار کم بگذارید. صفر یعنی خودکار."
              min={0}
              max={60}
              step={5}
              value={settings.captureFps ?? 0}
              unit={settings.captureFps ? "fps" : "auto"}
              onChange={(v) => setSettings({ ...settings, captureFps: v < 15 ? 0 : v })}
            />
            <Slider
              label="نرخ بیت تصویر"
              hint="کیفیت تصویر ارسالی؛ صفر یعنی انتخاب خودکار بر اساس سخت‌افزار."
              min={0}
              max={12000}
              step={500}
              value={settings.captureKbps ?? 0}
              unit={settings.captureKbps ? "kbps" : "auto"}
              onChange={(v) => setSettings({ ...settings, captureKbps: v < 1200 ? 0 : v })}
            />
            <Slider
              label="فاصله کی‌فریم (GOP)"
              hint="مقدار کوتاه و ثابت (۸ یا ۱۵) زنجیره بافر را کوتاه و تأخیر تلویزیون را کم می‌کند."
              min={0}
              max={60}
              step={1}
              value={settings.gopFrames ?? 0}
              unit={settings.gopFrames ? "frame" : "auto"}
              onChange={(v) => setSettings({ ...settings, gopFrames: v < 4 ? 0 : v })}
            />
            <Slider
              label="اندازه قطعه خروجی"
              hint="قطعه‌های ۵۰۰ تا ۱۰۰۰ میلی‌ثانیه بافر اضافی سرور را حذف می‌کنند."
              min={300}
              max={2000}
              step={100}
              value={settings.segmentMs ?? 1000}
              unit="ms"
              onChange={(v) => setSettings({ ...settings, segmentMs: v })}
            />
            <Slider
              label="جبران تأخیر تلویزیون در پیش‌نمایش"
              hint="پیش‌نمایش داخل برنامه به همین اندازه عقب می‌افتد تا تصویر برنامه و تلویزیون هم‌زمان دیده شوند."
              min={0}
              max={PREVIEW_DELAY_LIMIT}
              step={100}
              value={settings.previewDelayMs ?? 0}
              unit="ms"
              onChange={(v) => {
                writePreviewDelay(v);
                setSettings({ ...settings, previewDelayMs: v });
              }}
            />

            <div className="mt-3 space-y-3">
              <Toggle
                label="پنل سبک روی تلویزیون"
                hint="به‌جای خواندن فایل متنی در هر فریم، پنل فقط یک‌بار در ثانیه بازخوانی می‌شود."
                checked={settings.lightPanel ?? false}
                onChange={(v) => setSettings({ ...settings, lightPanel: v })}
              />
              <Toggle
                label="اسپلش هنگام نرسیدن تصویر"
                hint="تا رسیدن تصویر به تلویزیون (اشتراک صفحه، تعویض کانال یا لینک ویدیو) همان اسپلش شروع برنامه پخش می‌شود و با آمدن تصویر قطع می‌شود."
                checked={settings.tvSplash !== false}
                onChange={(v) => setSettings({ ...settings, tvSplash: v })}
              />
            </div>
          </details>
        </div>

        <TranslatorSettings />

        <div className="flex gap-3">
          <button
            onClick={apply}
            className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            ذخیره و اعمال روی سرور
          </button>
          <button
            onClick={async () => {
              setSettings(defaultSettings);
              const api = getUms();
              if (api) await api.applySettings({ ...defaultSettings });
              await refresh();
              toast.success("تنظیمات به حالت پیش‌فرض بازگشت.");
            }}
            className="rounded-lg border border-border px-5 py-2.5 text-sm transition-colors hover:bg-accent"
          >
            بازنشانی
          </button>
        </div>
      </div>
    </AppLayout>
  );
}
