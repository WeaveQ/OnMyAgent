import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

/**
 * Primary app rail: idle icons/labels use primary ink (text-dls-text), not
 * slate secondary. Active vs idle is the free-float pill surface.
 */
describe("rail idle primary ink contract", () => {
  test("RailButton idle state defaults to text-dls-text, not secondary", () => {
    const actionRow = readFileSync(
      resolve(root, "apps/app/src/components/ui/action-row.tsx"),
      "utf8",
    );

    const start = actionRow.indexOf("const railButtonVariants = cva(");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = actionRow.indexOf("const treeRowButtonVariants", start);
    expect(end).toBeGreaterThan(start);
    const railBlock = actionRow.slice(start, end);

    // Idle (active: false) must use primary ink.
    expect(railBlock).toContain(
      'false:\n          "text-dls-text hover:bg-black/5 dark:hover:bg-white/5"',
    );
    // Idle must not reintroduce secondary as the default ink.
    expect(railBlock).not.toContain("text-dls-secondary hover:bg-black/5");
    // Active still lifts with surface / rail-active.
    expect(railBlock).toContain("bg-dls-surface text-dls-text");
    expect(railBlock).toContain("dark:bg-dls-rail-active");
  });

  test("compact account gear on rail uses primary ink idle", () => {
    const sidebar = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx",
      ),
      "utf8",
    );
    // Compact settings trigger (primary rail foot) — primary ink, not secondary.
    expect(sidebar).toContain('className="text-dls-text hover:text-dls-accent"');
  });

  test("home and automation primary CTAs share outline lg + strong border surface", () => {
    const header = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );
    const automation = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/messaging/automation-nav-sidebar.tsx",
      ),
      "utf8",
    );

    expect(header).toContain("SIDEBAR_PRIMARY_CTA_CLASS");
    expect(header).toContain("border-dls-border-strong");
    expect(header).toContain('size="lg"');
    expect(header).toContain("session.new_task");
    expect(header).toContain("onCreateTask");

    expect(automation).toContain("SIDEBAR_PRIMARY_CTA_CLASS");
    expect(automation).toContain("border-dls-border-strong");
    expect(automation).toContain('size="lg"');
    expect(automation).toContain("automation.add");
  });

  test("NavTab free-float idle uses primary ink; active inverted label stays on contrast surface", () => {
    const actionRow = readFileSync(
      resolve(root, "apps/app/src/components/ui/action-row.tsx"),
      "utf8",
    );
    const start = actionRow.indexOf("const navTabButtonVariants = cva(");
    expect(start).toBeGreaterThanOrEqual(0);
    const end = actionRow.indexOf("const segmentedTabButtonVariants", start);
    expect(end).toBeGreaterThan(start);
    const navTab = actionRow.slice(start, end);

    // Active: inverted pill (dark surface in light) + background/white label.
    expect(navTab).toContain("bg-dls-text text-dls-background");
    // Idle: primary ink, not secondary slate.
    expect(navTab).toContain(
      'false:\n          "bg-transparent text-dls-text hover:bg-dls-hover/70 [&_svg]:opacity-100 [&_svg]:text-current"',
    );
    expect(navTab).not.toContain(
      "bg-transparent text-dls-secondary hover:bg-dls-hover/70",
    );
  });

  test("sidebar idle chrome avoids stacked opacity on section/timestamps/actions", () => {
    const sections = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
      ),
      "utf8",
    );
    const taskItem = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/assistant-task-item.tsx",
      ),
      "utf8",
    );
    const convItem = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-item.tsx",
      ),
      "utf8",
    );
    const automation = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/messaging/automation-nav-sidebar.tsx",
      ),
      "utf8",
    );

    for (const src of [sections, taskItem, convItem, automation]) {
      expect(src).not.toMatch(/text-dls-text\/(40|50|55)\b/);
      expect(src).not.toMatch(/text-dls-secondary\/(55|70|80)\b/);
    }
    // Section headers / chevrons use full secondary, not /80 or opacity-40 (except drag).
    expect(sections).toContain("text-dls-secondary");
    expect(sections).not.toContain("text-dls-secondary/80");
    // Timestamps use tertiary tier once.
    expect(taskItem).toContain("text-dls-text-tertiary");
    expect(convItem).toContain("text-dls-text-tertiary");
  });
});
