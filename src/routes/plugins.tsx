import { createFileRoute } from "@tanstack/react-router";
import {
  CheckCircle2,
  Download,
  FolderOpen,
  Package,
  Plug,
  RefreshCw,
  RotateCw,
  Trash2,
  TriangleAlert,
  Wrench,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { getUms, type AppPlugin, type DependencyReport } from "@/lib/ums-bridge";

export const Route = createFileRoute("/plugins")({
  head: () => ({
    meta: [
      { title: "افزونه‌ها و وابستگی‌های مدیا سرور" },
      {
        name: "description",
        content:
          "بررسی و نصب خودکار ffmpeg و yt-dlp، آزمایش اشتراک صفحه دسکتاپ و مدیریت افزونه‌های برنامه.",
      },
      { property: "og:title", content: "افزونه‌ها و وابستگی‌های مدیا سرور" },
      {
        property: "og:description",
        content: "تعمیر خودکار وابستگی‌ها، ریستارت برنامه و نصب افزونه بدون آپدیت کل نرم‌افزار.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: PluginsPage,
});

const DESKTOP_ONLY = "این بخش فقط در نسخه دسکتاپ برنامه فعال است.";

function downloadSample() {
  fetch("/live-listen-plugin.zip")
    .then((res) => {
      if (!res.ok) throw new Error("دانلود افزونه نمونه انجام نشد");
      return res.blob();
    })
    .then((blob) => {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "live-listen-plugin.zip";
      a.click();
      URL.revokeObjectURL(a.href);
    })
    .catch((err: Error) => toast.error(err.message));
}

function PluginsPage() {
  const [report, setReport] = useState<DependencyReport | null>(null);
  const [plugins, setPlugins] = useState<AppPlugin[]>([]);
  const [busy, setBusy] = useState("");
  const [log, setLog] = useState<string[]>([]);

  const refresh = useCallback(async () => {
    const api = getUms();
    if (!api?.depsCheck) return;
    const [deps, list] = await Promise.all([
      api.depsCheck().catch(() => null),
      api.pluginList?.().catch(() => []) ?? Promise.resolve([]),
    ]);
    if (deps) setReport(deps);
    setPlugins(list ?? []);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const runRepair = async (restart: boolean, force = false) => {
    const api = getUms();
    if (!api?.depsRepair) {
      toast.error(DESKTOP_ONLY);
      return;
    }
    setBusy(restart ? "restart" : "repair");
    try {
      const res = await api.depsRepair({ force, restart });
      setLog(res.log ?? []);
      setReport(res);
      if (res.restarting) {
        toast.success("وابستگی‌ها بررسی شد؛ برنامه در حال ریستارت است…");
        return;
      }
      toast[res.ok ? "success" : "error"](
        res.ok ? "همه وابستگی‌ها آماده‌اند." : "برخی وابستگی‌ها نصب نشدند؛ گزارش را ببینید.",
      );
    } catch (err) {
      // Without this the button silently did nothing when the main process threw.
      toast.error(`خطا در بررسی وابستگی‌ها: ${(err as Error)?.message ?? "نامشخص"}`);
    } finally {
      setBusy("");
    }
  };

  const runTest = async () => {
    const api = getUms();
    if (!api?.depsTest) {
      toast.error(DESKTOP_ONLY);
      return;
    }
    setBusy("test");
    try {
      const res = await api.depsTest();
      if (res.ok) toast.success("آزمایش ضبط صفحه موفق بود؛ اشتراک صفحه کار می‌کند.");
      else toast.error(res.error || "آزمایش ضبط صفحه ناموفق بود.");
    } catch (err) {
      toast.error(`آزمایش ناموفق بود: ${(err as Error)?.message ?? "نامشخص"}`);
    } finally {
      setBusy("");
    }
  };

  const installPlugin = async () => {
    const api = getUms();
    if (!api?.pluginInstall) {
      toast.error(DESKTOP_ONLY);
      return;
    }
    setBusy("install");
    try {
      const res = await api.pluginInstall();
      if (res.canceled) return;
      if (!res.ok) {
        toast.error(res.error || "نصب افزونه ناموفق بود.");
        return;
      }
      toast.success(`افزونه «${res.plugin?.name ?? ""}» نصب شد.`);
      await refresh();
    } catch (err) {
      toast.error(`نصب افزونه ناموفق بود: ${(err as Error)?.message ?? "نامشخص"}`);
    } finally {
      setBusy("");
    }
  };


  const togglePlugin = async (p: AppPlugin) => {
    const api = getUms();
    const res = await api?.pluginSetEnabled?.({ id: p.id, enabled: !p.enabled });
    if (res && !res.ok) toast.error(res.error || "تغییر وضعیت افزونه ناموفق بود.");
    await refresh();
  };

  const removePlugin = async (p: AppPlugin) => {
    const api = getUms();
    const res = await api?.pluginRemove?.({ id: p.id });
    if (res && !res.ok) toast.error(res.error || "حذف افزونه ناموفق بود.");
    else toast.success("افزونه حذف شد.");
    await refresh();
  };

  return (
    <AppLayout
      title="افزونه‌ها و وابستگی‌ها"
      subtitle="کنترل و نصب خودکار ابزارهای موردنیاز، ریستارت برنامه و افزودن افزونه"
    >
      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Wrench className="size-4 text-primary" /> وابستگی‌های برنامه
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              اگر دکمه «اشتراک صفحه دسکتاپ» خطا می‌دهد، از همین‌جا بررسی و تعمیر کنید.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => void refresh()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
            >
              <RefreshCw className="size-3.5" /> بررسی مجدد
            </button>
            <button
              onClick={() => void runTest()}
              disabled={busy !== ""}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10 disabled:opacity-60"
            >
              <CheckCircle2 className="size-3.5" />
              {busy === "test" ? "در حال آزمایش…" : "آزمایش اشتراک صفحه"}
            </button>
            <button
              onClick={() => void runRepair(false, true)}
              disabled={busy !== ""}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent disabled:opacity-60"
            >
              <Wrench className="size-3.5" />
              {busy === "repair" ? "در حال نصب…" : "نصب/آپدیت وابستگی‌ها"}
            </button>
            <button
              onClick={() => void runRepair(true)}
              disabled={busy !== ""}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <RotateCw className="size-3.5" />
              {busy === "restart" ? "در حال ریستارت…" : "بررسی، نصب و ریستارت"}
            </button>
          </div>
        </div>

        {report ? (
          <ul className="mt-4 divide-y divide-border">
            {report.items.map((item) => (
              <li key={item.id} className="flex items-start gap-3 py-3">
                {item.ok ? (
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-primary" />
                ) : (
                  <TriangleAlert
                    className={`mt-0.5 size-4 shrink-0 ${
                      item.required ? "text-destructive" : "text-muted-foreground"
                    }`}
                  />
                )}
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">{item.name}</p>
                  <p className="mt-0.5 break-all text-xs text-muted-foreground" dir="auto">
                    {item.detail}
                  </p>
                </div>
                <span
                  className={`shrink-0 rounded-md px-2 py-1 text-xs ${
                    item.ok
                      ? "bg-primary/15 text-primary"
                      : item.required
                        ? "bg-destructive/15 text-destructive"
                        : "bg-secondary text-muted-foreground"
                  }`}
                >
                  {item.ok ? "آماده" : item.required ? "لازم است" : "اختیاری"}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">{DESKTOP_ONLY}</p>
        )}

        {report?.binDir ? (
          <p className="mt-3 break-all text-xs text-muted-foreground" dir="ltr">
            {report.binDir}
          </p>
        ) : null}

        {log.length ? (
          <div className="mt-4 rounded-lg bg-secondary p-3">
            <p className="text-xs font-semibold">گزارش آخرین تعمیر</p>
            <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
              {log.map((line, i) => (
                <li key={i} dir="auto">
                  {line}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </section>

      <section className="mt-6 rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="flex items-center gap-2 text-base font-semibold">
              <Plug className="size-4 text-primary" /> افزونه‌ها
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              قابلیت‌های جدید را به‌صورت افزونه اضافه کنید؛ نیازی به آپدیت کل نرم‌افزار نیست.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              onClick={downloadSample}
              className="inline-flex items-center gap-1.5 rounded-lg border border-primary/50 px-3 py-1.5 text-xs text-primary transition-colors hover:bg-primary/10"
            >
              <Download className="size-3.5" /> افزونه نمونه «شنود صدا» (ZIP)
            </button>
            <button
              onClick={() => void getUms()?.pluginFolder?.()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
            >
              <FolderOpen className="size-3.5" /> پوشه افزونه‌ها
            </button>
            <button
              onClick={() => void installPlugin()}
              disabled={busy !== ""}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-60"
            >
              <Package className="size-3.5" />
              {busy === "install" ? "در حال نصب…" : "نصب افزونه (zip یا پوشه)"}
            </button>
          </div>
        </div>

        {plugins.length === 0 ? (
          <p className="mt-4 text-sm text-muted-foreground">
            هنوز افزونه‌ای نصب نشده است. یک پوشه شامل <span dir="ltr">plugin.json</span> و{" "}
            <span dir="ltr">index.cjs</span> بسازید و آن را نصب کنید.
          </p>
        ) : (
          <ul className="mt-4 space-y-3">
            {plugins.map((p) => (
              <li key={p.id} className="rounded-lg border border-border p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {p.name} <span className="text-xs text-muted-foreground">{p.version}</span>
                    </p>
                    {p.description ? (
                      <p className="mt-1 text-xs text-muted-foreground">{p.description}</p>
                    ) : null}
                    {p.error ? (
                      <p className="mt-1 text-xs text-destructive" dir="auto">
                        {p.error}
                      </p>
                    ) : null}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`rounded-md px-2 py-1 text-xs ${
                        p.enabled && p.loaded
                          ? "bg-primary/15 text-primary"
                          : "bg-secondary text-muted-foreground"
                      }`}
                    >
                      {p.enabled ? (p.loaded ? "فعال" : "خطا در بارگذاری") : "غیرفعال"}
                    </span>
                    <button
                      onClick={() => void togglePlugin(p)}
                      className="rounded-lg border border-border px-3 py-1.5 text-xs transition-colors hover:bg-accent"
                    >
                      {p.enabled ? "غیرفعال کردن" : "فعال کردن"}
                    </button>
                    <button
                      onClick={() => void removePlugin(p)}
                      aria-label="حذف افزونه"
                      className="rounded-lg border border-destructive/50 p-1.5 text-destructive transition-colors hover:bg-destructive/10"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>
    </AppLayout>
  );
}
