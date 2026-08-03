import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/session/sidebar/agent-conversation-panel-header.tsx",
  ),
  "utf8",
);
const createButtonStart = source.indexOf("onClick={props.onCreateExpert}");
const createButtonSource = source.slice(
  source.lastIndexOf("      <Button", createButtonStart),
  source.indexOf("      </Button>", createButtonStart),
);

describe("expert create CTA theme contract", () => {
  test("uses the primary decision button variant in the expert sidebar", () => {
    expect(createButtonSource).toContain('variant="default"');
    expect(createButtonSource).toContain('size="sidebar-cta"');
    expect(createButtonSource).not.toContain("EXPERT_CREATE_CTA_CLASS");
    expect(source).not.toContain("bg-dls-surface-muted text-dls-text shadow-none");
  });
});
