// Floating "link catcher" bubble — the download-manager style helper.
//
// Desktop: the Electron main process watches the clipboard while the user
// browses in Chrome/Edge/Firefox and shows a native mini popup; its buttons
// arrive here as a `link-caught` event.
// Android / web: there is no background clipboard access, so the bubble appears
// inside the app whenever it regains focus and the clipboard holds a video link.

import { useCallback, useEffect, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Download, Tv, X, Plus } from "lucide-react";
import { toast } from "sonner";
import { getUms } from "@/lib/ums-bridge";
import {
  detectKind,
  detectPlatform,
  guessStreamCategory,
  useDownloads,
  useStreamVault,
} from "@/lib/ums-store";

const MEDIA_RE =
  /\.(m3u8|mpd|mp4|mkv|webm|avi|mov|flv|ts|m2ts|wmv|mp3|aac|m4a)(\?|$)|youtube\.com\/watch|youtu\.be\/|vimeo\.com\/\d+|aparat\.com\/v\//i;

export function isMediaLink(text: string | null | undefined) {
  const t = (text || "").trim();
  if (!t || t.length > 2000 || !/^https?:\/\//i.test(t)) return false;
  return MEDIA_RE.test(t);
}

function shortName(url: string) {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname.split("/").filter(Boolean).pop() || u.hostname).slice(
      0,
      60,
    );
  } catch {
    return url.slice(0, 60);
  }
}

export function LinkCatcher() {
  const navigate = useNavigate();
  const [, setVault] = useStreamVault();
  const [, setJobs] = useDownloads();
  const [pending, setPending] = useState<string>("");
  const [seen, setSeen] = useState<string>("");

  const saveToVault = useCallback(
    (url: string, title: string) => {
      setVault((prev) =>
        prev.some((s) => s.url === url)
          ? prev
          : [
              {
                id: `s-${Date.now()}`,
                title,
                url,
                category: guessStreamCategory(`${title} ${url}`),
                kind: detectKind(url),
                addedAt: Date.now(),
              },
              ...prev,
            ],
      );
    },
    [setVault],
  );

  const run = useCallback(
    (action: string, url: string, title?: string) => {
      const name = title || shortName(url);
      if (action === "download") {
        setJobs((prev) => [
          {
            id: `d-${Date.now()}`,
            title: name,
            url,
            platform: detectPlatform(url),
            genre: "music",
            progress: 0,
            status: "queued" as const,
            createdAt: Date.now(),
          },
          ...prev,
        ]);
        toast.success("لینک به صف دانلود اضافه شد.");
        void navigate({ to: "/download" });
        return;
      }
      saveToVault(url, name);
      if (action === "cast") {
        toast.success("لینک ذخیره شد؛ تلویزیون مقصد را انتخاب کنید.");
        void navigate({ to: "/streams" });
        return;
      }
      toast.success("لینک به مخزن استریم‌ها اضافه شد.");
      void navigate({ to: "/streams" });
    },
    [navigate, saveToVault, setJobs],
  );

  // Desktop popup actions
  useEffect(() => {
    const api = getUms();
    if (!api) return;
    return api.onEvent((data) => {
      if (data?.type !== "link-caught") return;
      const payload = data as Record<string, unknown>;
      const url = String(payload["url"] || "");
      if (!url) return;
      run(String(payload["action"] || "add"), url, String(payload["title"] || ""));
    });
  }, [run]);

  // Mobile / web: check the clipboard when the app comes back to the foreground.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const api = getUms();
    if (api && api.platform !== "android") return; // desktop uses the native popup
    const check = async () => {
      try {
        const text = await navigator.clipboard?.readText?.();
        if (isMediaLink(text) && text.trim() !== seen) setPending(text.trim());
      } catch {
        /* clipboard permission denied */
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => window.removeEventListener("focus", check);
  }, [seen]);

  if (!pending) return null;

  const dismiss = () => {
    setSeen(pending);
    setPending("");
  };

  return (
    <div className="fixed bottom-4 left-4 z-50 w-72 rounded-2xl border border-primary/40 bg-card/95 p-3 shadow-lg backdrop-blur">
      <div className="flex items-center gap-2">
        <span className="size-2 rounded-full bg-primary" />
        <strong className="text-xs text-primary">لینک ویدیو شناسایی شد</strong>
        <button onClick={dismiss} className="ms-auto text-muted-foreground" aria-label="بستن">
          <X className="size-4" />
        </button>
      </div>
      <p dir="ltr" className="mt-1 truncate text-[11px] text-muted-foreground">
        {shortName(pending)}
      </p>
      <div className="mt-2 flex gap-2">
        <button
          onClick={() => {
            run("cast", pending);
            dismiss();
          }}
          className="flex-1 rounded-lg bg-primary px-2 py-1.5 text-[11px] font-semibold text-primary-foreground"
        >
          <Tv className="mx-auto size-3" /> تلویزیون
        </button>
        <button
          onClick={() => {
            run("download", pending);
            dismiss();
          }}
          className="flex-1 rounded-lg border border-border px-2 py-1.5 text-[11px]"
        >
          <Download className="mx-auto size-3" /> دانلود
        </button>
        <button
          onClick={() => {
            run("add", pending);
            dismiss();
          }}
          className="flex-1 rounded-lg border border-border px-2 py-1.5 text-[11px]"
        >
          <Plus className="mx-auto size-3" /> مخزن
        </button>
      </div>
    </div>
  );
}
