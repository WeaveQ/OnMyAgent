import { describe, expect, test } from "bun:test";

import { createBlankWizardDraft, createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";
import { buildExpertCreationPreviewPendingContext } from "../src/react-app/domains/agents/expert-creation-preview-agent";

describe("expert creation preview agent", () => {
  test("pending context is the draft expert being created", () => {
    const registry = createDefaultAgentRegistry();
    const draft = createBlankWizardDraft(registry);
    draft.name = "美妆运营专家";
    draft.description = "淘宝美妆全链路";
    draft.userNote = "你是美妆运营专家";
    const pending = buildExpertCreationPreviewPendingContext(registry, draft, []);
    expect(pending).toBeTruthy();
    expect(pending?.name).toBe("美妆运营专家");
    expect(pending?.description).toBe("淘宝美妆全链路");
    expect(pending?.systemPrompt).toContain("美妆运营专家");
    expect(pending?.systemPrompt).toContain("你是美妆运营专家");
    expect(pending?.id.startsWith("preview-draft:")).toBe(true);
  });
});
