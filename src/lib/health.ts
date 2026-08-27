// Channel health: the small green / red dot shown next to every channel.
//
// The desktop backend asks each stream for its first bytes with a short timeout
// (results are cached there for a few minutes), so the check is cheap and can be
// repeated whenever a list is opened. In the browser preview there is no backend,
// so the state stays "unknown" and no dot is drawn.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getUms } from "./ums-bridge";

export type Health = "up" | "down" | "unknown";

export function useStreamHealth(urls: string[], enabled = true) {
  const [map, setMap] = useState<Record<string, Health>>({});
  const [checking, setChecking] = useState(false);
  const inFlight = useRef(false);

  // A stable, de-duplicated key so the effect doesn't loop on every render.
  const list = useMemo(() => Array.from(new Set(urls.filter(Boolean))).slice(0, 300), [urls]);
  const signature = list.join("|");

  const run = useCallback(
    async (targets: string[]) => {
      const api = getUms();
      if (!api?.probeStreams || !targets.length || inFlight.current) return;
      inFlight.current = true;
      setChecking(true);
      try {
        const res = await api.probeStreams({ urls: targets, timeout: 6000 });
        const next: Record<string, Health> = {};
        for (const [url, value] of Object.entries(res?.results || {})) {
          next[url] = value?.ok ? "up" : "down";
        }
        setMap((prev) => ({ ...prev, ...next }));
      } catch {
        /* keep previous state */
      } finally {
        inFlight.current = false;
        setChecking(false);
      }
    },
    [],
  );

  useEffect(() => {
    if (!enabled || !signature) return;
    void run(list);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature, enabled]);

  const refresh = useCallback(() => run(list), [run, list]);
  const statusOf = useCallback((url: string): Health => map[url] ?? "unknown", [map]);

  return { statusOf, checking, refresh };
}

/** Tailwind classes for the status dot. */
export function healthDotClass(state: Health) {
  if (state === "up") return "bg-emerald-500";
  if (state === "down") return "bg-destructive";
  return "bg-muted-foreground/40";
}

export function healthTitle(state: Health) {
  if (state === "up") return "کانال در دسترس است";
  if (state === "down") return "کانال خاموش یا غیرقابل پخش است";
  return "وضعیت بررسی نشده";
}
