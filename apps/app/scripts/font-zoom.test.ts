import { describe, expect, test } from "bun:test";

import {
  FONT_ZOOM_MAX,
  FONT_ZOOM_MIN,
  FONT_ZOOM_PRESETS,
  applyFontZoom,
  clampFontZoom,
  fontZoomFromPresetIndex,
  fontZoomPresetIndex,
  normalizeFontZoom,
  parseFontZoomShortcut,
  persistFontZoom,
  readStoredFontZoom,
} from "../src/app/lib/font-zoom";

describe("font zoom", () => {
  test("clamps and normalizes scale factors", () => {
    expect(clampFontZoom(0.1)).toBe(FONT_ZOOM_MIN);
    expect(clampFontZoom(9)).toBe(FONT_ZOOM_MAX);
    expect(normalizeFontZoom(1.049)).toBe(1.05);
  });

  test("maps slider presets to discrete stops", () => {
    expect(FONT_ZOOM_PRESETS[2]).toBe(1.0);
    expect(fontZoomFromPresetIndex(0)).toBe(FONT_ZOOM_PRESETS[0]);
    expect(fontZoomFromPresetIndex(99)).toBe(
      FONT_ZOOM_PRESETS[FONT_ZOOM_PRESETS.length - 1],
    );
    expect(fontZoomPresetIndex(1.0)).toBe(2);
    expect(fontZoomPresetIndex(0.92)).toBe(1);
    expect(fontZoomPresetIndex(1.4)).toBe(4);
  });

  test("parses zoom shortcuts", () => {
    expect(
      parseFontZoomShortcut({
        key: "=",
        code: "Equal",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBe("in");
    expect(
      parseFontZoomShortcut({
        key: "-",
        code: "Minus",
        metaKey: false,
        ctrlKey: true,
        altKey: false,
      }),
    ).toBe("out");
    expect(
      parseFontZoomShortcut({
        key: "0",
        code: "Digit0",
        metaKey: true,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBe("reset");
    expect(
      parseFontZoomShortcut({
        key: "=",
        code: "Equal",
        metaKey: false,
        ctrlKey: false,
        altKey: false,
      }),
    ).toBeNull();
  });

  test("persists and restores from storage", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
    };
    persistFontZoom(storage, 1.15);
    expect(readStoredFontZoom(storage)).toBe(1.15);
    expect(readStoredFontZoom({ getItem: () => "nope" })).toBeNull();
  });

  test("applies CSS custom property and clears at 1x", () => {
    const props = new Map<string, string>();
    const rootStyle = {
      setProperty: (name: string, value: string) => {
        props.set(name, value);
      },
      removeProperty: (name: string) => {
        props.delete(name);
      },
    };
    applyFontZoom(rootStyle, 1.15);
    expect(props.get("--onmyagent-font-size")).toBe("18.4px");
    applyFontZoom(rootStyle, 1);
    expect(props.has("--onmyagent-font-size")).toBe(false);
  });
});
