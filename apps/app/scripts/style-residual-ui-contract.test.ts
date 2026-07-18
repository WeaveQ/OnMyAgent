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

  test("no arbitrary text-[Npx] font sizes in shipped UI trees", () => {
    // DESIGN / frontend-primitive-refactor hard rule: no new text-[Npx].
    const hits = sources.flatMap((s) => {
      const re = /text-\[[0-9]+px\]/g;
      const lines: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = re.exec(s.source)) !== null) {
        const line = s.source.slice(0, m.index).split("\n").length;
        lines.push(`${s.rel}:${line}: ${m[0]}`);
      }
      return lines;
    });
    expect(hits).toEqual([]);
  });

  test("assistant list rows keep strict h-8 min/max rhythm", () => {
    const sections = sources.find((s) =>
      s.rel.endsWith("sidebar/assistant-conversation-sections.tsx"),
    );
    const taskItem = sources.find((s) =>
      s.rel.endsWith("sidebar/assistant-task-item.tsx"),
    );
    expect(sections).toBeDefined();
    expect(taskItem).toBeDefined();
    expect(sections!.source).toMatch(/h-8 min-h-8 max-h-8/);
    expect(taskItem!.source).toMatch(/h-8 min-h-8 max-h-8/);
  });

  test("SendButton is the only workbench rounded-full decision CTA primitive", () => {
    const send = sources.find((s) => s.rel.endsWith("components/ui/send-button.tsx"));
    expect(send).toBeDefined();
    expect(send!.source).toContain("rounded-full");
    // Default Button primitive must not ship a full pill CTA size except pill-xs chips.
    const button = sources.find((s) => s.rel.endsWith("components/ui/button.tsx"));
    expect(button).toBeDefined();
    expect(button!.source).toContain('"pill-xs"');
    // size=default / sm / lg stay rectangular (no rounded-full on those size keys).
    expect(button!.source).not.toMatch(
      /default:\s*"[^"]*rounded-full/,
    );
    expect(button!.source).not.toMatch(
      /sm:\s*"[^"]*rounded-full/,
    );
    expect(button!.source).not.toMatch(
      /lg:\s*"[^"]*rounded-full/,
    );
  });

  /**
   * DESIGN §11: ordinary full-width *Button* CTAs must not use rounded-full.
   * True whitelist exceptions only (pre-app architecture gate). Ignores
   * progress tracks, avatars (object-cover), SegmentedTabGroup density strings,
   * and decorative blur orbs (h-% w-% rounded-full without Button className).
   */
  test("w-full rounded-full Button CTAs are confined to DESIGN exceptions", () => {
    const allowRelSubstrings = [
      // DESIGN §11 intentional exception (pre-app mismatch gate).
      "shell/architecture-mismatch-gate.tsx",
    ];
    const nonCtaLine =
      /\b(object-cover|overflow-x-hidden|flex-wrap|ProgressTrack|progress-track|gap-0\.5 rounded-full border|h-full w-full rounded-full|blur-3xl|soft-blue-glow|soft-orange-glow|soft-signal-glow)\b/;
    const hits = sources.flatMap((s) => {
      const lineHits: string[] = [];
      s.source.split("\n").forEach((line, idx) => {
        if (!/\bw-full\b/.test(line) || !/\brounded-full\b/.test(line)) return;
        if (nonCtaLine.test(line)) return;
        // Prefer Button-adjacent className strings (jsx className=… with both tokens).
        if (!/className=/.test(line) && !/^\s*["'`]/.test(line.trim())) return;
        lineHits.push(`${s.rel}:${idx + 1}`);
      });
      if (lineHits.length === 0) return [];
      const allowed = allowRelSubstrings.some((part) => s.rel.includes(part));
      if (allowed) return [];
      return lineHits.map((h) => `${h}: w-full rounded-full CTA outside allowlist`);
    });
    expect(hits).toEqual([]);
  });

  test("Round-1 debt CTAs no longer use rounded-full on Buttons", () => {
    const debtRels = [
      "domains/cloud/den-signin-surface.tsx",
      "domains/workspace/create-workspace-modal.tsx",
      "domains/workspace/remote-workspace-fields.tsx",
      "domains/session/surface/composer/notice.tsx",
    ];
    const hits: string[] = [];
    for (const part of debtRels) {
      const file = sources.find((s) => s.rel.includes(part));
      expect(file, `missing ${part}`).toBeDefined();
      const lines = file!.source.split("\n");
      lines.forEach((line, idx) => {
        if (!line.includes("rounded-full")) return;
        // Decorative glows / non-button chrome may remain.
        if (/\b(blur-3xl|soft-blue-glow|soft-orange-glow|soft-signal-glow)\b/.test(line)) {
          return;
        }
        // Any remaining rounded-full on a className line in these files is debt.
        if (/className=/.test(line) || /className=\{/.test(line)) {
          hits.push(`${file!.rel}:${idx + 1}: ${line.trim()}`);
        }
      });
    }
    expect(hits).toEqual([]);
  });

  test("den-signin primary actions stay full-width rectangular Buttons", () => {
    const den = sources.find((s) =>
      s.rel.endsWith("domains/cloud/den-signin-surface.tsx"),
    );
    expect(den).toBeDefined();
    expect(den!.source).toContain('className="w-full"');
    expect(den!.source).not.toContain('className="w-full rounded-full"');
    expect(den!.source).toContain("Sign in with");
  });

  test("LoadingSpinner primitive remains the shared spin ring", () => {
    const spinner = sources.find((s) =>
      s.rel.endsWith("components/ui/loading-spinner.tsx"),
    );
    expect(spinner).toBeDefined();
    expect(spinner!.source).toContain("animate-spin");
    expect(spinner!.source).toContain("function LoadingSpinner");
  });

  test("PageLoadingSpinner uses LoadingSpinner, not bare Loader2 animate-spin", () => {
    const page = sources.find((s) => s.rel.endsWith("components/page.tsx"));
    expect(page).toBeDefined();
    expect(page!.source).toContain('from "@/components/ui/loading-spinner"');
    expect(page!.source).toContain("function PageLoadingSpinner");
    expect(page!.source).toContain("<LoadingSpinner");
    expect(page!.source).not.toContain("Loader2");
    expect(page!.source).not.toMatch(/PageLoadingSpinner[\s\S]{0,200}animate-spin/);
  });

  test("converted session presence dots import StatusDot and drop hand-roll size-N rounded-full", () => {
    const convertedRels = [
      "sidebar/agent-conversation-item.tsx",
      "sidebar/agent-conversation-list.tsx",
      "sidebar/app-sidebar.tsx",
      "chat/session-page-agent-conversation-panel.tsx",
      "components/status-bar/index.tsx",
      "components/side-panel-pages.tsx",
      "chat/session-page-billing-page.tsx",
      "voice/voice-panel.tsx",
      "surface/session-surface-components.tsx",
      "surface/plan-goal/panels.tsx",
    ];
    // Match size-N … rounded-full even with intermediate classes (e.g. size-1.5 shrink-0 rounded-full).
    const hasSizeToken = /\bsize-(1\.5|2|2\.5)\b/;
    const hasRoundedFull = /\brounded-full\b/;
    const hits: string[] = [];
    for (const part of convertedRels) {
      const file = sources.find((s) => s.rel.includes(part));
      expect(file, `missing ${part}`).toBeDefined();
      expect(file!.source).toMatch(/StatusDot|StatusPing/);
      file!.source.split("\n").forEach((line, idx) => {
        if (!hasSizeToken.test(line) || !hasRoundedFull.test(line)) return;
        if (line.includes("StatusDot") || line.includes("statusDotVariants")) return;
        // Allow progress-bar tracks and avatar chrome, not presence dots.
        if (
          /\bh-1\b|\bw-\[|object-cover|overflow-hidden|h-6 w-6 shrink-0 items-center justify-center rounded-full bg-dls-status/.test(
            line,
          )
        ) {
          return;
        }
        hits.push(`${file!.rel}:${idx + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  test("app-sidebar SessionStatusIndicator uses StatusDot for active presence", () => {
    const sidebar = sources.find((s) =>
      s.rel.endsWith("sidebar/app-sidebar.tsx"),
    );
    expect(sidebar).toBeDefined();
    expect(sidebar!.source).toContain('from "@/components/ui/status-dot"');
    expect(sidebar!.source).toContain("function SessionStatusIndicator");
    expect(sidebar!.source).toContain("<StatusDot");
    expect(sidebar!.source).not.toMatch(
      /size-1\.5\s+shrink-0\s+rounded-full/,
    );
  });

  test("voice-panel has exactly one StatusDot import (no TS2300 duplicate)", () => {
    const voice = sources.find((s) => s.rel.endsWith("voice/voice-panel.tsx"));
    expect(voice).toBeDefined();
    const matches = [
      ...voice!.source.matchAll(
        /import\s*\{[^}]*\bStatusDot\b[^}]*\}\s*from\s*["']@\/components\/ui\/status-dot["']/g,
      ),
    ];
    expect(matches.map((m) => m[0])).toHaveLength(1);
    expect(voice!.source).toContain("<StatusDot");
  });

  test("floating task menu uses opaque surface-solid (not glass surface alone)", () => {
    const taskItem = sources.find((s) =>
      s.rel.endsWith("sidebar/assistant-task-item.tsx"),
    );
    expect(taskItem).toBeDefined();
    expect(taskItem!.source).toContain("bg-dls-surface-solid");
    expect(taskItem!.source).toContain("TASK_CONTEXT_MENU_CLASS");
  });
});
