/** @jsxImportSource react */
import { useCallback, useEffect, useSyncExternalStore } from "react";

import {
  FONT_ZOOM_MAX,
  FONT_ZOOM_MIN,
  FONT_ZOOM_PRESETS,
  FONT_ZOOM_STEP,
  fontZoomFromPresetIndex,
  fontZoomPresetIndex,
  parseFontZoomShortcut,
} from "../../app/lib/font-zoom";
import {
  bumpFontZoomIn,
  bumpFontZoomOut,
  ensureFontZoomInitialized,
  getFontZoom,
  resetFontZoom,
  setFontZoom,
  subscribeFontZoom,
} from "./font-zoom-controller";

/**
 * Boot + keyboard shortcuts. Call once near app root (desktop and web).
 */
export function useFontZoomBehavior() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    ensureFontZoomInitialized();

    const handleZoomShortcut = (event: KeyboardEvent) => {
      const action = parseFontZoomShortcut(event);
      if (!action) return;

      if (action === "in") {
        bumpFontZoomIn();
      } else if (action === "out") {
        bumpFontZoomOut();
      } else {
        resetFontZoom();
      }

      event.preventDefault();
      event.stopPropagation();
    };

    window.addEventListener("keydown", handleZoomShortcut, true);
    return () => {
      window.removeEventListener("keydown", handleZoomShortcut, true);
    };
  }, []);
}

/** @deprecated Use useFontZoomBehavior — works on desktop and web. */
export const useDesktopFontZoomBehavior = useFontZoomBehavior;

/**
 * Reactive font zoom for settings UI and any surface that needs the current factor.
 */
export function useFontZoom() {
  const value = useSyncExternalStore(
    subscribeFontZoom,
    getFontZoom,
    () => 1,
  );

  const setValue = useCallback((next: number) => setFontZoom(next), []);
  const setPresetIndex = useCallback((index: number) => {
    setFontZoom(fontZoomFromPresetIndex(index));
  }, []);
  const reset = useCallback(() => resetFontZoom(), []);

  return {
    value,
    min: FONT_ZOOM_MIN,
    max: FONT_ZOOM_MAX,
    step: FONT_ZOOM_STEP,
    presets: FONT_ZOOM_PRESETS,
    presetIndex: fontZoomPresetIndex(value),
    presetCount: FONT_ZOOM_PRESETS.length,
    setValue,
    setPresetIndex,
    reset,
    zoomIn: bumpFontZoomIn,
    zoomOut: bumpFontZoomOut,
  };
}
