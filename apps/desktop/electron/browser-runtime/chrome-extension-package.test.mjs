import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const extensionRoot = path.resolve(runtimeDir, "../../resources/browser/chrome-extension");
const desktopRoot = path.resolve(runtimeDir, "../..");

test("Chrome extension package declares only the required MV3 capabilities", async () => {
  const manifest = JSON.parse(await readFile(path.join(extensionRoot, "manifest.json"), "utf8"));

  assert.equal(manifest.manifest_version, 3);
  assert.deepEqual(manifest.permissions.sort(), [
    "debugger",
    "downloads",
    "history",
    "nativeMessaging",
    "scripting",
    "storage",
    "tabs",
  ].sort());
  assert.equal(manifest.background.service_worker, "service-worker.mjs");
  assert.equal(manifest.background.type, "module");
  assert.equal("cookies" in manifest.permissions, false);
});

test("Chrome service worker uses the backend claim lifecycle and native messaging", async () => {
  const source = await readFile(path.join(extensionRoot, "service-worker.mjs"), "utf8");

  assert.match(source, /createChromeBackend/);
  assert.match(source, /connectNative/);
  assert.match(source, /claimTab/);
  assert.match(source, /finalizeTabs/);
  assert.doesNotMatch(source, /chrome\.cookies/);
});

test("desktop packaging includes the Browser extension and native host resources", async () => {
  const builder = await readFile(path.join(desktopRoot, "electron-builder.yml"), "utf8");

  assert.match(builder, /from: resources\/browser/);
  assert.match(builder, /to: browser/);
});
