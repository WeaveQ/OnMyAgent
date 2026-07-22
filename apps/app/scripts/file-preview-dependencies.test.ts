import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const appRoot = resolve(import.meta.dir, "..");

test("pins the offline file viewer packages to the verified compatible release", () => {
  const packageJson = JSON.parse(readFileSync(resolve(appRoot, "package.json"), "utf8")) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  expect(packageJson.dependencies?.["@file-viewer/react"]).toBe("2.2.2");
  expect(packageJson.dependencies?.["@file-viewer/renderer-word"]).toBe("2.2.2");
  expect(packageJson.dependencies?.["@file-viewer/renderer-spreadsheet"]).toBe("2.2.2");
  expect(packageJson.dependencies?.["@file-viewer/renderer-presentation"]).toBe("2.2.2");
  expect(packageJson.dependencies?.["@file-viewer/preset-office"]).toBeUndefined();
  expect(packageJson.dependencies?.["@file-viewer/react-full"]).toBeUndefined();
  expect(packageJson.dependencies?.["@file-viewer/preset-all"]).toBeUndefined();
  expect(packageJson.devDependencies?.["@file-viewer/vite-plugin"]).toBe("2.2.2");
});

test("publishes file viewer workers and wasm as local Vite assets", () => {
  const viteConfig = readFileSync(resolve(appRoot, "vite.config.ts"), "utf8");

  expect(viteConfig).toContain('from "@file-viewer/vite-plugin"');
  expect(viteConfig).toContain('resolve(repoRoot, ".loop/runtime/file-viewer-assets")');
  expect(viteConfig).toContain("fileViewerRenderers({");
  expect(viteConfig).toContain("inject: false");
  expect(viteConfig).not.toContain('formats: ["pdf"');
  expect(viteConfig).toContain("publicDir: fileViewerDevAssetsRoot");
  expect(viteConfig).toContain('mode: "both"');
});
