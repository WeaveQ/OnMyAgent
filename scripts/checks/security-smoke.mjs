import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const appRequire = createRequire(new URL("../../apps/app/package.json", import.meta.url));
const { Marked } = await import(appRequire.resolve("marked"));

const desktopMain = await readFile(new URL("../../apps/desktop/electron/main.mjs", import.meta.url), "utf8");
const desktopBrowserController = await readFile(
  new URL("../../apps/desktop/electron/browser-runtime/electron-browser-controller.mjs", import.meta.url),
  "utf8",
);
const desktopApplicationMenu = await readFile(
  new URL("../../apps/desktop/electron/application-menu.mjs", import.meta.url),
  "utf8",
);
const markdownSource = await readFile(new URL("../../apps/app/src/react-app/capabilities/artifacts/markdown.tsx", import.meta.url), "utf8");

assert.match(desktopBrowserController, /function openAllowedExternalUrl\(url\)/);
assert.match(desktopBrowserController, /if \(!\["http:", "https:", "mailto:"\]\.includes\(parsed\.protocol\)\) return Promise\.resolve\(false\);/);
assert.doesNotMatch(desktopMain, /ipcMain\.handle\("onmyagent:shell:openExternal", async \(_event, url\) => \{\s*if \(typeof url === "string" && url\.trim\(\)\.length > 0\) \{\s*await shell\.openExternal\(url\);/s);
assert.match(desktopMain, /const MAIN_WINDOW_MIN_WIDTH = 1120;/);
assert.match(desktopMain, /const MAIN_WINDOW_MIN_HEIGHT = 720;/);
assert.match(desktopApplicationMenu, /\{ role: "windowMenu" \}/);
assert.match(desktopApplicationMenu, /const fileSubmenu = isMac/);
assert.match(desktopApplicationMenu, /label: "Settings\.\.\.",/);
assert.doesNotMatch(desktopMain, /mainWindow\.on\("resize"/);

// markdown.tsx must strip all raw HTML tokens: the `html` renderer returns an
// empty string unconditionally, and the module must not opt back into raw HTML
// (e.g. by re-enabling marked's default html renderer or importing sanitizers
// that would allow arbitrary HTML through).
assert.match(markdownSource, /renderer:\s*\{[\s\S]{0,120}?html\(\)\s*\{\s*return\s*""\s*;\s*\}/);
assert.doesNotMatch(markdownSource, /dangerouslySetInnerHTML\s*=\s*\{\s*\{\s*__html:\s*rawMarkdown/);

const parser = new Marked({
  async: false,
  gfm: true,
  silent: true,
  renderer: {
    html() {
      return "";
    },
  },
});

const stripped = parser.parse('<div><img src=x onerror=alert(1)></div>', { async: false });
assert.doesNotMatch(stripped, /<img|<div|onerror/);

const scriptStripped = parser.parse('before<script>alert(1)</script>after', { async: false });
assert.doesNotMatch(scriptStripped, /<script/);

console.log("security smoke passed");
