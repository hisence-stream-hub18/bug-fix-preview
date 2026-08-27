// Full world-language table for subtitle translation, plus user-added
// languages (stored locally) for anything the built-in list is missing.

export type Language = { code: string; label: string };

export const LANGUAGES: Language[] = [
  { code: "fa", label: "فارسی" },
  { code: "en", label: "انگلیسی" },
  { code: "ar", label: "عربی" },
  { code: "tr", label: "ترکی" },
  { code: "az", label: "آذربایجانی" },
  { code: "ku", label: "کردی" },
  { code: "ps", label: "پشتو" },
  { code: "ur", label: "اردو" },
  { code: "hi", label: "هندی" },
  { code: "bn", label: "بنگالی" },
  { code: "pa", label: "پنجابی" },
  { code: "ta", label: "تامیل" },
  { code: "te", label: "تلوگو" },
  { code: "ml", label: "مالایالام" },
  { code: "mr", label: "مراتی" },
  { code: "gu", label: "گجراتی" },
  { code: "ne", label: "نپالی" },
  { code: "si", label: "سینهالی" },
  { code: "th", label: "تایلندی" },
  { code: "vi", label: "ویتنامی" },
  { code: "id", label: "اندونزیایی" },
  { code: "ms", label: "مالایی" },
  { code: "tl", label: "فیلیپینی" },
  { code: "zh-CN", label: "چینی ساده" },
  { code: "zh-TW", label: "چینی سنتی" },
  { code: "ja", label: "ژاپنی" },
  { code: "ko", label: "کره‌ای" },
  { code: "ru", label: "روسی" },
  { code: "uk", label: "اوکراینی" },
  { code: "be", label: "بلاروسی" },
  { code: "pl", label: "لهستانی" },
  { code: "cs", label: "چکی" },
  { code: "sk", label: "اسلواکی" },
  { code: "hu", label: "مجاری" },
  { code: "ro", label: "رومانیایی" },
  { code: "bg", label: "بلغاری" },
  { code: "sr", label: "صربی" },
  { code: "hr", label: "کرواتی" },
  { code: "bs", label: "بوسنیایی" },
  { code: "sl", label: "اسلوونیایی" },
  { code: "mk", label: "مقدونی" },
  { code: "sq", label: "آلبانیایی" },
  { code: "el", label: "یونانی" },
  { code: "it", label: "ایتالیایی" },
  { code: "es", label: "اسپانیایی" },
  { code: "pt", label: "پرتغالی" },
  { code: "fr", label: "فرانسوی" },
  { code: "de", label: "آلمانی" },
  { code: "nl", label: "هلندی" },
  { code: "sv", label: "سوئدی" },
  { code: "no", label: "نروژی" },
  { code: "da", label: "دانمارکی" },
  { code: "fi", label: "فنلاندی" },
  { code: "is", label: "ایسلندی" },
  { code: "et", label: "استونیایی" },
  { code: "lv", label: "لتونیایی" },
  { code: "lt", label: "لیتوانیایی" },
  { code: "he", label: "عبری" },
  { code: "hy", label: "ارمنی" },
  { code: "ka", label: "گرجی" },
  { code: "kk", label: "قزاقی" },
  { code: "uz", label: "ازبکی" },
  { code: "tg", label: "تاجیکی" },
  { code: "tk", label: "ترکمنی" },
  { code: "ky", label: "قرقیزی" },
  { code: "mn", label: "مغولی" },
  { code: "my", label: "برمه‌ای" },
  { code: "km", label: "خمر" },
  { code: "lo", label: "لائوسی" },
  { code: "am", label: "امهری" },
  { code: "so", label: "سومالیایی" },
  { code: "sw", label: "سواحیلی" },
  { code: "ha", label: "هوسا" },
  { code: "yo", label: "یوروبا" },
  { code: "ig", label: "ایگبو" },
  { code: "zu", label: "زولو" },
  { code: "af", label: "آفریکانس" },
  { code: "mt", label: "مالتی" },
  { code: "ga", label: "ایرلندی" },
  { code: "cy", label: "ولزی" },
  { code: "eu", label: "باسکی" },
  { code: "ca", label: "کاتالان" },
  { code: "gl", label: "گالیسیایی" },
  { code: "la", label: "لاتین" },
  { code: "eo", label: "اسپرانتو" },
];

const CUSTOM_KEY = "ums.languages.custom";
const PREF_KEY = "ums.subtitle.prefs";

export type SubtitlePrefs = {
  target: string;
  source: string;
  size: number;
  offsetMs: number;
};

export const DEFAULT_PREFS: SubtitlePrefs = {
  target: "fa",
  source: "auto",
  size: 100,
  offsetMs: 0,
};

export function readCustomLanguages(): Language[] {
  try {
    const raw = localStorage.getItem(CUSTOM_KEY);
    const list = raw ? (JSON.parse(raw) as Language[]) : [];
    return Array.isArray(list) ? list.filter((l) => l && l.code && l.label) : [];
  } catch {
    return [];
  }
}

export function addCustomLanguage(lang: Language): Language[] {
  const list = readCustomLanguages().filter((l) => l.code !== lang.code);
  const next = [...list, lang];
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function removeCustomLanguage(code: string): Language[] {
  const next = readCustomLanguages().filter((l) => l.code !== code);
  try {
    localStorage.setItem(CUSTOM_KEY, JSON.stringify(next));
  } catch {
    /* quota */
  }
  return next;
}

export function allLanguages(): Language[] {
  return [...LANGUAGES, ...readCustomLanguages()];
}

export function languageLabel(code: string): string {
  return allLanguages().find((l) => l.code === code)?.label || code;
}

export function readSubtitlePrefs(): SubtitlePrefs {
  try {
    const raw = localStorage.getItem(PREF_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as Partial<SubtitlePrefs>) } : DEFAULT_PREFS;
  } catch {
    return DEFAULT_PREFS;
  }
}

export function writeSubtitlePrefs(prefs: SubtitlePrefs) {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify(prefs));
  } catch {
    /* quota */
  }
}
