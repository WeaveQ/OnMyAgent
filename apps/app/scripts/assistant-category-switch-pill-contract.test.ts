import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

/**
 * Code track removed: home header must not render an office/code switch.
 */
describe("assistant category switch pill contract", () => {
  test("home header has no office/code category switch", () => {
    const header = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
      ),
      "utf8",
    );
    const controls = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/sidebar/assistant-sidebar-controls.tsx",
      ),
      "utf8",
    );
    const config = readFileSync(
      resolve(
        root,
        "apps/app/src/react-app/domains/session/surface/personal-assistant-config.ts",
      ),
      "utf8",
    );

    expect(header).not.toContain("AssistantCategorySwitch");
    expect(controls).not.toContain("AssistantCategorySwitch");
    expect(controls).not.toContain("AssistantCodeTabIcon");
    expect(config).toContain('export type AssistantCategoryId = "office"');
    expect(config).not.toContain('id: "code"');
  });
});
