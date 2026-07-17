import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const runtimeDir = path.dirname(fileURLToPath(import.meta.url));
const hostRoot = path.resolve(runtimeDir, "../../resources/browser/native-host");

test("native host ships manifests for macOS, Linux, and Windows", async () => {
  for (const platform of ["macos", "linux", "windows"]) {
    const manifest = JSON.parse(await readFile(path.join(hostRoot, "manifests", `${platform}.json`), "utf8"));
    assert.equal(manifest.name, "com.onmyagent.browser");
    assert.equal(manifest.type, "stdio");
    assert.equal(Array.isArray(manifest.allowed_origins), true);
    assert.equal(manifest.allowed_origins.length, 1);
  }
});

test("native host bridges framed stdio to the authenticated Browser RPC endpoint", async () => {
  const source = await readFile(path.join(hostRoot, "host.mjs"), "utf8");

  assert.match(source, /ONMYAGENT_BROWSER_RPC_ENDPOINT/);
  assert.match(source, /readUInt32LE/);
  assert.match(source, /writeUInt32LE/);
  assert.doesNotMatch(source, /Cookies|Login Data|chrome\/profile/i);
});
