import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  rmSync,
  existsSync,
  readFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  inspectViteDeps,
  clearViteDepsCache,
  clearElectronDevHttpCaches,
  shouldForceViteOptimize,
  resolveOnMyAgentUserDataDir,
  ELECTRON_DEV_CACHE_DIR_NAMES,
} from "./vite-deps-integrity.mjs";

function makeDepsFixture(entries) {
  const root = mkdtempSync(join(tmpdir(), "oma-vite-deps-"));
  const depsDir = join(root, "deps");
  mkdirSync(depsDir, { recursive: true });
  for (const [name, body] of Object.entries(entries.files ?? {})) {
    writeFileSync(join(depsDir, name), body, "utf8");
  }
  if (entries.metadata) {
    writeFileSync(
      join(depsDir, "_metadata.json"),
      JSON.stringify(entries.metadata),
      "utf8",
    );
  }
  return { root, depsDir };
}

test("inspectViteDeps reports ok for a consistent optimized graph", () => {
  const { root, depsDir } = makeDepsFixture({
    metadata: {
      browserHash: "abc123",
      optimized: {
        react: { file: "react.js" },
      },
    },
    files: {
      "react.js": 'import "./chunk-AAAA.js";\nexport default {};\n',
      "chunk-AAAA.js": "export const x = 1;\n",
    },
  });
  try {
    const result = inspectViteDeps(depsDir);
    assert.equal(result.ok, true);
    assert.equal(result.browserHash, "abc123");
    assert.equal(result.optimizedCount, 1);
    assert.equal(result.brokenImports.length, 0);
    assert.equal(result.optimizedMissing.length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectViteDeps fails closed when a chunk import is missing on disk", () => {
  const { root, depsDir } = makeDepsFixture({
    metadata: {
      browserHash: "deadbeef",
      optimized: {
        react: { file: "react.js" },
      },
    },
    files: {
      // Intentionally references a chunk that does not exist — the real blank-screen failure mode.
      "react.js": 'import "./chunk-A3BIH7BF.js";\nexport default {};\n',
    },
  });
  try {
    const result = inspectViteDeps(depsDir);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "broken_chunk_import");
    assert.ok(
      result.brokenImports.some((item) => item.to === "chunk-A3BIH7BF.js"),
      `expected missing chunk-A3BIH7BF.js in brokenImports, got ${JSON.stringify(result.brokenImports)}`,
    );
    assert.equal(shouldForceViteOptimize({ inspection: result }), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("inspectViteDeps fails when optimized entry file is absent", () => {
  const { root, depsDir } = makeDepsFixture({
    metadata: {
      browserHash: "x",
      optimized: {
        react: { file: "react.js" },
      },
    },
    files: {},
  });
  try {
    const result = inspectViteDeps(depsDir);
    assert.equal(result.ok, false);
    assert.equal(result.reason, "optimized_entry_missing");
    assert.deepEqual(result.optimizedMissing, [{ id: "react", file: "react.js" }]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearViteDepsCache removes the .vite directory", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-vite-cache-"));
  const viteCache = join(root, ".vite");
  mkdirSync(join(viteCache, "deps"), { recursive: true });
  writeFileSync(join(viteCache, "deps", "x.js"), "export {}\n");
  try {
    const cleared = clearViteDepsCache(viteCache);
    assert.equal(cleared.cleared, true);
    assert.equal(existsSync(viteCache), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("clearElectronDevHttpCaches removes known Chromium cache dirs only", () => {
  const root = mkdtempSync(join(tmpdir(), "oma-electron-ud-"));
  for (const name of ELECTRON_DEV_CACHE_DIR_NAMES) {
    mkdirSync(join(root, name), { recursive: true });
    writeFileSync(join(root, name, "keep-marker"), "1");
  }
  mkdirSync(join(root, "Local Storage"), { recursive: true });
  writeFileSync(join(root, "Local Storage", "state"), "keep");
  try {
    const result = clearElectronDevHttpCaches(root);
    assert.ok(result.cleared.length >= 1);
    for (const name of ELECTRON_DEV_CACHE_DIR_NAMES) {
      assert.equal(existsSync(join(root, name)), false, name);
    }
    assert.equal(readFileSync(join(root, "Local Storage", "state"), "utf8"), "keep");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("shouldForceViteOptimize honors force env even when inspection is ok", () => {
  assert.equal(
    shouldForceViteOptimize({
      inspection: { ok: true },
      forceEnv: "1",
    }),
    true,
  );
  assert.equal(
    shouldForceViteOptimize({
      inspection: { ok: true },
      forceEnv: "",
    }),
    false,
  );
});

test("resolveOnMyAgentUserDataDir uses the dev identifier by default", () => {
  const dir = resolveOnMyAgentUserDataDir({
    appData: "/tmp/fake-app-data",
    isDevMode: true,
  });
  assert.equal(dir, join("/tmp/fake-app-data", "com.differentai.onmyagent.dev"));
});

test("electron-dev wires vite deps integrity + cache clear before launch", async () => {
  const source = await import("node:fs/promises").then((fs) =>
    fs.readFile(new URL("./electron-dev.mjs", import.meta.url), "utf8"),
  );
  assert.match(source, /vite-deps-integrity\.mjs/);
  assert.match(source, /inspectViteDeps|clearViteDepsCache|clearElectronDevHttpCaches/);
  assert.match(source, /disable-http-cache|ELECTRON_EXTRA_LAUNCH_ARGS/);
});
