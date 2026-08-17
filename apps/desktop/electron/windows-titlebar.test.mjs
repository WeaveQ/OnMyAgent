import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  WINDOWS_TITLEBAR_OVERLAY_HEIGHT,
  applyLinuxWindowBackground,
  applyWindowsTitleBarOverlay,
  linuxWindowAppearance,
  normalizeOverlayColor,
  resolveNativeThemeIsDark,
  themeWindowBackgroundColor,
  windowsTitleBarAppearance,
} from "./windows-titlebar.mjs";

describe("windows titlebar overlay", () => {
  test("dark overlay matches the dark rail", () => {
    const appearance = windowsTitleBarAppearance(true);
    assert.equal(appearance.titleBarStyle, "hidden");
    assert.equal(appearance.backgroundColor, "#141414");
    assert.equal(appearance.titleBarOverlay.color, "#141414");
    assert.equal(appearance.titleBarOverlay.symbolColor, "#f3f3f3");
    assert.equal(appearance.titleBarOverlay.height, WINDOWS_TITLEBAR_OVERLAY_HEIGHT);
  });

  test("light overlay matches the light rail", () => {
    const appearance = windowsTitleBarAppearance(false);
    assert.equal(appearance.backgroundColor, "#E4E2E3");
    assert.equal(appearance.titleBarOverlay.symbolColor, "#171717");
  });

  test("resolves explicit and system theme modes", () => {
    assert.equal(resolveNativeThemeIsDark("dark", { shouldUseDarkColors: false }), true);
    assert.equal(resolveNativeThemeIsDark("light", { shouldUseDarkColors: true }), false);
    assert.equal(resolveNativeThemeIsDark("system", { shouldUseDarkColors: true }), true);
    assert.equal(resolveNativeThemeIsDark("system", { shouldUseDarkColors: false }), false);
  });

  test("normalizeOverlayColor accepts hex and rgb", () => {
    assert.equal(normalizeOverlayColor("#141414"), "#141414");
    assert.equal(normalizeOverlayColor("rgb(228, 226, 227)"), "#e4e2e3");
  });

  test("applyWindowsTitleBarOverlay prefers the renderer rail color", () => {
    const calls = [];
    const win = {
      isDestroyed: () => false,
      setTitleBarOverlay: (spec) => {
        calls.push(["overlay", spec]);
      },
      setBackgroundColor: (color) => {
        calls.push(["background", color]);
      },
    };
    assert.equal(
      applyWindowsTitleBarOverlay(win, false, { color: "#E4E2E3" }),
      true,
    );
    assert.equal(calls[0][1].color, "#E4E2E3");
    assert.equal(calls[1][1], "#E4E2E3");
  });

  test("applyWindowsTitleBarOverlay updates overlay and background", () => {
    const calls = [];
    const win = {
      isDestroyed: () => false,
      setTitleBarOverlay: (spec) => {
        calls.push(["overlay", spec]);
      },
      setBackgroundColor: (color) => {
        calls.push(["background", color]);
      },
    };
    assert.equal(applyWindowsTitleBarOverlay(win, true), true);
    assert.deepEqual(calls, [
      ["overlay", windowsTitleBarAppearance(true).titleBarOverlay],
      ["background", "#141414"],
    ]);
  });

  test("applyWindowsTitleBarOverlay skips destroyed windows", () => {
    assert.equal(applyWindowsTitleBarOverlay({ isDestroyed: () => true }, true), false);
    assert.equal(applyWindowsTitleBarOverlay(null, true), false);
  });

  test("desktop-window wires the overlay on win32 and theme changes", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "desktop-window.mjs"),
      "utf8",
    );
    assert.match(source, /windowsTitleBarAppearance/);
    assert.match(source, /applyWindowsTitleBarOverlay/);
    assert.match(source, /process\.platform === "win32"/);
  });

  test("linux appearance paints the guest view, not a custom titlebar", () => {
    assert.deepEqual(linuxWindowAppearance(true), { backgroundColor: "#141414" });
    assert.deepEqual(linuxWindowAppearance(false), { backgroundColor: "#E4E2E3" });
    assert.equal(themeWindowBackgroundColor(true), "#141414");
    assert.equal(linuxWindowAppearance(true).titleBarStyle, undefined);
  });

  test("applyLinuxWindowBackground follows theme and overlay color", () => {
    const colors = [];
    const win = {
      isDestroyed: () => false,
      setBackgroundColor: (color) => {
        colors.push(color);
      },
    };
    assert.equal(applyLinuxWindowBackground(win, true), true);
    assert.equal(applyLinuxWindowBackground(win, false, { color: "#1F1F1F" }), true);
    assert.deepEqual(colors, ["#141414", "#1F1F1F"]);
    assert.equal(applyLinuxWindowBackground({ isDestroyed: () => true }, true), false);
    assert.equal(applyLinuxWindowBackground(null, true), false);
  });

  test("desktop-window paints Linux backgroundColor on create and theme change", () => {
    const source = readFileSync(
      join(dirname(fileURLToPath(import.meta.url)), "desktop-window.mjs"),
      "utf8",
    );
    assert.match(source, /linuxWindowAppearance/);
    assert.match(source, /applyLinuxWindowBackground/);
    assert.match(source, /process\.platform === "linux"/);
    assert.doesNotMatch(
      source,
      /platform === "linux"[\s\S]{0,120}titleBarStyle:\s*"hidden"/,
    );
  });
});
