import en from "./locales/en";
import zh from "./locales/zh";
import zhTW from "./locales/zh-TW";

/**
 * Supported languages
 */
export type Language = "en" | "zh" | "zh-TW";
export type Locale = Language;

/**
 * All supported languages - single source of truth
 */
export const LANGUAGES: Language[] = ["en", "zh", "zh-TW"];

/**
 * Language options for UI - single source of truth
 */
export const LANGUAGE_OPTIONS: Array<{
  value: Language;
  label: string;
  nativeName: string;
}> = [
  { value: "en", label: "English", nativeName: "English" },
  {
    value: "zh",
    label: "简体中文",
    nativeName: "简体中文",
  },
  {
    value: "zh-TW",
    label: "繁體中文",
    nativeName: "繁體中文",
  },
];

const DEFAULT_LANGUAGE: Language = "en";
const LANGUAGE_PREF_KEY = "onmyagent.language";
const CHINESE_REGION_TIME_ZONES = new Set([
  "Asia/Shanghai",
  "Asia/Chongqing",
  "Asia/Harbin",
  "Asia/Urumqi",
  "Asia/Hong_Kong",
  "Asia/Macau",
  "Asia/Taipei",
]);
const PLURAL_SUFFIX_EMPTY_LANGUAGES = new Set<Language>(["zh", "zh-TW"]);
const LANGUAGE_SET: ReadonlySet<string> = new Set(LANGUAGES);

/**
 * Current translation strings use an English-style plural suffix placeholder.
 * Some locales render the noun without a visible plural marker, so we keep
 * that suffix empty for them.
 */
export const pluralSuffix = (locale: Language, count: number): string => {
  if (PLURAL_SUFFIX_EMPTY_LANGUAGES.has(locale)) {
    return "";
  }

  return count === 1 ? "" : "s";
};

/**
 * Translation maps
 */
const TRANSLATIONS: Record<Language, Record<string, string>> = {
  en,
  zh,
  "zh-TW": zhTW,
};

/**
 * Type guard to validate if a value is a Language
 * Replaces long chains like: value === "en" || value === "zh"
 */
export const isLanguage = (value: unknown): value is Language => {
  return typeof value === "string" && LANGUAGE_SET.has(value);
};

export const detectInitialLanguage = (): Language => {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE;

  const languages =
    typeof navigator === "undefined"
      ? []
      : [
          ...(Array.isArray(navigator.languages) ? navigator.languages : []),
          navigator.language,
        ].filter((item): item is string => typeof item === "string" && item.length > 0);

  for (const raw of languages) {
    const language = raw.toLowerCase();
    if (language === "zh-tw" || language === "zh-hk" || language === "zh-mo" || language.startsWith("zh-hant")) {
      return "zh-TW";
    }
    if (language === "zh" || language.startsWith("zh-cn") || language.startsWith("zh-sg") || language.startsWith("zh-hans")) {
      return "zh";
    }
  }

  try {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (CHINESE_REGION_TIME_ZONES.has(timeZone)) {
      return timeZone === "Asia/Taipei" || timeZone === "Asia/Hong_Kong" || timeZone === "Asia/Macau"
        ? "zh-TW"
        : "zh";
    }
  } catch {
  }

  return DEFAULT_LANGUAGE;
};

let localeValue: Language = DEFAULT_LANGUAGE;
const localeListeners = new Set<() => void>();

/**
 * Get current locale
 */
export const currentLocale = (): Language => locale();
function locale(): Language {
  return localeValue;
}

export const subscribeToLocale = (listener: () => void) => {
  localeListeners.add(listener);
  return () => {
    localeListeners.delete(listener);
  };
};

function notifyLocaleListeners() {
  for (const listener of localeListeners) {
    listener();
  }
}

/**
 * Set locale and persist to localStorage
 */
export const setLocale = (newLocale: Language) => {
  if (!isLanguage(newLocale)) {
    console.warn(`Invalid locale: ${newLocale}, falling back to "en"`);
    newLocale = "en";
  }

  if (localeValue === newLocale) {
    return;
  }

  localeValue = newLocale;

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", newLocale);
  }

  // Persist to localStorage
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LANGUAGE_PREF_KEY, newLocale);
    } catch (e) {
      console.warn("Failed to persist language preference:", e);
    }
  }

  notifyLocaleListeners();
};

/**
 * Resolve a translation entry with the locale → English → null fallback chain.
 */
const lookupEntry = (loc: Language, candidateKey: string): string | null => {
  if (TRANSLATIONS[loc]?.[candidateKey]) return TRANSLATIONS[loc][candidateKey];
  if (loc !== "en" && TRANSLATIONS.en?.[candidateKey])
    return TRANSLATIONS.en[candidateKey];
  return null;
};

const pluralRulesByLanguage: Record<Language, Intl.PluralRules> = {
  en: new Intl.PluralRules("en"),
  zh: new Intl.PluralRules("zh"),
  "zh-TW": new Intl.PluralRules("zh-TW"),
};
const pluralRule = (loc: Language, count: number): Intl.LDMLPluralRule => {
  return pluralRulesByLanguage[loc].select(count);
};

/**
 * Pick the right key variant for a count. Tries `${key}_zero` (only when count === 0),
 * then `${key}_${rule}` (e.g. `_one` / `_other`), then `${key}_other`, then the bare
 * key. Asian locales (no grammatical plural) define only the bare key and hit the
 * final step. Each candidate runs through the locale → English fallback so an
 * untranslated key still resolves to the English `_one` / `_other` variant.
 */
const resolvePluralKey = (
  loc: Language,
  key: string,
  count: number,
): string => {
  const candidates: string[] = [];
  if (count === 0) candidates.push(`${key}_zero`);
  candidates.push(`${key}_${pluralRule(loc, count)}`, `${key}_other`, key);

  for (const candidate of candidates) {
    if (lookupEntry(loc, candidate) !== null) return candidate;
  }
  return key;
};

/**
 * Translation function with fallback behavior.
 * - Locale fallback: target language → English → key itself.
 * - Plural fallback: when params include a numeric `count`, the lookup picks
 *   `${key}_one` / `${key}_other` (or `${key}_zero` when count === 0) per
 *   `Intl.PluralRules`, and falls back to the bare key when no variants exist.
 */
type TranslationParams = Record<string, string | number> & { lng?: Language };

export const t = (
  key: string,
  paramsOrLocale?: TranslationParams | Language,
  legacyParams?: Record<string, string | number>,
): string => {
  const params =
    legacyParams ??
    (typeof paramsOrLocale === "string" ? undefined : paramsOrLocale);
  const loc: Language =
    typeof paramsOrLocale === "string"
      ? paramsOrLocale
      : isLanguage(params?.lng)
        ? params.lng
        : locale();

  const lookupKey =
    typeof params?.count === "number"
      ? resolvePluralKey(loc, key, params.count)
      : key;

  const result = lookupEntry(loc, lookupKey);
  if (result === null) return key;

  if (!params) return result;

  let out = result;
  for (const [k, v] of Object.entries(params)) {
    if (k === "lng") continue;
    out = out.replace(`{${k}}`, String(v));
  }
  return out;
};

/**
 * Initialize locale from localStorage or, for first-time users, browser region.
 * Call this during app initialization
 */
export const initLocale = (): Language => {
  if (typeof window === "undefined") {
    return DEFAULT_LANGUAGE;
  }

  try {
    const stored = window.localStorage.getItem(LANGUAGE_PREF_KEY);
    if (isLanguage(stored)) {
      localeValue = stored;
      if (typeof document !== "undefined") {
        document.documentElement.setAttribute("lang", stored);
      }
      return stored;
    }
  } catch (e) {
    console.warn("Failed to read language preference:", e);
  }

  const detected = detectInitialLanguage();
  localeValue = detected;

  if (typeof document !== "undefined") {
    document.documentElement.setAttribute("lang", detected);
  }

  return detected;
};
