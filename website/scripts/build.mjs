import { cp, mkdir, readdir, rm } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");
const distDir = resolve(root, "dist");

console.log("[website] build root:", root);

await rm(distDir, { recursive: true, force: true });
await mkdir(distDir, { recursive: true });

const vp = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["exec", "vitepress", "build", "docs"],
  { cwd: root, stdio: "inherit", env: process.env },
);
if ((vp.status ?? 1) !== 0) {
  console.error("[website] vitepress build failed with status", vp.status);
  process.exit(vp.status ?? 1);
}

const entries = await readdir(publicDir, { withFileTypes: true });
for (const ent of entries) {
  if (ent.name === "docs") {
    console.warn("[website] skip public/docs to protect VitePress output");
    continue;
  }
  await cp(resolve(publicDir, ent.name), resolve(distDir, ent.name), {
    recursive: true,
  });
}

console.log(`[website] built ${distDir} (landing + docs)`);
