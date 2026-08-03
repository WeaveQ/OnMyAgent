import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const pageSource = readFileSync(
  join(
    import.meta.dir,
    "../src/react-app/domains/agents/expert-creation-page.tsx",
  ),
  "utf8",
);

describe("expert creation suggestion application UI contract", () => {
  test("decides whether to show the applied feedback from the current draft", () => {
    expect(pageSource).not.toContain("let appliedCount = 0;");
    expect(pageSource).toContain(
      "const merged = mergeExpertDraftSuggestion(\n                draft,\n                suggestion,\n                options.mode,\n              );",
    );
  });
});
