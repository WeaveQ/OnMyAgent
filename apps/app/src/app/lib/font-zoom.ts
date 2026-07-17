export const FONT_ZOOM_STORAGE_KEY = "onmyagent.desktop-font-zoom.v1";
export const FONT_ZOOM_BASE_PX = 16;
export const FONT_ZOOM_STEP = 0.1;
export const FONT_ZOOM_MIN = 0.8;
export const FONT_ZOOM_MAX = 1.6;

/**
 * Discrete stops for the settings dropdown (and nearest-snap for shortcuts).
 * Aligns with FONT_ZOOM_STEP (0.1) between MIN and a practical max for UI.
 */
export const FONT_ZOOM_PRESETS = [
  0.8, 0.9, 1.0, 1.1, 1.2, 1.3, 1.4, 1.5, 1.6,
] as const;
export type FontZoomPreset = (typeof FONT_ZOOM_PRESETS)[number];

export type FontZoomShortcutAction = "in" | "out" | "reset";
export type FontZoomTarget = { setZoom: (scaleFactor: number) => Promise<void> };

export function clampFontZoom(value: number): number {
  return Math.min(FONT_ZOOM_MAX, Math.max(FONT_ZOOM_MIN, value));
}

export function normalizeFontZoom(value: number): number {
  return Math.round(clampFontZoom(value) * 100) / 100;
}

export function fontZoomPresetIndex(value: number): number {
  const normalized = normalizeFontZoom(value);
  let bestIndex = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (let index = 0; index < FONT_ZOOM_PRESETS.length; index += 1) {
    const distance = Math.abs(FONT_ZOOM_PRESETS[index] - normalized);
    if (distance < bestDistance) {
      bestDistance = distance;
      bestIndex = index;
    }
  }
  return bestIndex;
}

export function fontZoomFromPresetIndex(index: number): number {
  const clamped = Math.min(
    FONT_ZOOM_PRESETS.length - 1,
    Math.max(0, Math.round(index)),
  );
  return FONT_ZOOM_PRESETS[clamped];
}

export function parseFontZoomShortcut(event: {
  key: string;
  code: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
}): FontZoomShortcutAction | null {
  const mod = event.metaKey || event.ctrlKey;
  if (!mod || event.altKey) return null;

  if (
    event.code === "Equal" ||
    event.code === "NumpadAdd" ||
    event.key === "+" ||
    event.key === "="
  ) {
    return "in";
  }
  if (
    event.code === "Minus" ||
    event.code === "NumpadSubtract" ||
    event.key === "-" ||
    event.key === "_"
  ) {
    return "out";
  }
  if (event.code === "Digit0" || event.code === "Numpad0" || event.key === "0") {
    return "reset";
  }

  return null;
}

export function readStoredFontZoom(storage: Pick<Storage, "getItem">): number | null {
  try {
    const raw = storage.getItem(FONT_ZOOM_STORAGE_KEY);
    if (!raw) return null;
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return null;
    return normalizeFontZoom(parsed);
  } catch {
    return null;
  }
}

export function persistFontZoom(storage: Pick<Storage, "setItem">, value: number) {
  try {
    storage.setItem(FONT_ZOOM_STORAGE_KEY, String(value));
  } catch {
    // ignore storage failures
  }
}

/**
 * CSS fallback when Electron zoom is unavailable (web, or setZoomFactor failed).
 * Root rem is the scaling unit; DESIGN type tokens use rem so they follow along.
 */
export function applyFontZoom(
  rootStyle: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty">,
  value: number,
): number {
  const normalized = normalizeFontZoom(value);
  if (normalized === 1) {
    rootStyle.removeProperty("--onmyagent-font-size");
  } else {
    const px = FONT_ZOOM_BASE_PX * normalized;
    rootStyle.setProperty("--onmyagent-font-size", `${px}px`);
  }
  return normalized;
}

export async function applyWebviewZoom(target: FontZoomTarget, value: number): Promise<number> {
  const normalized = normalizeFontZoom(value);
  await target.setZoom(normalized);
  return normalized;
}
