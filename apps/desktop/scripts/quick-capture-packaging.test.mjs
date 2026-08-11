/**
 * Contract: packaged builds must ship quick-capture static HTML.
 * Regression: missing resources left the ⌘B panel unable to load (blank / no popup).
 */
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("electron-builder packs quick-capture HTML into asar and extraResources", async () => {
  const builder = await readFile(path.join(root, "electron-builder.yml"), "utf8");
  assert.match(
    builder,
    /from:\s*resources\/quick-capture[\s\S]*to:\s*resources\/quick-capture/,
    "files must include resources/quick-capture for asar path next to electron/",
  );
  assert.match(
    builder,
    /from:\s*resources\/quick-capture[\s\S]*to:\s*quick-capture/,
    "extraResources must include quick-capture fallback under process.resourcesPath",
  );
});

test("quick-capture source assets exist in the desktop package tree", async () => {
  const html = path.join(root, "resources/quick-capture/index.html");
  const preload = path.join(root, "electron/quick-capture-preload.cjs");
  const body = await readFile(html, "utf8");
  assert.match(body, /quick-capture|textarea|input/i);
  assert.match(body, /data-theme/, "panel must support light/dark theme tokens");
  assert.match(body, /model-menu|modelTrigger|listbox/i, "model picker must expose a dropdown");
  await readFile(preload, "utf8");
});
