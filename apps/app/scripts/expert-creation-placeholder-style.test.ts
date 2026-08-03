import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/agents/expert-creation-page.tsx",
  ),
  "utf8",
);

describe("expert creation placeholder style contract", () => {
  test("shares the name field typography and placeholder color across form fields", () => {
    expect(source).toContain(
      'const EXPERT_FORM_FIELD_CLASS = "text-sm placeholder:text-dls-secondary/70";',
    );
    expect(source).toContain(
      'className={cn("border-0 shadow-none", EXPERT_FORM_FIELD_CLASS)}',
    );
    expect(source).toContain(
      'className={cn("min-h-20 border-0 shadow-none", EXPERT_FORM_FIELD_CLASS)}',
    );
    expect(source).toContain(
      '"min-h-0 flex-1 resize-none rounded-none border-0 bg-transparent px-4 py-3 shadow-none focus-visible:ring-0",\n          EXPERT_FORM_FIELD_CLASS,',
    );
  });
});
