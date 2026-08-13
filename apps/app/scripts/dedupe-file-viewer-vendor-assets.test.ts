import assert from "node:assert/strict";
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";

import { applyFileViewerVendorAssetDedupe } from "./dedupe-file-viewer-vendor-assets.ts";

test("rewrites hashed PPT font/wasm names in both js and mjs then deletes copies", () => {
  const distRoot = join(
    tmpdir(),
    `oma-dedupe-ppt-${process.pid}-${Date.now()}`,
  );
  const assetsDir = join(distRoot, "assets");
  const vendorPpt = join(distRoot, "vendor", "ppt");
  mkdirSync(assetsDir, { recursive: true });
  mkdirSync(vendorPpt, { recursive: true });

  const hashedFont = "ppt-font-cjk-DxgKpThH.otf";
  const hashedWasm = "ppt-native-CRWppMKO.wasm";
  writeFileSync(join(vendorPpt, "ppt-font-cjk.otf"), "font");
  writeFileSync(join(assetsDir, hashedFont), "font-copy");
  writeFileSync(join(vendorPpt, "ppt-native.wasm"), "wasm");
  writeFileSync(join(assetsDir, hashedWasm), "wasm-copy");
  writeFileSync(
    join(assetsDir, "index-CYCK9WHh.js"),
    `const font=new URL("${hashedFont}",import.meta.url);const wasm=new URL("${hashedWasm}",import.meta.url);\n`,
  );
  writeFileSync(
    join(assetsDir, "worker-BbS2Q8J9.mjs"),
    `export const fontUrl="${hashedFont}";export const wasmUrl="${hashedWasm}";\n`,
  );

  try {
    applyFileViewerVendorAssetDedupe(distRoot);
    const js = readFileSync(join(assetsDir, "index-CYCK9WHh.js"), "utf8");
    const mjs = readFileSync(join(assetsDir, "worker-BbS2Q8J9.mjs"), "utf8");
    assert.match(js, /\.\.\/vendor\/ppt\/ppt-font-cjk\.otf/);
    assert.match(js, /\.\.\/vendor\/ppt\/ppt-native\.wasm/);
    assert.equal(js.includes(hashedFont), false);
    assert.match(mjs, /\.\.\/vendor\/ppt\/ppt-font-cjk\.otf/);
    assert.match(mjs, /\.\.\/vendor\/ppt\/ppt-native\.wasm/);
    assert.equal(mjs.includes(hashedWasm), false);
    assert.equal(existsSync(join(assetsDir, hashedFont)), false);
    assert.equal(existsSync(join(assetsDir, hashedWasm)), false);
    assert.equal(existsSync(join(vendorPpt, "ppt-font-cjk.otf")), true);
    assert.equal(existsSync(join(vendorPpt, "ppt-native.wasm")), true);
  } finally {
    rmSync(distRoot, { recursive: true, force: true });
  }
});
