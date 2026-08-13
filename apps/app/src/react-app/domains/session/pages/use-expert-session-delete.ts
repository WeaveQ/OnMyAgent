/**
 * Expert permanent-delete: sessions + workspace files + registry + packages.
 */
import { useCallback, useState } from "react";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { deleteExpertPackage } from "../../../../app/lib/desktop";
import { getReactQueryClient } from "../../../infra/query-client";
import { t } from "../../../../i18n";
import {
  type AgentRegistry,
} from "../../agents";
import {
  permanentlyRemoveAssistantArchivedTask,
  readAssistantArchivedTasks,
} from "../../shared";
import { deleteSessionOwnedWorkspaceFiles } from "../../workspace";
import {
  readExpertPinnedAgentIds,
  writeExpertPinnedAgentIds,
} from "../sidebar/conversation-model";
import { useExpertUnreadStore } from "../status/expert-unread-store";
import {
  canHardDeleteExpert,
  clearExpertLocalSessionBindings,
} from "../../agents";
import { isElectronRuntime } from "../../../../app/utils";
import { useAgentRegistryStore } from "../../agents";
import type { ExpertDeleteResult, ExpertDirectoryProjection } from "@onmyagent/types/server";
import type { ExpertPackageDeleteResult } from "@onmyagent/types/desktop-ipc";
import {
  evictExpertDirectorySessions,
  stripExpertDirectorySessionsFromProjection,
} from "../../../capabilities/session-identity/expert-directory-cache";
import { expertDirectoryQueryKey } from "../../../capabilities/session-identity/expert-directory-query";
import { useExpertDirectoryStore } from "../../../capabilities/session-identity/expert-directory-store";

export type ExpertGroupDeleteTarget = {
  kind: "expert";
  agentId: string;
  name: string;
  sessionIds: string[];
  packageName?: string;
  operationId: string;
};

export type ExpertDeleteProgress = {
  status: "idle" | "running" | "completed" | "failed";
  operationId?: string;
  server?: ExpertDeleteResult;
  desktop?: ExpertPackageDeleteResult;
  error?: string;
};

const DELETE_STEP_STATES = ["openCode", "runtime", "tombstone"] as const;

/** Redacted actionable progress details for the retry dialog. */
export function summarizeExpertDeleteProgress(
  progress: Pick<ExpertDeleteProgress, "server" | "desktop" | "error">,
): string {
  const details: string[] = [];
  for (const step of progress.server?.steps ?? []) {
    for (const field of DELETE_STEP_STATES) {
      const state = step[field];
      if (state === "failed" || state === "pending") {
        details.push(`server:${step.sessionId}:${field}:${step.code ?? state}`);
      }
    }
  }
  for (const step of progress.desktop?.steps ?? []) {
    if (step.state === "failed" || step.state === "pending") {
      details.push(`desktop:${step.target}:${step.code ?? step.state}`);
    }
  }
  return details.length > 0 ? details.slice(0, 6).join(", ") : "unknown";
}

export type ExpertSessionDeleteTarget =
  | { kind: "session"; sessionId: string }
  | ExpertGroupDeleteTarget;

/**
 * Resolve packageName for hard-delete so it matches session-origins rows.
 * Prefer explicit / registry marketplace name; never fall back to full agentId
 * when it is the "pkg:pkg" composite form.
 */
export function resolveExpertDeletePackageName(input: {
  agentId: string;
  packageName?: string | null;
  registry?: { agents: ReadonlyArray<{ id: string; marketplacePackageName?: string | null }> } | null;
}): string {
  const agentId = input.agentId.trim();
  const explicit = input.packageName?.trim();
  if (explicit && explicit !== agentId) return explicit;
  const fromRegistry = input.registry?.agents
    .find((agent) => agent.id === agentId)
    ?.marketplacePackageName?.trim();
  if (fromRegistry) return fromRegistry;
  if (explicit) {
    // explicit was equal to agentId — still try short form
    if (explicit.includes(":")) {
      const parts = explicit.split(":").filter(Boolean);
      if (parts.length >= 2 && parts[0] === parts[parts.length - 1]) {
        return parts[0]!;
      }
      return parts[parts.length - 1] || explicit;
    }
    return explicit;
  }
  if (agentId.includes(":")) {
    const parts = agentId.split(":").filter(Boolean);
    if (parts.length >= 2 && parts[0] === parts[parts.length - 1]) {
      return parts[0]!;
    }
    return parts[parts.length - 1] || agentId;
  }
  return agentId;
}

/** Desktop package uninstall only after the server actually deleted or replayed sessions. */
export function shouldUninstallExpertPackage(serverResult: Pick<ExpertDeleteResult, "state" | "steps">): boolean {
  return serverResult.state === "completed" && (serverResult.steps?.length ?? 0) > 0;
}

export function useExpertSessionDelete(input: {
  workspaceId: string;
  workspaceRoot: string;
  client: OnMyAgentServerClient | null;
  activeConversationAgentId: string | null;
  currentAgentSessions: ReadonlyArray<{
    id: string;
    directory?: string | null;
  }>;
  onDeleteSession?: (sessionId: string) => void | Promise<void>;
  /** Live agent registry for hard-delete (definition + packages). */
  registry?: AgentRegistry | null;
}) {
  const [deleteProgress, setDeleteProgress] = useState<ExpertDeleteProgress>({ status: "idle" });
  const purgeExpertSessionFiles = useCallback(
    async (sessionId: string, agentSlug?: string | null) => {
      const client = input.client;
      const workspaceId = input.workspaceId.trim();
      const id = sessionId.trim();
      if (!client || !workspaceId || !id) return;
      const match = input.currentAgentSessions.find(
        (session) => session.id === id,
      );
      const archived = readAssistantArchivedTasks(workspaceId).find(
        (task) => task.sessionId === id,
      );
      const directory = match?.directory ?? archived?.directory ?? null;
      await deleteSessionOwnedWorkspaceFiles({
        client,
        workspaceId,
        sessionId: id,
        directory,
        agentSlug: agentSlug ?? input.activeConversationAgentId ?? null,
        workspaceRoot: input.workspaceRoot,
      });
    },
    [
      input.activeConversationAgentId,
      input.client,
      input.currentAgentSessions,
      input.workspaceId,
      input.workspaceRoot,
    ],
  );

  const executeExpertDelete = useCallback(
    async (target: ExpertSessionDeleteTarget) => {
      if (target.kind === "session") {
        await purgeExpertSessionFiles(
          target.sessionId,
          input.activeConversationAgentId,
        );
        permanentlyRemoveAssistantArchivedTask(
          input.workspaceId,
          target.sessionId,
        );
        clearExpertLocalSessionBindings([target.sessionId]);
        await input.onDeleteSession?.(target.sessionId);
        return;
      }

      // Product builtins (e.g. creation coach) cannot be fully removed.
      if (!canHardDeleteExpert(target.agentId, input.registry ?? null)) {
        throw new Error("This system expert cannot be deleted");
      }

      const client = input.client;
      if (!client) throw new Error("Expert delete requires the server client");
      if (!isElectronRuntime()) throw new Error("Expert package cleanup requires the desktop runtime");
      // Origins store short packageName ("kol-ops"); agentId is often "kol-ops:kol-ops".
      // Never send agentId as packageName — that 404s expert_delete_target_not_found.
      const packageName = resolveExpertDeletePackageName({
        agentId: target.agentId,
        packageName: target.packageName,
        registry: input.registry ?? null,
      });
      const operationId = target.operationId?.trim();
      if (!operationId) throw new Error("Expert delete operation id is missing");
      setDeleteProgress({ status: "running", operationId });
      try {
        const serverResult = await client.deleteExpert(input.workspaceId, {
          operationId,
          agentId: target.agentId,
          packageName,
          marketplace: "my-experts",
          sessionIds: target.sessionIds,
        });
        setDeleteProgress({ status: "running", operationId, server: serverResult });
        if (serverResult.state !== "completed") {
          const error = summarizeExpertDeleteProgress({ server: serverResult });
          setDeleteProgress({ status: "failed", operationId, server: serverResult, error });
          throw new Error(error);
        }
        if (!shouldUninstallExpertPackage(serverResult)) {
          throw new Error("expert_delete_target_not_found");
        }
        evictExpertDirectorySessions(input.workspaceId, target.sessionIds);
        const directoryStore = useExpertDirectoryStore.getState();
        directoryStore.expireOverlay(input.workspaceId, target.sessionIds);
        const identity = directoryStore.getProjectionIdentity(input.workspaceId);
        const remainingIds = new Set(identity.sessionIds);
        const remainingAgents = new Map(identity.agentIdBySessionId);
        for (const sessionId of target.sessionIds) {
          remainingIds.delete(sessionId);
          remainingAgents.delete(sessionId);
        }
        directoryStore.setIdentity(input.workspaceId, {
          sessionIds: remainingIds,
          agentIdBySessionId: remainingAgents,
        });
        const queryClient = getReactQueryClient();
        const directoryQueryKey = expertDirectoryQueryKey(input.workspaceId);
        const currentDirectory = queryClient.getQueryData<ExpertDirectoryProjection>(directoryQueryKey);
        if (currentDirectory) {
          queryClient.setQueryData(
            directoryQueryKey,
            stripExpertDirectorySessionsFromProjection(currentDirectory, target.sessionIds),
          );
        }
        const desktopResult = await deleteExpertPackage({
          operationId,
          agentId: target.agentId,
          packageName,
          marketplace: "my-experts",
        });
        setDeleteProgress({ status: "running", operationId, server: serverResult, desktop: desktopResult });
        if (desktopResult.state !== "completed") {
          const error = summarizeExpertDeleteProgress({ server: serverResult, desktop: desktopResult });
          setDeleteProgress({ status: "failed", operationId, server: serverResult, desktop: desktopResult, error });
          throw new Error(error);
        }
        await queryClient.invalidateQueries({ queryKey: directoryQueryKey });
        clearExpertLocalSessionBindings(target.sessionIds);
        for (const sessionId of target.sessionIds) {
          permanentlyRemoveAssistantArchivedTask(input.workspaceId, sessionId);
        }
        const registry = input.registry;
        if (registry) {
          useAgentRegistryStore.getState().setRegistry({
            ...registry,
            agents: registry.agents.filter((agent) => agent.id !== target.agentId),
          });
        }
        setDeleteProgress({ status: "completed", operationId, server: serverResult, desktop: desktopResult });
      } catch (error) {
        setDeleteProgress((current) => ({
          ...current,
          status: "failed",
          operationId,
          error: current.error ?? (error instanceof Error ? error.message : "expert_delete_failed"),
        }));
        throw error;
      }

      try {
        const pinned = readExpertPinnedAgentIds(input.workspaceId);
        if (pinned.includes(target.agentId)) {
          writeExpertPinnedAgentIds(
            input.workspaceId,
            pinned.filter((id: string) => id !== target.agentId),
          );
        }
        useExpertUnreadStore
          .getState()
          .markRead(input.workspaceId, target.agentId);
      } catch {
        // Local cleanup only.
      }
    },
    [
      input.activeConversationAgentId,
      input.onDeleteSession,
      input.registry,
      input.workspaceId,
      deleteExpertPackage,
      getReactQueryClient,
      isElectronRuntime,
      purgeExpertSessionFiles,
    ],
  );

  return { purgeExpertSessionFiles, executeExpertDelete, deleteProgress };
}

/** Copy for the expert delete confirm dialog (session vs whole expert). */
export function resolveExpertDeleteCopy(input: {
  deleteTarget: ExpertSessionDeleteTarget | null | undefined;
  sessionActionTitle: string;
  deleteBusy: boolean;
  deleteProgress?: ExpertDeleteProgress;
}): { title: string; message: string; confirmLabel: string } {
  const target = input.deleteTarget;
  const title =
    target?.kind === "expert"
      ? t("session.delete_expert_title")
      : t("session.delete_session_title");
  const baseMessage =
    target?.kind === "expert"
      ? target.name
        ? t("session.delete_named_expert_message", { name: target.name })
        : t("session.delete_expert_generic")
      : input.sessionActionTitle.trim()
        ? t("session.delete_named_session_message", {
            title: input.sessionActionTitle.trim(),
          })
        : t("session.delete_session_generic");
  const failed = input.deleteProgress?.status === "failed" &&
    target?.kind === "expert" &&
    input.deleteProgress.operationId === target.operationId;
  const message = failed
    ? `${baseMessage} ${t("session.delete_partial_message", {
        error: summarizeExpertDeleteProgress(input.deleteProgress ?? {}),
      })}`
    : baseMessage;
  const confirmLabel = input.deleteBusy
    ? t("session.deleting")
    : failed
      ? t("session.delete_retry")
      : t("session.delete");
  return { title, message, confirmLabel };
}
