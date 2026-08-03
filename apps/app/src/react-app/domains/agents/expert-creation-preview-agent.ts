import { t } from "@/i18n";

import { createAgentRecordFromDraft } from "./agent-registry";
import { buildPendingAgentFromRecord } from "./agent-registry-store";
import type { AgentRegistry, AgentWizardDraft } from "./agent-registry-types";
import { buildExpertPreviewSystemPrompt } from "./expert-creation-preview-runtime";
import {
  buildAgentToolAccess,
  type AgentToolAccessMap,
  type PendingAgentContext,
} from "./pending-agent-store";

/**
 * PendingAgentContext for "try draft expert" preview — identity is the expert
 * currently being created, not the creation coach.
 */
export function buildExpertCreationPreviewPendingContext(
  registry: AgentRegistry,
  draft: AgentWizardDraft,
  knowledgePaths: readonly string[] = [],
): PendingAgentContext | null {
  const record = createAgentRecordFromDraft(
    draft,
    new Date().toISOString(),
    registry.skills,
  );
  const base = buildPendingAgentFromRecord(record, registry);
  if (!base) return null;
  const displayName =
    draft.name.trim() || t("agents.expert_creation_preview_title");
  return {
    ...base,
    id: `preview-draft:${record.id}`,
    name: displayName,
    description: draft.description.trim(),
    systemPrompt: buildExpertPreviewSystemPrompt(draft, knowledgePaths),
    tools: buildAgentToolAccess(draft),
    conversationStartId: Date.now(),
    draftSource: "agent-selection",
  };
}

export function buildExpertCreationPreviewToolAccess(
  draft: AgentWizardDraft,
): AgentToolAccessMap | undefined {
  return buildAgentToolAccess(draft);
}
