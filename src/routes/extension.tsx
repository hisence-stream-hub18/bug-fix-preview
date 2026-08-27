import { createFileRoute } from "@tanstack/react-router";
import { Chrome, Download } from "lucide-react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";

export const Route = createFileRoute("/extension")({
  head: () => ({
    meta: [
      { title: "افزونه مرورگر | مدیا سرور" },
      {
        name: "description",
        content:
          "افزونه کروم و اج مدیا سرور: دکمه دانلود و پخش در تلویزیون کنار ویدیوهای یوتیوب، اینستاگرام و هر سایت.",
      },
      { property: "og:title", content: "افزونه مرورگر مدیا سرور" },
      {
        property: "og:description",
        content: "گرفتن لینک ویدیو از مرورگر و فرستادن آن به برنامه دسکتاپ با یک کلیک.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: ExtensionPage,
});

const steps = [
  "فایل ZIP دانلودشده را از حالت فشرده خارج کنید.",
  "در کروم یا اج آدرس chrome://extensions را باز کنید.",
  "گزینه Developer mode را از گوشه بالا فعال کنید.",
  "روی Load unpacked بزنید و پوشه استخراج‌شده را انتخاب کنید.",
  "برنامه دسکتاپ باید باز باشد؛ سپس کنار ویدیوها دکمه‌های «تلویزیون / دانلود / مخزن» ظاهر می‌شود.",
];

function ExtensionPage() {
  const download = () => {
    fetch("/ums-extension.zip")
      .then((res) => {
        if (!res.ok) throw new Error("دانلود انجام نشد");
        return res.blob();
      })
      .then((blob) => {
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = "ums-extension.zip";
        a.click();
        URL.revokeObjectURL(a.href);
      })
      .catch((err: Error) => toast.error(err.message));
  };

  return (
    <AppLayout
      title="افزونه مرورگر"
      subtitle="دکمه دانلود و پخش در تلویزیون، کنار ویدیوهای یوتیوب و اینستاگرام"
    >
      <div className="max-w-2xl space-y-6 rounded-xl border border-border bg-card p-6">
        <p className="text-sm leading-7 text-muted-foreground">
          این افزونه در هر صفحه‌ای که ویدیو دارد یک حباب کوچک نشان می‌دهد؛ با یک کلیک لینک ویدیو به
          برنامه دسکتاپ فرستاده می‌شود تا دانلود شود یا مستقیم روی تلویزیون پخش شود.
        </p>
        <button
          onClick={download}
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          <Download className="size-4" />
          دانلود افزونه (ZIP)
        </button>
        <ol className="space-y-2 text-sm">
          {steps.map((s, i) => (
            <li key={s} className="flex gap-2">
              <span className="text-primary">{i + 1}.</span>
              <span>{s}</span>
            </li>
          ))}
        </ol>
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Chrome className="size-4" />
          سازگار با Chrome، Edge، Brave و Opera.
        </p>
      </div>
    </AppLayout>
  );
}
