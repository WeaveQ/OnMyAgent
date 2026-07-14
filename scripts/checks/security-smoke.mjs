import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";

const appRequire = createRequire(new URL("../../apps/app/package.json", import.meta.url));
const { Marked } = await import(appRequire.resolve("marked"));
const { default: markedShiki } = await import(appRequire.resolve("marked-shiki"));
const { codeToHtml } = await import(appRequire.resolve("shiki"));

const desktopMain = await readFile(new URL("../../apps/desktop/electron/main.mjs", import.meta.url), "utf8");
const desktopEmbeddedBrowserPanel = await readFile(
  new URL("../../apps/desktop/electron/embedded-browser-panel.mjs", import.meta.url),
  "utf8",
);
const desktopApplicationMenu = await readFile(
  new URL("../../apps/desktop/electron/application-menu.mjs", import.meta.url),
  "utf8",
);
const markdownSource = await readFile(new URL("../../apps/app/src/react-app/domains/session/surface/markdown.tsx", import.meta.url), "utf8");

assert.match(desktopEmbeddedBrowserPanel, /function isExternalOpenUrlAllowed\(url\)/);
assert.match(desktopEmbeddedBrowserPanel, /return \["http:", "https:", "mailto:"\]\.includes\(parsed\.protocol\);/);
assert.doesNotMatch(desktopMain, /ipcMain\.handle\("onmyagent:shell:openExternal", async \(_event, url\) => \{\s*if \(typeof url === "string" && url\.trim\(\)\.length > 0\) \{\s*await shell\.openExternal\(url\);/s);
assert.match(desktopMain, /const MAIN_WINDOW_MIN_WIDTH = 1120;/);
assert.match(desktopMain, /const MAIN_WINDOW_MIN_HEIGHT = 720;/);
assert.match(desktopApplicationMenu, /\{ role: "windowMenu" \}/);
assert.match(desktopApplicationMenu, /const fileSubmenu = isMac/);
assert.match(desktopApplicationMenu, /label: "Settings\.\.\.",/);
assert.doesNotMatch(desktopMain, /mainWindow\.on\("resize"/);

assert.match(markdownSource, /function isSafeShikiHtml\(text: string\)/);
assert.match(markdownSource, /return isSafeShikiHtml\(text\) \? text : "";/);

const parser = new Marked({
  async: false,
  gfm: true,
  silent: true,
  renderer: {
    html({ text }) {
      if (!text.includes('data-onmyagent-shiki="true"')) return "";
      if (/<\s*(script|style|iframe|object|embed|link|meta|img|svg|math)\b/i.test(text)) return "";
      return text;
    },
  },
}).use(
  markedShiki({
    async highlight(code, lang) {
      return codeToHtml(code, {
        lang: lang || "text",
        theme: "github-light",
      });
    },
    container: '<div data-onmyagent-shiki="true">%s</div>',
  }),
);

const highlighted = await parser.parse("```js\nconsole.log(1)\n```", { async: true });
assert.match(highlighted, /data-onmyagent-shiki="true"/);
assert.match(highlighted, /console/);

const injected = await parser.parse('<div data-onmyagent-shiki="true"><img src=x onerror=alert(1)></div>', { async: true });
assert.equal(injected.trim(), "");

console.log("security smoke passed");
