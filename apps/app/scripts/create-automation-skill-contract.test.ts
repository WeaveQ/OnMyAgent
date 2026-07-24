import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "../../..");

async function read(relativePath: string) {
  return Bun.file(resolve(root, relativePath)).text();
}

describe("create-automation bundled skill contract", () => {
  test("ships one trusted proposal contract for expert and ordinary sessions", async () => {
    const skill = await read(
      "apps/desktop/resources/bundled-skills/create-automation/SKILL.md",
    );
    const schema = await read(
      "apps/desktop/resources/bundled-skills/create-automation/references/proposal-schema.md",
    );
    const assistant = await read(
      "apps/app/src/react-app/domains/session/pages/assistant.tsx",
    );
    const expertOffer = await read(
      "apps/app/src/react-app/domains/session/pages/use-expert-automation-offer.tsx",
    );

    expect(skill).toContain("automations/proposals/<descriptive-slug>.json");
    expect(skill).toContain("Omit `sourceSessionId` and `workspaceDirectory`");
    expect(skill).toContain("inherits the current conversation model");
    expect(schema).toContain('"mode": "interval"');
    expect(schema).toContain('"mode": "once"');
    expect(schema).toContain("Do not write `sourceSessionId`, `workspaceDirectory`");
    expect(assistant).toContain("useSessionAutomationOffer({");
    expect(expertOffer).toContain("loadNewAutomationProposals({");
    expect(expertOffer).toContain("createAutomationsFromPayloads({");
    expect(expertOffer).toContain("defaultWorkspaceDirectory: sessionDirectory");
    expect(expertOffer).toContain("sourceSessionId: input.selectedSessionId");
  });
});
