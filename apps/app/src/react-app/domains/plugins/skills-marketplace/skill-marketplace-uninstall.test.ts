import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  skillOverflowShowsUninstall,
  skillUninstallUsesDesktopScan,
} from "./skill-marketplace-uninstall";

const here = dirname(fileURLToPath(import.meta.url));

describe("skillOverflowShowsUninstall", () => {
  test("shows 卸载 for user-installed and local, hides builtin and readonly", () => {
    expect(skillOverflowShowsUninstall({})).toBe(true);
    expect(skillOverflowShowsUninstall({ originLocal: true })).toBe(true);
    expect(skillOverflowShowsUninstall({ originBuiltin: true })).toBe(false);
    expect(skillOverflowShowsUninstall({ originLocal: true, originBuiltin: true })).toBe(false);
    expect(skillOverflowShowsUninstall({ originLocal: true, readonly: true })).toBe(false);
    expect(skillOverflowShowsUninstall({ readonly: true })).toBe(false);
  });
});

describe("skillUninstallUsesDesktopScan", () => {
  test("local discovered skills use desktop scan, not server deleteSkill", () => {
    expect(skillUninstallUsesDesktopScan({ originLocal: true })).toBe(true);
    expect(skillUninstallUsesDesktopScan({ originLocal: false })).toBe(false);
    expect(skillUninstallUsesDesktopScan({})).toBe(false);
  });
});

describe("installed skill card wires local uninstall", () => {
  test("page uses overflow helper and desktop scan for local origin", () => {
    const page = readFileSync(join(here, "skills-marketplace-page.tsx"), "utf8");
    expect(page).toContain("skillOverflowShowsUninstall");
    expect(page).toContain("skillUninstallUsesDesktopScan");
    expect(page).toContain("originLocal: isLocalDiscoveredSkillPath(skill.path)");
    expect(page).not.toContain("!props.originLocal && !props.originBuiltin");
  });
});
