/**
 * Shared font-zoom controller: one source of truth for shortcuts, settings UI,
 * and boot-time restore. Desktop prefers Electron zoomFactor; CSS rem fallback
 * covers web and failed native zoom.
 */
import {
  FONT_ZOOM_STEP,
  applyFontZoom,
  normalizeFontZoom,
  persistFontZoom,
  readStoredFontZoom,
} from "../../app/lib/font-zoom";
import { setDesktopZoomFactor } from "../../app/lib/desktop";
import { isDesktopRuntime } from "../../app/utils";

type Listener = (value: number) => void;

let currentZoom = 1;
let initialized = false;
const listeners = new Set<Listener>();

function notify(value: number) {
  for (const listener of listeners) {
    try {
      listener(value);
    } catch {
      // ignore subscriber errors
    }
  }
}

function applyCssFallback(value: number) {
  if (typeof document === "undefined") return;
  applyFontZoom(document.documentElement.style, value);
}

function applyNativeOrCss(value: number) {
  if (typeof window === "undefined") {
    applyCssFallback(value);
    return;
  }

  // Always keep the factor readable for WebContentsView coordinate math.
  window.__ONMYAGENT_ZOOM_FACTOR__ = value;

  if (!isDesktopRuntime()) {
    applyCssFallback(value);
    return;
  }

  void setDesktopZoomFactor(value)
    .then((applied) => {
      if (applied) {
        document.documentElement.style.removeProperty("--onmyagent-font-size");
        return;
      }
      applyCssFallback(value);
    })
    .catch(() => {
      applyCssFallback(value);
    });
}

export function getFontZoom(): number {
  if (!initialized && typeof window !== "undefined") {
    ensureFontZoomInitialized();
  }
  return currentZoom;
}

export function subscribeFontZoom(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setFontZoom(
  value: number,
  options?: { persist?: boolean },
): number {
  const next = normalizeFontZoom(value);
  currentZoom = next;
  if (options?.persist !== false && typeof window !== "undefined") {
    persistFontZoom(window.localStorage, next);
  }
  applyNativeOrCss(next);
  notify(next);
  return next;
}

export function stepFontZoom(delta: number): number {
  return setFontZoom(currentZoom + delta);
}

export function resetFontZoom(): number {
  return setFontZoom(1);
}

/** Restore from storage once (boot). Safe to call multiple times. */
export function ensureFontZoomInitialized(): number {
  if (initialized) return currentZoom;
  initialized = true;
  if (typeof window === "undefined") {
    currentZoom = 1;
    return currentZoom;
  }
  const stored = readStoredFontZoom(window.localStorage) ?? 1;
  return setFontZoom(stored, { persist: false });
}

export function bumpFontZoomIn(): number {
  return stepFontZoom(FONT_ZOOM_STEP);
}

export function bumpFontZoomOut(): number {
  return stepFontZoom(-FONT_ZOOM_STEP);
}
