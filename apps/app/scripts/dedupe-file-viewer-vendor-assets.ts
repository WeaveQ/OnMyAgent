import {
  existsSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const HASHED_PPT_ASSET = /^(ppt-font-cjk|ppt-native)-[A-Za-z0-9_-]+\.(otf|wasm)$/;

/**
 * Rewrite hashed PPT font/wasm names in assets/*.{js,mjs} to vendor/ppt
 * originals, then delete the hashed copies. Used by the Vite closeBundle plugin.
 */
export function applyFileViewerVendorAssetDedupe(distRoot: string): void {
  const vendorPpt = join(distRoot, "vendor", "ppt");
  const assetsDir = join(distRoot, "assets");
  if (!existsSync(vendorPpt) || !existsSync(assetsDir)) return;

  const replacements: Array<{ hashed: string; vendorRel: string }> = [];
  for (const name of readdirSync(assetsDir)) {
    const hashedMatch = HASHED_PPT_ASSET.exec(name);
    if (!hashedMatch) continue;
    const original =
      hashedMatch[1] === "ppt-font-cjk" ? "ppt-font-cjk.otf" : "ppt-native.wasm";
    if (!existsSync(join(vendorPpt, original))) continue;
    replacements.push({
      hashed: name,
      vendorRel: `../vendor/ppt/${original}`,
    });
  }
  if (replacements.length === 0) return;

  for (const name of readdirSync(assetsDir)) {
    if (!name.endsWith(".js") && !name.endsWith(".mjs")) continue;
    const filePath = join(assetsDir, name);
    const source = readFileSync(filePath, "utf8");
    let next = source;
    for (const item of replacements) {
      next = next.split(item.hashed).join(item.vendorRel);
    }
    if (next !== source) writeFileSync(filePath, next);
  }

  for (const item of replacements) {
    rmSync(join(assetsDir, item.hashed), { force: true });
  }
}
