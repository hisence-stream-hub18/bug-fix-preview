// Warning window shown when the machine is under real pressure (CPU/RAM) or the
// app window stopped responding. It also carries the manual restart button and
// the "restart by itself" switch, so a weak PC never leaves the user stuck.

import { AlertTriangle, Cpu, RefreshCw, X } from "lucide-react";
import { useEffect, useState } from "react";
import { useSystemHealth } from "@/lib/ums-bridge";

export function SystemPressureDialog() {
  const { load, restart, setAutoRestart } = useSystemHealth(3000);
  const [dismissed, setDismissed] = useState(false);

  const level = load?.level ?? "ok";

  // A new pressure/hang episode must always be visible again.
  useEffect(() => {
    if (level === "ok") setDismissed(false);
  }, [level]);

  if (!load || level === "ok" || dismissed) return null;

  const hang = level === "hang";

  return (
    <div className="fixed inset-x-0 bottom-4 z-50 mx-auto w-[min(94vw,560px)] rounded-2xl border border-destructive/50 bg-card/95 p-4 shadow-2xl backdrop-blur">
      <div className="flex items-start gap-3">
        <span className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-xl bg-destructive/15 text-destructive">
          {hang ? <AlertTriangle className="size-5" /> : <Cpu className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">
            {hang
              ? `برنامه پاسخ نمی‌دهد (${load.hangSeconds} ثانیه)`
              : "فشار زیاد روی پردازنده یا حافظه"}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            {hang
              ? "برای ادامه کار، برنامه را ریستارت کنید یا ریستارت خودکار را روشن بگذارید."
              : "برای جلوگیری از هنگ، کیفیت اشتراک صفحه کاهش داده می‌شود؛ می‌توانید حالت سبک را در تنظیمات فعال کنید."}
          </p>
          <p className="mt-2 text-[11px] text-muted-foreground" dir="ltr">
            CPU {load.cpu}% · {load.cores} cores · RAM {load.usedPercent}% ({load.freeMb} MB free) ·
            app {load.appMb} MB
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              onClick={() => void restart()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground"
            >
              <RefreshCw className="size-3.5" />
              ریستارت دستی برنامه
            </button>
            <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs">
              <input
                type="checkbox"
                checked={load.autoRestart}
                onChange={(e) => void setAutoRestart(e.target.checked)}
              />
              ریستارت خودکار هنگام هنگ
            </label>
          </div>
        </div>
        <button
          onClick={() => setDismissed(true)}
          aria-label="بستن هشدار"
          className="rounded-lg p-1 text-muted-foreground hover:bg-accent"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
