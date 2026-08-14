import { describe, expect, test } from "bun:test";

import {
  WINDOWS_TITLEBAR_CAPTION_FALLBACK_PX,
  cssColorToHex,
  overlaySymbolColorForBackground,
  readWindowsTitlebarCaptionInset,
  windowsTitlebarCaptionFallbackPx,
} from "./windows-titlebar-inset";

describe("titlebar rail color", () => {
  test("normalizes hex and rgb tokens", () => {
    expect(cssColorToHex(" #141414 ")).toBe("#141414");
    expect(cssColorToHex("rgb(228, 226, 227)")).toBe("#e4e2e3");
  });

  test("picks contrast symbols for rail backgrounds", () => {
    expect(overlaySymbolColorForBackground("#141414")).toBe("#f3f3f3");
    expect(overlaySymbolColorForBackground("#E4E2E3")).toBe("#171717");
  });
});

describe("readWindowsTitlebarCaptionInset", () => {
  test("scales the caption fallback with DPI", () => {
    expect(windowsTitlebarCaptionFallbackPx(1)).toBe(
      WINDOWS_TITLEBAR_CAPTION_FALLBACK_PX,
    );
    expect(windowsTitlebarCaptionFallbackPx(1.25)).toBe(173);
  });

  test("falls back when overlay geometry is missing", () => {
    expect(readWindowsTitlebarCaptionInset(1280, undefined, 138)).toBe(138);
    expect(
      readWindowsTitlebarCaptionInset(1280, { visible: false }, 138),
    ).toBe(138);
  });

  test("uses the window-controls overlay leftover width", () => {
    expect(
      readWindowsTitlebarCaptionInset(1280, {
        visible: true,
        getTitlebarAreaRect: () => ({ x: 0, width: 1102 }),
      }),
    ).toBe(178);
  });

  test("ignores zero/negative overlay leftovers", () => {
    expect(
      readWindowsTitlebarCaptionInset(1280, {
        visible: true,
        getTitlebarAreaRect: () => ({ x: 0, width: 1280 }),
      }),
    ).toBe(WINDOWS_TITLEBAR_CAPTION_FALLBACK_PX);
  });
});
