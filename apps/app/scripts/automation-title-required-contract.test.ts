import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");

describe("automation title required contract", () => {
  test("marks the title field as required for create and edit dialogs", () => {
    const source = readFileSync(
      join(
        repoRoot,
        "apps/app/src/react-app/domains/messaging/automation-page.tsx",
      ),
      "utf8",
    );

    expect(source).toContain('<AutomationField label={t("automation.field_name")} required>');
    expect(source).toContain('name="automation-title"');
    expect(source).toContain("aria-required=\"true\"");
    expect(source).toContain("required");
  });
});
