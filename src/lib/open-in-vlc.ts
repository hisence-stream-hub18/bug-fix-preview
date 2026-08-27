// "Open in VLC" — for saved and direct links.
//   • Windows/desktop → the Electron main process launches vlc.exe with the URL
//   • Android         → an explicit intent: URL targeting org.videolan.vlc
//   • Browser preview → the vlc:// protocol handler, when one is registered
//
// Every path degrades to a readable Persian error instead of doing nothing.

import { toast } from "sonner";
import { getUms } from "./ums-bridge";

type VlcCapableApi = {
  platform?: string;
  openInVlc?: (url: string) => Promise<{ ok: boolean; error?: string }>;
  openExternal?: (url: string) => Promise<boolean>;
};

export function canOpenInVlc(source: string) {
  return Boolean(String(source || "").trim());
}

function androidIntent(url: string) {
  const clean = url.replace(/^https?:\/\//i, "");
  const scheme = /^https:/i.test(url) ? "https" : "http";
  return `intent://${clean}#Intent;scheme=${scheme};type=video/*;package=org.videolan.vlc;S.browser_fallback_url=${encodeURIComponent(
    url,
  )};end`;
}

export async function openInVlc(source: string, title?: string) {
  const url = String(source || "").trim();
  if (!url) {
    toast.error("لینکی برای باز کردن در VLC وجود ندارد.");
    return false;
  }

  const api = getUms() as unknown as VlcCapableApi | null;

  // Desktop (Windows/macOS/Linux): real process launch.
  if (api?.openInVlc) {
    const res = await api.openInVlc(url);
    if (res?.ok) {
      toast.success(`«${title || "پخش"}» در VLC باز شد.`);
      return true;
    }
    toast.error(res?.error || "VLC روی این سیستم پیدا نشد؛ آن را نصب کنید.");
    return false;
  }

  const isAndroid =
    typeof navigator !== "undefined" && /android/i.test(navigator.userAgent || "");

  if (isAndroid && /^https?:\/\//i.test(url)) {
    window.location.href = androidIntent(url);
    return true;
  }

  // Web / other: try the vlc:// protocol handler.
  try {
    window.location.href = `vlc://${url.replace(/^[a-z]+:\/\//i, "")}`;
    toast.message("در حال باز کردن VLC…", {
      description: "اگر چیزی باز نشد، VLC را نصب کنید یا از پلیر داخلی استفاده کنید.",
    });
    return true;
  } catch {
    toast.error("باز کردن VLC ممکن نشد.");
    return false;
  }
}
