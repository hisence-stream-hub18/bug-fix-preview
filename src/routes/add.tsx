import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { toast } from "sonner";
import { AppLayout } from "@/components/AppLayout";
import { PasteButton } from "@/components/PasteButton";
import { KIND_LABEL, detectKind, usePlaylist, type MediaKind } from "@/lib/ums-store";

export const Route = createFileRoute("/add")({
  head: () => ({
    meta: [
      { title: "افزودن لینک استریم | مدیا سرور" },
      {
        name: "description",
        content: "افزودن لینک یوتیوب، M3U8، ویدیو HTTP، RTSP یا پلی‌لیست IPTV به لیست پخش سرور.",
      },
      { property: "og:title", content: "افزودن لینک استریم" },
      { property: "og:description", content: "لینک آنلاین را به لیست پخش مدیا سرور اضافه کنید." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: AddLink,
});

const kinds: MediaKind[] = ["youtube", "hls", "http", "rtsp", "iptv"];

function AddLink() {
  const [, setPlaylist] = usePlaylist();
  const navigate = useNavigate();
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [kind, setKind] = useState<MediaKind | "auto">("auto");
  const [note, setNote] = useState("");

  const detected = url.trim() ? detectKind(url) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!url.trim()) {
      toast.error("لطفاً آدرس لینک را وارد کنید.");
      return;
    }
    const finalKind = kind === "auto" ? detectKind(url) : kind;
    setPlaylist((prev) => [
      {
        id: `m-${Date.now().toString(36)}`,
        title: title.trim() || url.trim().slice(0, 60),
        url: url.trim(),
        kind: finalKind,
        ...(note.trim() ? { note: note.trim() } : {}),
        addedAt: Date.now(),
      },
      ...prev,
    ]);
    toast.success("لینک به لیست پخش اضافه شد.");
    navigate({ to: "/playlist" });
  };

  return (
    <AppLayout title="افزودن لینک" subtitle="لینک آنلاین را وارد کنید تا برای تلویزیون آماده شود">
      <form
        onSubmit={submit}
        className="max-w-2xl space-y-5 rounded-xl border border-border bg-card p-6"
      >
        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="url">
            آدرس لینک
          </label>
          <div className="flex gap-2">
            <input
              id="url"
              dir="ltr"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://example.com/live/stream.m3u8"
              className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
            />
            <PasteButton onPaste={setUrl} />
          </div>
          {detected ? (
            <p className="mt-2 text-xs text-primary">نوع شناسایی‌شده: {KIND_LABEL[detected]}</p>
          ) : null}
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="title">
            عنوان نمایشی
          </label>
          <input
            id="title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="مثلاً: شبکه ورزش HD"
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="kind">
            نوع لینک
          </label>
          <select
            id="kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as MediaKind | "auto")}
            className="w-full rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          >
            <option value="auto">تشخیص خودکار</option>
            {kinds.map((k) => (
              <option key={k} value={k}>
                {KIND_LABEL[k]}
              </option>
            ))}
          </select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium" htmlFor="note">
            توضیح (اختیاری)
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            className="w-full resize-none rounded-lg border border-input bg-background px-3 py-2.5 text-sm outline-none focus:border-primary"
          />
        </div>

        <button
          type="submit"
          className="rounded-lg bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
        >
          افزودن به لیست پخش
        </button>
      </form>
    </AppLayout>
  );
}
