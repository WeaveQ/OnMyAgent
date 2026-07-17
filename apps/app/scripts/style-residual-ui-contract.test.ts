/**
 * Residual UI dialect contract — scans real shipped sources under apps/app.
 * Gates high-drift patterns from docs/design/theme-system.md residual audits:
 * - track tabs must not use free-float size="filter"
 * - workbench interactive rows must not use hover:border-dls-border-strong jumps
 * - StatusBadge call sites must set size=
 * - SendButton / expert summon ready CTAs must not use dark-unsafe bg-dls-text + light glyph
 */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const appRoot = join(import.meta.dir, "..");
const scanRoots = [
  join(appRoot, "src/react-app"),
  join(appRoot, "src/components"),
];

function walkTsxFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === "dist") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walkTsxFiles(full, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(full);
  }
  return out;
}

function collectSources(): Array<{ path: string; rel: string; source: string }> {
  const files = scanRoots.flatMap((root) => walkTsxFiles(root));
  return files.map((path) => ({
    path,
    rel: relative(appRoot, path),
    source: readFileSync(path, "utf8"),
  }));
}

describe("residual UI style dialect contract", () => {
  const sources = collectSources();

  test("scans shipped react-app + components trees", () => {
    expect(sources.length).toBeGreaterThan(50);
    expect(sources.some((s) => s.rel.includes("components/ui/action-row.tsx"))).toBe(true);
    expect(sources.some((s) => s.rel.includes("components/ui/send-button.tsx"))).toBe(true);
  });

  test("no free-float size=\"filter\" track tabs remain", () => {
    const hits = sources.flatMap((s) => {
      if (!s.source.includes('size="filter"')) return [];
      return [`${s.rel}: contains size="filter"`];
    });
    expect(hits).toEqual([]);
  });

  test("no workbench hover:border-dls-border-strong jumps remain", () => {
    const hits = sources.flatMap((s) => {
      if (!s.source.includes("hover:border-dls-border-strong")) return [];
      return [`${s.rel}: contains hover:border-dls-border-strong`];
    });
    expect(hits).toEqual([]);
  });

  test("StatusBadge JSX call sites set an explicit size=", () => {
    const hits: string[] = [];
    for (const s of sources) {
      // Strip {...} so ternary `>` does not truncate attribute matching.
      let stripped = "";
      for (let i = 0; i < s.source.length; i++) {
        if (s.source[i] === "{") {
          let depth = 1;
          i++;
          while (i < s.source.length && depth > 0) {
            if (s.source[i] === "{") depth++;
            else if (s.source[i] === "}") depth--;
            i++;
          }
          stripped += "{EXPR}";
          i--;
        } else {
          stripped += s.source[i];
        }
      }
      const re = /<StatusBadge\b([^>]*)>/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(stripped)) !== null) {
        const attrs = m[1] ?? "";
        if (!/\bsize=/.test(attrs)) {
          const line = stripped.slice(0, m.index).split("\n").length;
          hits.push(`${s.rel}:${line}: StatusBadge without size=`);
        }
      }
    }
    expect(hits).toEqual([]);
  });

  test("SendButton ready state uses brand decision blue, not bg-dls-text", () => {
    const send = sources.find((s) => s.rel.endsWith("components/ui/send-button.tsx"));
    expect(send).toBeDefined();
    const source = send!.source;
    expect(source).toContain("bg-dls-decision");
    expect(source).toContain("ArrowUp");
    expect(source).not.toMatch(/ready[\s\S]{0,120}bg-dls-text/);
    expect(source).not.toContain('bg-dls-text text-white');
  });

  test("expert marketplace summon CTA uses brand decision, not dark-unsafe dls-text disk", () => {
    const dialog = sources.find((s) =>
      s.rel.endsWith("expert-marketplace/expert-marketplace-dialog.tsx"),
    );
    expect(dialog).toBeDefined();
    const source = dialog!.source;
    expect(source).toContain('t("session.summon")');
    expect(source).toContain("bg-dls-decision");
    expect(source).not.toContain("bg-dls-text text-dls-background");
  });

  test("FilterChip free-float primitive still ships list-selected wash", () => {
    const actionRow = sources.find((s) => s.rel.endsWith("components/ui/action-row.tsx"));
    expect(actionRow).toBeDefined();
    expect(actionRow!.source).toContain("function FilterChip(");
    expect(actionRow!.source).toContain("bg-dls-list-selected text-dls-text shadow-none");
  });
});
