import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");
const settingsPage = resolve(
  root,
  "apps/app/src/react-app/domains/settings/shell/settings-page.tsx",
);

describe("settings tab icon semantics (live getSettingsTabIcon)", () => {
  test("models/AI uses Cpu, not Zap; system uses Monitor, not MonitorSmartphone", () => {
    const src = readFileSync(settingsPage, "utf8");
    expect(src).toMatch(/case "ai":\s*[\s\S]*?return Cpu/);
    expect(src).not.toMatch(/case "ai":\s*[\s\S]*?return Zap/);
    expect(src).toMatch(/case "system":\s*[\s\S]*?return Monitor;/);
    expect(src).not.toMatch(/case "system":\s*[\s\S]*?return MonitorSmartphone/);
    // LocalAgent still uses MonitorSmartphone elsewhere — settings must not.
    expect(src).not.toContain("MonitorSmartphone");
    expect(src).not.toMatch(/\bZap\b/);
  });
});
