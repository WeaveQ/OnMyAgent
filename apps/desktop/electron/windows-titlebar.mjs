/**
 * Windows title-bar overlay — WeChat-style caption layer.
 * Keeps native min/max/close; the renderer paints a matching bar and
 * starts app chrome below it.
 */

export const WINDOWS_TITLEBAR_OVERLAY_HEIGHT = 32;

const WINDOWS_TITLEBAR_COLORS = {
  dark: { backgroundColor: "#141414", symbolColor: "#f3f3f3" },
  light: { backgroundColor: "#E4E2E3", symbolColor: "#171717" },
};

/**
 * @param {unknown} mode
 * @param {{ shouldUseDarkColors?: boolean } | null | undefined} nativeTheme
 */
export function resolveNativeThemeIsDark(mode, nativeTheme) {
  const value = String(mode ?? "").trim().toLowerCase();
  if (value === "dark") return true;
  if (value === "light") return false;
  return Boolean(nativeTheme?.shouldUseDarkColors);
}

/**
 * @param {boolean} isDark
 */
export function windowsTitleBarAppearance(isDark) {
  const colors = isDark ? WINDOWS_TITLEBAR_COLORS.dark : WINDOWS_TITLEBAR_COLORS.light;
  return {
    backgroundColor: colors.backgroundColor,
    titleBarStyle: "hidden",
    titleBarOverlay: {
      color: colors.backgroundColor,
      symbolColor: colors.symbolColor,
      height: WINDOWS_TITLEBAR_OVERLAY_HEIGHT,
    },
  };
}

/**
 * Guest-view fill for Linux system-frame windows.
 * Electron defaults to #FFFFFF; dark UI then shows a white ring at the CSD edge.
 */
export function themeWindowBackgroundColor(isDark) {
  return isDark
    ? WINDOWS_TITLEBAR_COLORS.dark.backgroundColor
    : WINDOWS_TITLEBAR_COLORS.light.backgroundColor;
}

/**
 * @param {boolean} isDark
 */
export function linuxWindowAppearance(isDark) {
  return { backgroundColor: themeWindowBackgroundColor(isDark) };
}

/**
 * @param {import("electron").BrowserWindow | null | undefined} win
 * @param {boolean} isDark
 * @param {{ color?: string } | null | undefined} [overlay]
 */
export function applyLinuxWindowBackground(win, isDark, overlay) {
  if (!win || typeof win.isDestroyed === "function" && win.isDestroyed()) return false;
  const color = normalizeOverlayColor(overlay?.color) ?? themeWindowBackgroundColor(isDark);
  try {
    win.setBackgroundColor?.(color);
    return true;
  } catch {
    return false;
  }
}

/**
 * @param {string | null | undefined} value
 */
export function normalizeOverlayColor(value) {
  const raw = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const rgb = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  const hex = (n) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
}

/**
 * @param {import("electron").BrowserWindow | null | undefined} win
 * @param {boolean} isDark
 * @param {{ color?: string, symbolColor?: string } | null | undefined} [overlay]
 */
export function applyWindowsTitleBarOverlay(win, isDark, overlay) {
  if (!win || typeof win.isDestroyed === "function" && win.isDestroyed()) return false;
  const appearance = windowsTitleBarAppearance(isDark);
  const color = normalizeOverlayColor(overlay?.color) ?? appearance.titleBarOverlay.color;
  const symbolColor =
    normalizeOverlayColor(overlay?.symbolColor) ?? appearance.titleBarOverlay.symbolColor;
  const spec = {
    ...appearance.titleBarOverlay,
    color,
    symbolColor,
  };
  try {
    win.setTitleBarOverlay?.(spec);
  } catch {
    return false;
  }
  try {
    win.setBackgroundColor?.(color);
  } catch {
    // Overlay can still apply if backgroundColor is rejected.
  }
  return true;
}
