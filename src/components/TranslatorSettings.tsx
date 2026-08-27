// «تنظیمات مترجم آنلاین» — بخش مستقل صفحه تنظیمات.
//
// زبان مقصد/مبدأ ترجمه زیرنویس، اندازه و اختلاف زمانی زیرنویس، افزودن زبان
// دلخواه (برای زبان‌هایی که در جدول داخلی نیستند)، تست اتصال مترجم و پاک‌کردن
// حافظه نهان ترجمه. همه مقادیر همان کلیدهای محلی پلیر داخلی را می‌نویسند،
// بنابراین پلیر بی‌درنگ از همین تنظیمات استفاده می‌کند.

import { useEffect, useState } from "react";
import { Eraser, Languages, Plus, Trash2, Wifi } from "lucide-react";
import { toast } from "sonner";
import {
  DEFAULT_PREFS,
  addCustomLanguage,
  allLanguages,
  readCustomLanguages,
  readSubtitlePrefs,
  removeCustomLanguage,
  writeSubtitlePrefs,
  type Language,
  type SubtitlePrefs,
} from "@/lib/languages";
import { translateChunk } from "@/lib/subtitle-translate";

export function TranslatorSettings() {
  const [prefs, setPrefs] = useState<SubtitlePrefs>(DEFAULT_PREFS);
  const [languages, setLanguages] = useState<Language[]>([]);
  const [custom, setCustom] = useState<Language[]>([]);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    setPrefs(readSubtitlePrefs());
    setLanguages(allLanguages());
    setCustom(readCustomLanguages());
  }, []);

  const update = (patch: Partial<SubtitlePrefs>) => {
    const next = { ...prefs, ...patch };
    setPrefs(next);
    writeSubtitlePrefs(next);
  };

  const addLang = () => {
    const c = code.trim();
    const l = label.trim();
    if (!c || !l) {
      toast.error("کد زبان (مثل sv) و نام آن را وارد کنید.");
      return;
    }
    addCustomLanguage({ code: c, label: l });
    setCustom(readCustomLanguages());
    setLanguages(allLanguages());
    setCode("");
    setLabel("");
    toast.success(`زبان «${l}» اضافه شد.`);
  };

  const dropLang = (c: string) => {
    removeCustomLanguage(c);
    setCustom(readCustomLanguages());
    setLanguages(allLanguages());
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await translateChunk("Hello, this is a subtitle test.", prefs.target || "fa", "auto");
      toast.success(`مترجم آنلاین در دسترس است: ${res.text.slice(0, 60)}`);
    } catch {
      toast.error("اتصال به سرویس ترجمه برقرار نشد؛ اینترنت یا فیلترشکن را بررسی کنید.");
    } finally {
      setTesting(false);
    }
  };

  const clearCache = () => {
    let removed = 0;
    try {
      for (const key of Object.keys(localStorage)) {
        if (key.startsWith("ums.tr.")) {
          localStorage.removeItem(key);
          removed++;
        }
      }
    } catch {
      /* ignore */
    }
    toast.success(`${removed} ترجمه ذخیره‌شده پاک شد.`);
  };

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Languages className="size-4 text-primary" /> تنظیمات مترجم آنلاین
      </p>
      <p className="mt-1 text-xs text-muted-foreground">
        زیرنویس هر فیلم یا کانال به‌صورت آنلاین ترجمه می‌شود؛ زبان مبدأ به‌طور خودکار تشخیص داده
        می‌شود و ترجمه‌ها برای دفعه‌های بعد ذخیره می‌شوند.
      </p>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium" htmlFor="tr-target">
            زبان مقصد ترجمه
          </label>
          <select
            id="tr-target"
            value={prefs.target}
            onChange={(e) => update({ target: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          >
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium" htmlFor="tr-source">
            زبان مبدأ زیرنویس
          </label>
          <select
            id="tr-source"
            value={prefs.source}
            onChange={(e) => update({ source: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          >
            <option value="auto">تشخیص خودکار</option>
            {languages.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium" htmlFor="tr-size">
            اندازه زیرنویس: {prefs.size}%
          </label>
          <input
            id="tr-size"
            type="range"
            min={60}
            max={200}
            step={5}
            value={prefs.size}
            onChange={(e) => update({ size: Number(e.target.value) })}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
          />
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium" htmlFor="tr-offset">
            اختلاف زمانی زیرنویس: {prefs.offsetMs > 0 ? "+" : ""}
            {prefs.offsetMs} ms
          </label>
          <input
            id="tr-offset"
            type="range"
            min={-10000}
            max={10000}
            step={100}
            value={prefs.offsetMs}
            onChange={(e) => update({ offsetMs: Number(e.target.value) })}
            className="h-1.5 w-full cursor-pointer appearance-none rounded-full bg-secondary accent-primary"
          />
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-dashed border-primary/30 p-3">
        <p className="text-xs font-medium">افزودن زبان دلخواه</p>
        <div className="mt-2 flex flex-wrap gap-2">
          <input
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="کد زبان: sv"
            className="w-28 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="نام زبان: سوئدی"
            className="flex-1 rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus:border-primary"
          />
          <button
            onClick={addLang}
            className="inline-flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <Plus className="size-3.5" /> افزودن
          </button>
        </div>
        {custom.length ? (
          <ul className="mt-2 flex flex-wrap gap-2">
            {custom.map((l) => (
              <li
                key={l.code}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2.5 py-1 text-[11px] text-primary"
              >
                {l.label} ({l.code})
                <button
                  onClick={() => dropLang(l.code)}
                  aria-label={`حذف ${l.label}`}
                  className="text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          onClick={() => void test()}
          disabled={testing}
          className="inline-flex items-center gap-2 rounded-lg border border-primary/40 px-3 py-2 text-xs text-primary transition-colors hover:bg-accent disabled:opacity-60"
        >
          <Wifi className="size-3.5" /> {testing ? "در حال آزمایش…" : "آزمایش اتصال مترجم"}
        </button>
        <button
          onClick={clearCache}
          className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-2 text-xs transition-colors hover:bg-accent"
        >
          <Eraser className="size-3.5" /> پاک‌کردن حافظه ترجمه‌ها
        </button>
      </div>
    </div>
  );
}
