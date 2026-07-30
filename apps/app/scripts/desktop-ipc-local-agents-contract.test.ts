/**
 * Contract: Personal Local Agent wire types live in a split module re-exported
 * from the public desktop-ipc entry (shipped packages/types paths).
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const typesRoot = join(import.meta.dir, "../../../packages/types/src");

describe("desktop-ipc local-agents split (shipped)", () => {
  test("local-agents module holds PersonalLocalAgent surface", () => {
    const src = readFileSync(join(typesRoot, "desktop-ipc-local-agents.ts"), "utf8");
    expect(src).toContain("export type PersonalLocalAgent ");
    expect(src).toContain("export type PersonalLocalAgentRunInput ");
    expect(src).toContain("export type LocalAgentComposerListFilesInput ");
  });

  test("public desktop-ipc imports and re-exports the split module", () => {
    const entry = readFileSync(join(typesRoot, "desktop-ipc.ts"), "utf8");
    expect(entry).toContain('from "./desktop-ipc-local-agents.js"');
    expect(entry).toContain("export type AgentManagementAgent = PersonalLocalAgent");
    // Monolith must not still define the heavy agent type body.
    expect(entry).not.toMatch(
      /export type PersonalLocalAgent = \{\n\s*id: string/,
    );
  });
});
