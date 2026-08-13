/**
 * Vendored Koboyo product glyphs (connector / artifact tiles).
 * Offline monochrome SVGs — paint via KoboyoIcon CSS mask, not bare <img>.
 */

export const KOBOYO_CLICK_CURSOR = "/illustrations/koboyo/click-cursor.svg";
export const KOBOYO_COMPASS = "/illustrations/koboyo/compass.svg";
export const KOBOYO_BROWSER_WINDOW = "/illustrations/koboyo/browser-window.svg";
export const KOBOYO_WORD_DOCUMENT = "/illustrations/koboyo/word-document.svg";
export const KOBOYO_FILE_SPREADSHEET =
  "/illustrations/koboyo/file-spreadsheet.svg";
export const KOBOYO_PDF_BOOKMARK = "/illustrations/koboyo/pdf-bookmark.svg";

/** Store chrome: summoned experts list + create CTA. */
export const KOBOYO_USERS_ROUND = "/illustrations/koboyo/users-round.svg";
export const KOBOYO_USER_PLUS = "/illustrations/koboyo/user-plus.svg";
/** Store chrome: add connector CTA. */
export const KOBOYO_BADGE_PLUS = "/illustrations/koboyo/badge-plus.svg";
/** Primary rail: Experts — person + star (Koboyo user-star; clear at small size). */
export const KOBOYO_USER_STAR = "/illustrations/koboyo/user-star.svg";
/** @deprecated Prefer KOBOYO_USER_STAR for rail; kept for any leftover imports. */
export const KOBOYO_CONSULTANT_BADGE =
  "/illustrations/koboyo/consultant-badge.svg";

/**
 * Soft-UI product icons (Imagine-generated PNGs) for built-in connectors.
 * Full-color rounded app marks — use as <img>, not CSS mask.
 */
export const BUILTIN_PLUGIN_ICON_PNG_BY_ID: Record<string, string> = {
  "computer-use": "/on-my-agent-logo.png",
  "browser-skill": "/connector-icons/builtin/browser-skill.png",
  browser: "/connector-icons/builtin/browser.png",
  documents: "/connector-icons/builtin/documents.png",
  pdf: "/connector-icons/builtin/pdf.png",
  spreadsheets: "/connector-icons/builtin/spreadsheets.png",
};

/** @deprecated Prefer BUILTIN_PLUGIN_ICON_PNG_BY_ID for market tiles. */
export const BUILTIN_EXTENSION_KOBOYO_BY_ID: Record<string, string> = {
  "computer-use": KOBOYO_CLICK_CURSOR,
  "browser-skill": KOBOYO_COMPASS,
};

/** @deprecated Prefer BUILTIN_PLUGIN_ICON_PNG_BY_ID for market tiles. */
export const ARTIFACT_PLUGIN_KOBOYO_BY_ID: Record<string, string> = {
  browser: KOBOYO_BROWSER_WINDOW,
  documents: KOBOYO_WORD_DOCUMENT,
  pdf: KOBOYO_PDF_BOOKMARK,
  spreadsheets: KOBOYO_FILE_SPREADSHEET,
};
