import { describe, expect, test } from "bun:test";

import { createBlankWizardDraft, createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";
import { EMPTY_EXPERT_COACH_STATE } from "../src/react-app/domains/agents/expert-creation-draft-storage";
import {
  buildExpertPreviewDraftKey,
  hasExpertCreationProgress,
  isExpertCreationPreviewReady,
} from "../src/react-app/domains/agents/expert-creation-lifecycle";
import { buildIsolatedExpertCreationModel } from "../src/react-app/domains/session/pages/expert-creation-embedded-model";
import { resolveExpertCreationWorkspaceRoot } from "../src/react-app/domains/session/pages/expert-creation-workspace-root";

describe("expert creation lifecycle", () => {
  const registry = createDefaultAgentRegistry();
  const baseline = createBlankWizardDraft(registry, registry.skills);

  test("treats an untouched draft as safe to close", () => {
    expect(hasExpertCreationProgress(baseline, baseline, EMPTY_EXPERT_COACH_STATE, 0)).toBe(false);
  });

  test("detects form, coach, skill, and knowledge progress", () => {
    expect(hasExpertCreationProgress({ ...baseline, name: "Researcher" }, baseline, EMPTY_EXPERT_COACH_STATE, 0)).toBe(true);
    expect(hasExpertCreationProgress({ ...baseline, skillIds: ["research"] }, baseline, EMPTY_EXPERT_COACH_STATE, 0)).toBe(true);
    expect(hasExpertCreationProgress(baseline, baseline, {
      ...EMPTY_EXPERT_COACH_STATE,
      messages: [{ id: "message", role: "user", content: "Help me" }],
    }, 0)).toBe(true);
    expect(hasExpertCreationProgress(baseline, baseline, EMPTY_EXPERT_COACH_STATE, 1)).toBe(true);
  });

  test("treats a created coach session as progress that requires an exit choice", () => {
    expect(hasExpertCreationProgress(baseline, baseline, {
      ...EMPTY_EXPERT_COACH_STATE,
      sessionId: "session-coach",
    }, 0)).toBe(true);
  });

  test("tracks behavior changes for preview sessions without depending on skill order", () => {
    const first = { ...baseline, name: "Researcher", skillIds: ["writing", "research"] };
    const sameBehavior = { ...first, skillIds: ["research", "writing"] };
    const changed = { ...first, agentMemory: "Remember the audience." };

    expect(buildExpertPreviewDraftKey(first)).toBe(buildExpertPreviewDraftKey(sameBehavior));
    expect(buildExpertPreviewDraftKey(first)).not.toBe(buildExpertPreviewDraftKey(changed));
  });

  test("keeps each embedded expert-creation model picker locally scoped", () => {
    const onLocalOpenChange = () => undefined;
    const model = buildIsolatedExpertCreationModel({
      modelLabel: "Model",
      onModelClick: () => undefined,
      modelPickerOpen: true,
      selectedModel: { providerID: "provider", modelID: "model" },
      onModelPickerOpenChange: () => undefined,
      onModelChange: () => undefined,
      modelVariantLabel: "",
      modelVariant: null,
      onModelVariantChange: () => undefined,
    }, false, onLocalOpenChange, false);

    expect(model.modelPickerOpen).toBe(false);
    expect(model.onModelPickerOpenChange).toBe(onLocalOpenChange);
    expect(model.modelPickerVisible).toBe(false);
  });

  test("requires every basic-information field except the avatar before preview", () => {
    const ready = {
      ...baseline,
      name: "Researcher",
      description: "Researches a topic",
      userNote: "Be rigorous",
    };

    expect(isExpertCreationPreviewReady(ready)).toBe(true);
    expect(isExpertCreationPreviewReady({ ...ready, name: " " })).toBe(false);
    expect(isExpertCreationPreviewReady({ ...ready, description: " " })).toBe(false);
    expect(isExpertCreationPreviewReady({ ...ready, userNote: " " })).toBe(false);
    expect(isExpertCreationPreviewReady({
      ...ready,
      avatarOptionId: null,
      customAvatarDataUrl: null,
    })).toBe(true);
  });

  test("uses the registry workspace root instead of the active Expert session directory", () => {
    expect(
      resolveExpertCreationWorkspaceRoot({
        selectedWorkspaceRoot:
          "/Users/test/Library/Application Support/OnMyAgent/expert-sessions/expert/session-old",
        workspaceFilesRoot: "/Users/test/workspace",
      }),
    ).toBe("/Users/test/workspace");
  });
});
