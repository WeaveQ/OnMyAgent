import { createElement, useCallback, useState } from "react";
import type { ReactNode } from "react";
import { t } from "@/i18n";

import {
  writeMyExpertPackage,
  writeUserAgentRegistry,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
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
  AgentWizardDraft,
} from "./agent-registry-types";
import type { PendingAgentContext } from "./pending-agent-store";
import {
  ExpertCreationPage,
  type ExpertKnowledgeEntry,
} from "./expert-creation-page";

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
  registry: AgentRegistry | null;
  workspaceId: string;
  client: OnMyAgentServerClient | null;
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
  client: OnMyAgentServerClient | null;
  skills: AgentRegistry["skills"];
  showToast: (input: {
    title: string;
    description: string;
    tone: "success";
    durationMs: number;
  }) => void;
  activateDraftAgent: (agent: PendingAgentContext) => void;
};

export async function saveExpertCreation(
  input: SaveExpertCreationInput,
): Promise<SaveExpertCreationResult> {
  const baseRegistry = input.registry ?? createDefaultAgentRegistry();
  const nowIso = new Date().toISOString();
  const createdAgent = createAgentRecordFromDraft(
    input.draft,
    nowIso,
    baseRegistry.skills,
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
      knowledge,
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
    async (draft: AgentWizardDraft, knowledge: ExpertKnowledgeEntry[]) => {
      const result = await saveExpertCreation({
        draft,
        knowledge,
        registry: input.registry,
        workspaceId: input.workspaceId,
        client: input.client,
      });
      useAgentRegistryStore.getState().setRegistry(result.registry);
      input.showToast({
        title: t("agents.created_title", { name: result.agent.name }),
        description: t("agents.config_written_desc", {
          path: result.configPath,
        }),
        tone: "success",
        durationMs: 3600,
      });
      setOpen(false);
    },
    [input],
  );
  const handleTry = useCallback(
    (draft: AgentWizardDraft) => {
      const pending = buildExpertCreationPreview(draft, input.registry);
      if (!pending) return;
      setOpen(false);
      input.activateDraftAgent(pending);
    },
    [input],
  );
  const expertCreationPage: ReactNode = open
    ? createElement(ExpertCreationPage, {
        workspaceId: input.workspaceId,
        workspaceRoot: input.workspaceRoot,
        client: input.client,
        registry: input.registry,
        skills: input.skills,
        onClose: closeCreation,
        onTry: handleTry,
        onDone: handleDone,
      })
    : null;
  return { expertCreationPage, openExpertCreation: openCreation };
}
