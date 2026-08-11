import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const appRoot = join(import.meta.dir, "..");

function read(relativePath: string): string {
  return readFileSync(join(appRoot, relativePath), "utf8");
}

describe("Expert lifecycle diagnostics surface", () => {
  test("exports the server-owned redacted ring from the existing Debug view", () => {
    const model = read("src/react-app/domains/settings/state/debug-view-model.ts");
    const view = read("src/react-app/domains/settings/pages/debug-view.tsx");

    expect(model).toContain("expertLifecycleEvents");
    expect(model).toContain("onmyagent-expert-lifecycle-");
    expect(model).toContain("onCopyExpertLifecycleEvents");
    expect(view).toContain("settings.expert_lifecycle_events_title");
    expect(view).toContain("props.expertLifecycleEventsJson");
    expect(view).toContain("<Button");
    expect(view).not.toContain("<button");
  });

  test("ships the diagnostics copy in all supported locales", () => {
    for (const locale of ["en", "zh", "zh-TW"]) {
      const source = read(`src/i18n/locales/${locale}/settings.ts`);
      expect(source).toContain('"settings.expert_lifecycle_events_title"');
      expect(source).toContain('"settings.expert_lifecycle_events_desc"');
      expect(source).toContain('"settings.expert_lifecycle_events_copied"');
      expect(source).toContain('"settings.expert_lifecycle_events_exported"');
    }
  });
});
