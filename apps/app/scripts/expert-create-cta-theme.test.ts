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
  test("uses the original dark treatment and a soft neutral light surface", () => {
    expect(createButtonSource).toContain('variant="ghost"');
    expect(createButtonSource).toContain('size="sidebar-cta"');
    expect(source).toContain("bg-dls-surface-muted");
    expect(source).toContain("text-dls-text");
    expect(source).toContain("hover:bg-dls-hover");
    expect(source).not.toContain("bg-dls-decision");
  });
});
