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
} from "./agent-registry-store";
import type {
  AgentRecord,
  AgentRegistry,
  AgentSkillItem,
  AgentWizardDraft,
} from "./agent-registry-types";
import type { PendingAgentContext } from "./pending-agent-store";
import {
  ExpertCreationPage,
  type ExpertKnowledgeEntry,
} from "./expert-creation-page";
import { createExpertRecordForSave } from "./expert-creation-save-model";
import type { ExpertCreationComposerProps } from "./expert-creation-conversation";

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
};

export async function saveExpertCreation(
  input: SaveExpertCreationInput,
): Promise<SaveExpertCreationResult> {
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
      skillIds: createdAgent.skillIds,
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
    conversationStartId: Date.now(),
    draftSource: "agent-selection",
  };
}

export function useExpertCreationController(
  input: ExpertCreationControllerInput,
) {
  const [open, setOpen] = useState(false);
  const openCreation = useCallback(() => setOpen(true), []);
  const closeCreation = useCallback(() => setOpen(false), []);
  const handleDone = useCallback(
    async (
      draft: AgentWizardDraft,
      knowledge: ExpertKnowledgeEntry[],
      availableSkills: AgentSkillItem[],
      draftId: string,
    ) => {
      const result = await saveExpertCreation({
        draft,
        knowledge,
        availableSkills,
        registry: input.registry,
        workspaceId: input.workspaceId,
        client: input.client,
        draftId,
      });
      useAgentRegistryStore.getState().setRegistry(result.registry);
      input.showToast({
        title: t("agents.created_title", { name: result.agent.name }),
        description: t("agents.config_written_desc", {
          path: result.configPath,
        }),
        tone: "success",
        durationMs: 4000,
      });
      setOpen(false);
    },
    [input],
  );
  const expertCreationPage: ReactNode = open
    ? createElement(ExpertCreationPage, {
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
        onClose: closeCreation,
        onDone: handleDone,
      })
    : null;
  return {
    expertCreationPage,
    openExpertCreation: openCreation,
    closeExpertCreation: closeCreation,
  };
}
