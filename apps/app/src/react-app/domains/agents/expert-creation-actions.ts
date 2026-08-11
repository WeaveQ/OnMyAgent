import { createElement, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { t } from "@/i18n";

import {
  writeMyExpertPackage,
  writeUserAgentRegistry,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import type { ModelRef } from "../../../app/types";
import {
  AGENT_REGISTRY_PATH,
  createAgentRecordFromDraft,
  createDefaultAgentRegistry,
  serializeAgentRegistry,
  serializeUserAgentRegistry,
} from "./agent-registry";
import {
  buildPendingAgentFromRecord,
  useAgentRegistryStore,
  writeSessionAgentSnapshot,
} from "./agent-registry-store";
import type {
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry-types";
import {
  createExpertOperationId,
  type PendingAgentContext,
} from "./pending-agent-store";
import {
  ExpertCreationPage,
  type ExpertKnowledgeEntry,
} from "./expert-creation-page";
import {
  buildSavedExpertPendingContext,
  createExpertRecordForSave,
  isCreationExpertEditable,
  updateExpertRecordFromDraft,
} from "./expert-creation-save-model";
import { deleteExpertCreationEphemeralSession } from "./expert-creation-ephemeral-sessions";
import type { ExpertCreationComposerProps } from "./expert-creation-conversation";
export {
  beginExpertCreateSaveAttempt,
  consumeExpertCreateComposerFlush,
} from "./expert-creation-flush";

async function encodeFileAsBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let index = 0; index < bytes.length; index += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
  }
  return btoa(binary);
}

export type SaveExpertCreationInput = {
  draft: AgentWizardDraft;
  knowledge: ExpertKnowledgeEntry[];
  availableSkills: AgentSkillItem[];
  registry: AgentRegistry | null;
  workspaceId: string;
  client: OnMyAgentServerClient | null;
  draftId?: string;
};

export type SaveExpertCreationResult = {
  agent: AgentRecord;
  registry: AgentRegistry;
  configPath: string;
};

export type UpdateExpertCreationInput = Omit<SaveExpertCreationInput, "draftId"> & {
  agent: AgentRecord;
};

export type ExpertCreationControllerInput = {
  registry: AgentRegistry | null;
  workspaceId: string;
  workspaceRoot: string;
  opencodeBaseUrl: string | null;
  onmyagentServerToken: string | null;
  client: OnMyAgentServerClient | null;
  skills: AgentRegistry["skills"];
  selectedModel: ModelRef | null;
  renderCoachPanel?: import("./expert-creation-page").ExpertCreationPageProps["renderCoachPanel"];
  renderPreviewPanel?: import("./expert-creation-page").ExpertCreationPageProps["renderPreviewPanel"];
  renderComposer: (props: ExpertCreationComposerProps) => ReactNode;
  showToast: (input: {
    title: string;
    description: string;
    tone: "success";
    durationMs: number;
  }) => void;
  onCreatedAgent: (agent: PendingAgentContext) => void;
};

export async function saveExpertCreation(
  input: SaveExpertCreationInput,
): Promise<SaveExpertCreationResult> {
  // Flush latch is owned by the create UI (submit): begin before save, consume
  // only when clearing stored creation draft after success — not here.
  const baseRegistry = input.registry ?? createDefaultAgentRegistry();
  const nowIso = new Date().toISOString();
  const createdAgent = createExpertRecordForSave(
    input.draft,
    nowIso,
    input.availableSkills,
  );
  let agent = createdAgent;
  let configPath = AGENT_REGISTRY_PATH;

  if (isElectronRuntime()) {
    const knowledge = await Promise.all(
      input.knowledge.map(async (entry) => ({
        kind: entry.kind,
        relativePath: entry.relativePath,
        ...(entry.file
          ? { dataBase64: await encodeFileAsBase64(entry.file) }
          : {}),
      })),
    );
    const written = await writeMyExpertPackage({
      id: createdAgent.id,
      packageName: createdAgent.id,
      name: createdAgent.name,
      description: createdAgent.description,
      quote: createdAgent.quote,
      rolePrompt: createdAgent.userNote,
      memory: createdAgent.agentMemory,
      skills: [...createdAgent.skillIds],
      knowledge,
      ...(createdAgent.customAvatarDataUrl
        ? { avatarDataUrl: createdAgent.customAvatarDataUrl }
        : {}),
      ...(input.draftId ? { draftId: input.draftId } : {}),
    });
    agent = {
      ...createdAgent,
      marketplaceSource: "mine",
      marketplacePath: written.path,
      marketplacePackageName: written.packageName,
    };
    configPath = "~/.onmyagent/agents/registry.json";
  } else {
    if (!input.client || !input.workspaceId.trim()) {
      throw new Error("OnMyAgent server client is unavailable");
    }
  }

  const nextRegistry: AgentRegistry = {
    ...baseRegistry,
    updatedAt: nowIso,
    agents: [agent, ...baseRegistry.agents],
  };
  if (isElectronRuntime()) {
    await writeUserAgentRegistry(serializeUserAgentRegistry(nextRegistry));
  } else if (input.client) {
    await input.client.writeWorkspaceFile(input.workspaceId, {
      path: AGENT_REGISTRY_PATH,
      content: serializeAgentRegistry(nextRegistry),
    });
  }

  return { agent, registry: nextRegistry, configPath };
}

export async function updateExpertCreation(
  input: UpdateExpertCreationInput,
): Promise<SaveExpertCreationResult> {
  if (!isCreationExpertEditable(input.agent)) {
    throw new Error("Only experts created in the expert creation flow can be edited");
  }

  const baseRegistry = input.registry ?? createDefaultAgentRegistry();
  if (!baseRegistry.agents.some((agent) => agent.id === input.agent.id)) {
    throw new Error("Expert is no longer available");
  }
  const nowIso = new Date().toISOString();
  const updatedDraftAgent = updateExpertRecordFromDraft(
    input.agent,
    input.draft,
    nowIso,
    input.availableSkills,
  );
  let agent = updatedDraftAgent;
  let configPath = AGENT_REGISTRY_PATH;

  if (isElectronRuntime()) {
    const packageName =
      input.agent.marketplacePackageName?.trim() || input.agent.id;
    const written = await writeMyExpertPackage({
      id: input.agent.id,
      packageName,
      name: updatedDraftAgent.name,
      description: updatedDraftAgent.description,
      quote: updatedDraftAgent.quote,
      rolePrompt: updatedDraftAgent.userNote,
      memory: updatedDraftAgent.agentMemory,
      skills: [...updatedDraftAgent.skillIds],
      preserveKnowledge: true,
      ...(updatedDraftAgent.customAvatarDataUrl
        ? { avatarDataUrl: updatedDraftAgent.customAvatarDataUrl }
        : {}),
    });
    agent = {
      ...updatedDraftAgent,
      marketplaceSource: "mine",
      marketplacePath: written.path,
      marketplacePackageName: written.packageName,
    };
    configPath = "~/.onmyagent/agents/registry.json";
  } else if (!input.client || !input.workspaceId.trim()) {
    throw new Error("OnMyAgent server client is unavailable");
  }

  const nextRegistry: AgentRegistry = {
    ...baseRegistry,
    updatedAt: nowIso,
    agents: baseRegistry.agents.map((item) =>
      item.id === agent.id ? agent : item,
    ),
  };
  if (isElectronRuntime()) {
    await writeUserAgentRegistry(serializeUserAgentRegistry(nextRegistry));
  } else if (input.client) {
    await input.client.writeWorkspaceFile(input.workspaceId, {
      path: AGENT_REGISTRY_PATH,
      content: serializeAgentRegistry(nextRegistry),
    });
  }

  return { agent, registry: nextRegistry, configPath };
}

export function buildExpertCreationPreview(
  draft: AgentWizardDraft,
  registry: AgentRegistry | null,
): PendingAgentContext | null {
  const baseRegistry = registry ?? createDefaultAgentRegistry();
  const preview = createAgentRecordFromDraft(
    draft,
    new Date().toISOString(),
    baseRegistry.skills,
  );
  const pending = buildPendingAgentFromRecord(preview, baseRegistry);
  if (!pending) return null;
  return {
    ...pending,
    operationId: createExpertOperationId(),
    draftCreatedAt: Date.now(),
    draftSource: "agent-selection",
  };
}

export function useExpertCreationController(
  input: ExpertCreationControllerInput,
) {
  const [open, setOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AgentRecord | null>(null);
  const openCreation = useCallback(() => {
    setEditingAgent(null);
    setOpen(true);
  }, []);
  const openExpertCreationForEdit = useCallback((agent: AgentRecord) => {
    if (!isCreationExpertEditable(agent)) return;
    setEditingAgent(agent);
    setOpen(true);
  }, []);
  const closeCreation = useCallback(() => {
    setOpen(false);
    setEditingAgent(null);
  }, []);
  const handleDone = useCallback(
    async (
      draft: AgentWizardDraft,
      knowledge: ExpertKnowledgeEntry[],
      availableSkills: AgentSkillItem[],
      draftId: string,
      coachSessionId: string | null,
    ) => {
      const result = editingAgent
        ? await updateExpertCreation({
            agent: editingAgent,
            draft,
            knowledge,
            availableSkills,
            registry: input.registry,
            workspaceId: input.workspaceId,
            client: input.client,
          })
        : await saveExpertCreation({
            draft,
            knowledge,
            availableSkills,
            registry: input.registry,
            workspaceId: input.workspaceId,
            client: input.client,
            draftId,
          });
      if (!editingAgent && coachSessionId && input.client) {
        writeSessionAgentSnapshot(coachSessionId, null);
        try {
          await deleteExpertCreationEphemeralSession({
            client: input.client,
            workspaceId: input.workspaceId,
            workspaceRoot: input.workspaceRoot,
            sessionId: coachSessionId,
          });
        } catch (error) {
          console.warn("[expert-creation] failed to delete completed coach session", error);
        }
      }
      useAgentRegistryStore.getState().setRegistry(result.registry);
      if (editingAgent) {
        input.showToast({
          title: t("agents.updated_agent_title", { name: result.agent.name }),
          description: t("agents.config_written_desc", {
            path: result.configPath,
          }),
          tone: "success",
          durationMs: 4000,
        });
        closeCreation();
        return;
      }
      const pending = buildSavedExpertPendingContext(
        result.agent,
        result.registry,
      );
      input.showToast({
        title: t("agents.created_title", { name: result.agent.name }),
        description: t("agents.config_written_desc", {
          path: result.configPath,
        }),
        tone: "success",
        durationMs: 4000,
      });
      closeCreation();
      if (pending) input.onCreatedAgent(pending);
    },
    [closeCreation, editingAgent, input],
  );
  const expertCreationPage: ReactNode = open
    ? createElement(ExpertCreationPage, {
        key: editingAgent ? `edit-${editingAgent.id}` : "create",
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot,
        opencodeBaseUrl: input.opencodeBaseUrl,
        onmyagentServerToken: input.onmyagentServerToken,
        client: input.client,
        registry: input.registry,
        skills: input.skills,
        selectedModel: input.selectedModel,
        renderCoachPanel: input.renderCoachPanel,
        renderPreviewPanel: input.renderPreviewPanel,
        renderComposer: input.renderComposer,
        showToast: input.showToast,
        editingAgent,
        onClose: closeCreation,
        onDone: handleDone,
      })
    : null;
  return {
    expertCreationPage,
    openExpertCreation: openCreation,
    openExpertCreationForEdit,
    closeExpertCreation: closeCreation,
  };
}
