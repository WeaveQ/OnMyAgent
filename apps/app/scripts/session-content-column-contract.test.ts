/**
 * Content column width must come from capabilities/layout/content-column only.
 * Prevents transcript/composer/local-agent width drift.
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const appSrc = join(import.meta.dir, "../src");
const contentColumnPath = join(
  appSrc,
  "react-app/capabilities/layout/content-column.ts",
);

const ALLOWED_RELATIVE = new Set([
  "react-app/capabilities/layout/content-column.ts",
  // Contract self-reference in this file is under scripts/, not scanned.
]);

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name) && !name.endsWith(".d.ts")) out.push(full);
  }
  return out;
}

describe("session content column contract", () => {
  test("content-column module exports the canonical width", () => {
    const src = readFileSync(contentColumnPath, "utf8");
    expect(src).toContain("SESSION_CONTENT_MAX_WIDTH_PX = 1120");
    expect(src).toContain('SESSION_CONTENT_MAX_WIDTH_CLASS = "max-w-[1120px]"');
  });

  test("no product UI scatters max-w-[1120px] outside content-column", () => {
    const offenders: string[] = [];
    for (const file of walkTsFiles(appSrc)) {
      const rel = relative(appSrc, file).replaceAll("\\", "/");
      if (ALLOWED_RELATIVE.has(rel)) continue;
      const text = readFileSync(file, "utf8");
      // Literal class in source (not via SESSION_CONTENT_MAX_WIDTH_CLASS).
      if (text.includes("max-w-[1120px]")) {
        // Allow re-export / comment references only if the token identifier is used
        // and the only literal is inside a string assigned via the constant import path.
        // Hard fail: bare Tailwind class still present as a string fragment in className-like usage.
        const withoutImports = text
          .split("\n")
          .filter((line) => !line.trim().startsWith("import ") && !line.trim().startsWith("*") && !line.trim().startsWith("//"))
          .join("\n");
        if (withoutImports.includes("max-w-[1120px]")) {
          // content-column itself allowed
          if (rel.endsWith("capabilities/layout/content-column.ts")) continue;
          // surface-styles re-exports only — no literal
          if (rel.endsWith("surface/surface-styles.ts") && !withoutImports.includes('"max-w-[1120px]"') && !withoutImports.includes("'max-w-[1120px]'")) {
            continue;
          }
          offenders.push(rel);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
