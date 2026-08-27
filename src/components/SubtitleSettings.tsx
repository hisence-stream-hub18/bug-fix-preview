// Subtitle control panel: source/target language, font size, timing offset and
// a place to add languages the built-in list is missing (typed or uploaded as a
// small JSON/CSV list of "code,label" pairs).
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  addCustomLanguage,
  allLanguages,
  readCustomLanguages,
  removeCustomLanguage,
  type Language,
  type SubtitlePrefs,
} from "@/lib/languages";

export function SubtitleSettings({
  prefs,
  onChange,
}: {
  prefs: SubtitlePrefs;
  onChange: (next: SubtitlePrefs) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [custom, setCustom] = useState<Language[]>([]);
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");

  useEffect(() => setCustom(readCustomLanguages()), []);

  const languages = [...allLanguages()];

  const addManual = () => {
    const c = code.trim();
    const l = label.trim();
    if (!c || !l) {
      toast.error("کد زبان و نام آن را وارد کنید.");
      return;
    }
    setCustom(addCustomLanguage({ code: c, label: l }));
    setCode("");
    setLabel("");
    toast.success(`زبان «${l}» اضافه شد.`);
  };

  const upload = async (file: File) => {
    const text = await file.text();
    let list: Language[] = [];
    try {
      const parsed = JSON.parse(text) as Language[] | Record<string, string>;
      list = Array.isArray(parsed)
        ? parsed
        : Object.entries(parsed).map(([c, l]) => ({ code: c, label: String(l) }));
    } catch {
      list = text
        .split(/\r?\n/)
        .map((line) => line.split(/[,;\t]/))
        .filter((p) => p.length >= 2)
        .map((p) => ({ code: String(p[0]).trim(), label: String(p[1]).trim() }));
    }
    const valid = list.filter((l) => l && l.code && l.label);
    if (!valid.length) {
      toast.error("فایل زبان خوانده نشد (JSON یا code,label).");
      return;
    }
    let next = custom;
    for (const l of valid) next = addCustomLanguage(l);
    setCustom(next);
    toast.success(`${valid.length} زبان اضافه شد.`);
  };

  return (
    <div className="space-y-3 border-t border-border px-4 py-3 text-xs">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="space-y-1">
          <span className="text-muted-foreground">زبان مبدأ زیرنویس</span>
          <select
            value={prefs.source}
            onChange={(e) => onChange({ ...prefs, source: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 outline-none focus:border-primary"
          >
            <option value="auto">تشخیص خودکار</option>
            {languages.map((l) => (
              <option key={`s-${l.code}`} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">زبان ترجمه (مقصد)</span>
          <select
            value={prefs.target}
            onChange={(e) => onChange({ ...prefs, target: e.target.value })}
            className="w-full rounded-lg border border-input bg-background px-2 py-1.5 outline-none focus:border-primary"
          >
            {languages.map((l) => (
              <option key={`t-${l.code}`} value={l.code}>
                {l.label} ({l.code})
              </option>
            ))}
          </select>
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">اندازه متن: {prefs.size}%</span>
          <input
            type="range"
            min={60}
            max={220}
            step={10}
            value={prefs.size}
            onChange={(e) => onChange({ ...prefs, size: Number(e.target.value) })}
            className="w-full accent-primary"
          />
        </label>
        <label className="space-y-1">
          <span className="text-muted-foreground">
            تأخیر زیرنویس: {(prefs.offsetMs / 1000).toFixed(1)} ثانیه
          </span>
          <input
            type="range"
            min={-10000}
            max={10000}
            step={100}
            value={prefs.offsetMs}
            onChange={(e) => onChange({ ...prefs, offsetMs: Number(e.target.value) })}
            className="w-full accent-primary"
          />
        </label>
      </div>

      <div className="space-y-2 rounded-lg border border-border p-3">
        <p className="text-muted-foreground">افزودن زبان جدید به کتابخانه ترجمه</p>
        <div className="flex flex-wrap gap-2">
          <input
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="کد: مثلاً ckb"
            className="w-32 rounded-lg border border-input bg-background px-2 py-1.5 outline-none focus:border-primary"
          />
          <input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="نام زبان"
            className="w-36 rounded-lg border border-input bg-background px-2 py-1.5 outline-none focus:border-primary"
          />
          <button
            onClick={addManual}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-semibold text-primary-foreground"
          >
            <Plus className="size-3.5" /> افزودن
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".json,.csv,.txt"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void upload(f);
              e.target.value = "";
            }}
          />
          <button
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 hover:bg-accent"
          >
            <Upload className="size-3.5" /> آپلود فهرست زبان
          </button>
        </div>
        {custom.length ? (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {custom.map((l) => (
              <span
                key={l.code}
                className="inline-flex items-center gap-1 rounded-full border border-primary/40 px-2 py-0.5 text-[11px]"
              >
                {l.label} ({l.code})
                <button
                  onClick={() => setCustom(removeCustomLanguage(l.code))}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3" />
                </button>
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}
