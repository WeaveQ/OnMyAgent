/** Windows 11 caption cluster is 46px × 3 at 100% scale. */
export const WINDOWS_TITLEBAR_CAPTION_FALLBACK_PX = 138;

type WindowControlsOverlayLike = {
  visible?: boolean;
  getTitlebarAreaRect?: () => { x: number; width: number };
  addEventListener?: (type: "geometrychange", listener: () => void) => void;
  removeEventListener?: (type: "geometrychange", listener: () => void) => void;
};

function overlayApi(): WindowControlsOverlayLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  return (
    navigator as Navigator & {
      windowControlsOverlay?: WindowControlsOverlayLike;
    }
  ).windowControlsOverlay;
}

export function windowsTitlebarCaptionFallbackPx(
  devicePixelRatio = typeof window === "undefined" ? 1 : window.devicePixelRatio || 1,
): number {
  const scale = devicePixelRatio > 1.1 ? devicePixelRatio : 1;
  return Math.round(46 * 3 * scale);
}

export function readWindowsTitlebarCaptionInset(
  viewportWidth = typeof window === "undefined" ? 0 : window.innerWidth,
  overlay = overlayApi(),
  fallback = windowsTitlebarCaptionFallbackPx(),
): number {
  try {
    if (overlay?.visible && typeof overlay.getTitlebarAreaRect === "function") {
      const rect = overlay.getTitlebarAreaRect();
      const inset = Math.round(viewportWidth - rect.x - rect.width);
      if (inset > 0) return inset;
    }
  } catch {
    // Overlay API can throw before the first geometry is ready.
  }
  return fallback;
}

export function syncWindowsTitlebarInset() {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  if (!root.classList.contains("onmyagent-platform-windows")) return;
  root.style.setProperty(
    "--titlebar-caption-inset",
    `${readWindowsTitlebarCaptionInset()}px`,
  );
}

export function cssColorToHex(value: string): string | null {
  const raw = String(value ?? "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  if (/^#[0-9a-fA-F]{3}$/.test(raw)) {
    const [, r, g, b] = raw;
    return `#${r}${r}${g}${g}${b}${b}`;
  }
  const rgb = raw.match(/^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i);
  if (!rgb) return null;
  const hex = (n: string) => Number(n).toString(16).padStart(2, "0");
  return `#${hex(rgb[1])}${hex(rgb[2])}${hex(rgb[3])}`;
}

export function overlaySymbolColorForBackground(hex: string): string {
  const value = cssColorToHex(hex);
  if (!value) return "#171717";
  const r = Number.parseInt(value.slice(1, 3), 16);
  const g = Number.parseInt(value.slice(3, 5), 16);
  const b = Number.parseInt(value.slice(5, 7), 16);
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? "#171717" : "#f3f3f3";
}

export function readWindowsTitlebarRailColor(): string | null {
  if (typeof document === "undefined") return null;
  return cssColorToHex(
    getComputedStyle(document.documentElement).getPropertyValue("--dls-rail-bg"),
  );
}

export function installWindowsTitlebarInset() {
  if (typeof window === "undefined") return () => undefined;
  syncWindowsTitlebarInset();
  const overlay = overlayApi();
  overlay?.addEventListener?.("geometrychange", syncWindowsTitlebarInset);
  window.addEventListener("resize", syncWindowsTitlebarInset);
  return () => {
    overlay?.removeEventListener?.("geometrychange", syncWindowsTitlebarInset);
    window.removeEventListener("resize", syncWindowsTitlebarInset);
  };
}
