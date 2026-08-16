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

    // Idle (active: false) must use primary ink + named hover wash token.
    expect(railBlock).toContain(
      'false: "text-dls-text hover:bg-dls-rail-pill-hover"',
    );
    // Idle must not reintroduce secondary as the default ink.
    expect(railBlock).not.toContain("text-dls-secondary hover:bg-black/5");
    // Active uses dedicated free-float pill-active (not near-black rail-active).
    expect(railBlock).toContain("bg-dls-rail-pill-active text-dls-text");
  });

  test("compact account gear on rail uses primary ink idle", () => {
    const sidebar = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx",
      ),
      "utf8",
    );
    // Compact settings trigger (primary rail foot) — primary ink + free-float
    // open pill (surface / rail-active), never accent blue on the rail foot.
    const compactIdx = sidebar.indexOf("if (props.compact)");
    expect(compactIdx).toBeGreaterThanOrEqual(0);
    const compactBlock = sidebar.slice(compactIdx, compactIdx + 1200);
    expect(compactBlock).toContain("hover:bg-dls-rail-pill-hover");
    expect(compactBlock).toContain("aria-expanded:bg-dls-rail-pill-active");
    expect(compactBlock).not.toContain("hover:text-dls-accent");
  });

  test("home, experts, and automation create CTAs share footer soft-surface style", () => {
    const header = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );
    const panel = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
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

    // Home: search top + create footer (expert layout parity).
    expect(header).not.toContain("session.new_task");
    expect(header).toContain('data-assistant-search="true"');
    expect(header).toContain("session.search_tasks_placeholder");
    expect(panel).toContain('data-assistant-create="true"');
    expect(panel).toContain("session.new_task");
    expect(panel).toContain("SIDEBAR_FOOTER_CTA_CLASS");
    expect(panel).toContain('size="sidebar-cta"');
    expect(panel).toContain('variant="ghost"');
    // Home search filters by task title, not product name.
    expect(panel).toContain("mode === \"assistant\"");
    expect(panel).toContain("item.description");
    expect(panel).toContain("item.latestSession?.title");

    // Automation: search top + create footer (home/expert parity).
    expect(automation).toContain("SIDEBAR_FOOTER_CTA_CLASS");
    expect(automation).toContain('data-automation-create="true"');
    expect(automation).toContain('data-automation-search="true"');
    expect(automation).toContain("session.search_tasks_placeholder");
    expect(automation).toContain('size="sidebar-cta"');
    expect(automation).toContain('variant="ghost"');
    expect(automation).toContain("automation.add");
    expect(automation).not.toContain("SIDEBAR_PRIMARY_HEADER_CLASS");
    // Title filter on groups + sessions.
    expect(automation).toContain("group.title.toLowerCase()");
    expect(automation).toContain("session.title.toLowerCase()");

    // Shared chrome token module (single source of truth).
    const chrome = readFileSync(
      resolve(root, "apps/app/src/components/ui/sidebar-chrome.ts"),
      "utf8",
    );
    expect(chrome).toContain("SIDEBAR_FOOTER_CTA_CLASS");
    expect(chrome).toContain("bg-dls-active");
    expect(chrome).toContain("dark:bg-dls-surface-muted");
    expect(chrome).toContain('LIST_LANE_HEADER_CLASS = "flex h-14 shrink-0 items-center"');
    expect(chrome).toContain("SIDEBAR_PRIMARY_HEADER_CLASS");
    expect(chrome).toContain("pt-1.5");
    expect(chrome).toContain("TASK_ROW_ACTION_CLASS");

    // Token: Button size sidebar-cta = h-10 + rounded-lg (not sausage xl).
    const button = readFileSync(
      resolve(root, "apps/app/src/components/ui/button.tsx"),
      "utf8",
    );
    expect(button).toContain('"sidebar-cta"');
    expect(button).toContain("h-10 w-full");
    expect(button).toContain("rounded-lg");
  });

  test("automation nav session row idle uses primary ink, not secondary", () => {
    const automation = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/messaging/automation-nav-sidebar.tsx",
      ),
      "utf8",
    );
    // Idle row title: primary ink family.
    expect(automation).toContain('"text-dls-text hover:bg-dls-hover"');
    // Must not reintroduce secondary as the idle session-row label color.
    expect(automation).not.toContain(
      '"text-dls-secondary hover:bg-dls-hover hover:text-dls-text"',
    );
    // Shared TASK_ROW action chrome from sidebar-chrome (no local duplicate string).
    expect(automation).toContain("TASK_ROW_ACTION_CLASS");
    expect(automation).toContain('from "@/components/ui/sidebar-chrome"');
    expect(automation).not.toMatch(
      /const TASK_ROW_ACTION_CLASS\s*=/,
    );
    // Section / timestamp chrome uses type-scale token, not text-[11px].
    expect(automation).not.toMatch(/text-\[1[01]px\]/);
    expect(automation).toContain("text-2xs");
  });

  test("list-lane h-14 chrome is shared across home CTA, expert band, automation content header", () => {
    const header = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );
    const automationPage = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/messaging/automation-page.tsx",
      ),
      "utf8",
    );
    const sessionHeader = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/surface/chrome/session-surface-header.tsx",
      ),
      "utf8",
    );
    const typeScale = readFileSync(
      resolve(root, "apps/app/src/react-app/design-system/type-scale.ts"),
      "utf8",
    );

    // Expert list search band still lives in the header module (footer CTA is separate).
    expect(header).toContain("InputGroup");
    expect(header).not.toMatch(/flex h-14 shrink-0 items-center pt-2/);
    // Automation content header + session surface use LIST_LANE_HEADER_CLASS.
    expect(automationPage).toContain("LIST_LANE_HEADER_CLASS");
    expect(sessionHeader).toContain("LIST_LANE_HEADER_CLASS");
    // design-system re-exports for discoverability.
    expect(typeScale).toContain("listLaneHeader");
    expect(typeScale).toContain("listLaneHeaderCta");
    expect(typeScale).toContain("LIST_LANE_HEADER_CLASS");
  });

  test("dead surface APIs removed: showAgentSelectionTip and local_agent.search", () => {
    const header = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );
    const panel = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel.tsx",
      ),
      "utf8",
    );
    expect(header).not.toContain("showAgentSelectionTip");
    expect(panel).not.toContain("showAgentSelectionTip");

    for (const locale of ["en", "zh", "zh-TW"] as const) {
      const src = readFileSync(
        resolve(root, `apps/app/src/i18n/locales/${locale}/local_agent.ts`),
        "utf8",
      );
      expect(src).not.toContain('"local_agent.search"');
    }
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

    // Active: dark pill + pure white label/icon in light and dark.
    expect(navTab).toContain("bg-dls-text text-white");
    expect(navTab).toContain("dark:text-white");
    expect(navTab).toContain("[&_svg]:text-white");
    expect(navTab).toContain("dark:[&_svg]:text-white");
    // Idle: primary ink, not secondary slate.
    expect(navTab).toContain(
      'false:\n          "bg-transparent text-dls-text hover:bg-dls-hover/70 [&_svg]:text-current"',
    );
    expect(navTab).not.toContain(
      "bg-transparent text-dls-secondary hover:bg-dls-hover/70",
    );
  });

  test("sidebar idle chrome avoids stacked opacity on section/timestamps/actions", () => {
    const sections = [
      readFileSync(
        resolve(
          root,
          "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-sections.tsx",
        ),
        "utf8",
      ),
      readFileSync(
        resolve(
          root,
          "apps/app/src/react-app/domains/session/sidebar/assistant-conversation-rows.tsx",
        ),
        "utf8",
      ),
    ].join("\n");
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
