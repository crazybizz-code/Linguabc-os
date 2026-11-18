import { uz } from "./uz";
import { ru } from "./ru";

export type Locale = "en" | "uz" | "ru";
export const LOCALES: { code: Locale; label: string }[] = [
  { code: "uz", label: "O'zbekcha" },
  { code: "ru", label: "Русский" },
  { code: "en", label: "English" },
];

const DICTS: Record<Locale, Record<string, string>> = { en: {}, uz, ru };

export type Vars = Record<string, string | number | null | undefined>;
export type T = (text: string, vars?: Vars) => string;

/**
 * gettext-style translator: the English sentence is the key, so English
 * needs no dictionary and a missing translation falls back to English.
 * Placeholders: "{n} students".
 */
export function translator(locale: Locale): T {
  const dict = DICTS[locale] ?? {};
  return (text, vars) => {
    const out = dict[text] ?? text;
    return vars ? out.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? "")) : out;
  };
}

/** Number locale for Intl formatting. */
export const intlLocale = (l: Locale) => (l === "ru" ? "ru-RU" : l === "uz" ? "uz-Latn-UZ" : "en-GB");

export function isLocale(v: unknown): v is Locale {
  return v === "en" || v === "uz" || v === "ru";
}
