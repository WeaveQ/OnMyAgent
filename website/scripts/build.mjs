import { cp, mkdir, readdir, rm, writeFile } from "node:fs/promises";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = resolve(root, "public");
const distDir = resolve(root, "dist");

console.log("[website] build root:", root);
console.log(
  "[website] DOCS_BASE:",
  process.env.DOCS_BASE || "/docs/ (default)",
);

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

// GitHub Pages: skip Jekyll so _* assets are published
await writeFile(resolve(distDir, ".nojekyll"), "");

// Pages only runs this build command. Keep the handbook quality gate in the
// build path so a broken locale route, local image, or generated link
// cannot be uploaded merely because VitePress itself rendered successfully.
const check = spawnSync(
  process.platform === "win32" ? "pnpm.cmd" : "pnpm",
  ["run", "check:dist"],
  { cwd: root, stdio: "inherit", env: process.env },
);
if ((check.status ?? 1) !== 0) {
  console.error("[website] handbook check failed with status", check.status);
  process.exit(check.status ?? 1);
}

console.log(`[website] built ${distDir} (landing + docs)`);
