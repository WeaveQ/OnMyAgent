import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = [
  readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/agents/expert-creation-page.tsx",
  ),
  "utf8",
  ),
  readFileSync(
    join(
      import.meta.dir,
      "../src/react-app/domains/agents/expert-creation-basic-tab.tsx",
    ),
    "utf8",
  ),
  readFileSync(
    join(
      import.meta.dir,
      "../src/react-app/domains/agents/expert-creation-view-constants.ts",
    ),
    "utf8",
  ),
].join("\n");

describe("expert creation placeholder style contract", () => {
  test("shares the name field typography and placeholder color across form fields", () => {
    expect(source).toContain(
      '"text-sm placeholder:text-dls-secondary/65 border-dls-border/80 bg-dls-background shadow-none"',
    );
    expect(source).toContain(
      "className={EXPERT_FORM_FIELD_CLASS}",
    );
    expect(source).toContain(
      '"min-h-[5.25rem] leading-6",\n                  EXPERT_FORM_FIELD_CLASS,',
    );
    expect(source).toContain(
      '"min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-3.5 leading-6 shadow-none focus-visible:ring-0",\n            EXPERT_FORM_FIELD_CLASS,',
    );
  });
});
