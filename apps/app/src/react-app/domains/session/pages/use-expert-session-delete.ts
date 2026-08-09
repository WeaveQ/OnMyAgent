/**
 * Expert permanent-delete: sessions + workspace files + registry + packages.
 */
import { useCallback } from "react";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { t } from "../../../../i18n";
import {
  readCustomAgentSessionEntries,
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
  readExpertSessionIds,
  remainingExpertSessionIdsAfterDelete,
  removeExpertFromRegistry,
  removeExpertSession,
  uninstallExpertPackagesForAgent,
} from "../../agents";

export type ExpertGroupDeleteTarget = {
  kind: "expert";
  agentId: string;
  name: string;
  sessionIds: string[];
};

export type ExpertSessionDeleteTarget =
  | { kind: "session"; sessionId: string }
  | ExpertGroupDeleteTarget;

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
      try {
        await deleteSessionOwnedWorkspaceFiles({
          client,
          workspaceId,
          sessionId: id,
          directory,
          agentSlug: agentSlug ?? input.activeConversationAgentId ?? null,
          workspaceRoot: input.workspaceRoot,
        });
      } catch (error) {
        console.warn(
          "[expert] best-effort session file cleanup failed",
          id,
          error,
        );
      }
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

      if (input.onDeleteSession) {
        const deleteOne = input.onDeleteSession;
        await Promise.allSettled(
          target.sessionIds.map(async (sessionId) => {
            await purgeExpertSessionFiles(sessionId, target.agentId);
            permanentlyRemoveAssistantArchivedTask(
              input.workspaceId,
              sessionId,
            );
            return deleteOne(sessionId);
          }),
        );
      }

      clearExpertLocalSessionBindings(target.sessionIds);

      // Also clear any leftover session↔agent bindings for this expert.
      try {
        const leftover = readCustomAgentSessionEntries()
          .filter((entry) => entry.agentId === target.agentId)
          .map((entry) => entry.sessionId);
        clearExpertLocalSessionBindings(leftover);
        // Ghost-tab contract: remaining expert tags must not include deleted ids.
        const remaining = remainingExpertSessionIdsAfterDelete(
          readExpertSessionIds(),
          [...target.sessionIds, ...leftover],
        );
        for (const id of readExpertSessionIds()) {
          if (!remaining.includes(id)) removeExpertSession(id);
        }
      } catch {
        // Best effort.
      }

      try {
        await uninstallExpertPackagesForAgent({
          agentId: target.agentId,
          registry: input.registry ?? null,
        });
      } catch (error) {
        console.warn("[expert] package uninstall failed", target.agentId, error);
      }

      try {
        await removeExpertFromRegistry({
          agentId: target.agentId,
          registry: input.registry ?? null,
        });
      } catch (error) {
        console.warn("[expert] registry remove failed", target.agentId, error);
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
      purgeExpertSessionFiles,
    ],
  );

  return { purgeExpertSessionFiles, executeExpertDelete };
}

/** Copy for the expert delete confirm dialog (session vs whole expert). */
export function resolveExpertDeleteCopy(input: {
  deleteTarget: ExpertSessionDeleteTarget | null | undefined;
  sessionActionTitle: string;
  deleteBusy: boolean;
}): { title: string; message: string; confirmLabel: string } {
  const target = input.deleteTarget;
  const title =
    target?.kind === "expert"
      ? t("session.delete_expert_title")
      : t("session.delete_session_title");
  const message =
    target?.kind === "expert"
      ? target.name
        ? t("session.delete_named_expert_message", { name: target.name })
        : t("session.delete_expert_generic")
      : input.sessionActionTitle.trim()
        ? t("session.delete_named_session_message", {
            title: input.sessionActionTitle.trim(),
          })
        : t("session.delete_session_generic");
  const confirmLabel = input.deleteBusy
    ? t("session.deleting")
    : t("session.delete");
  return { title, message, confirmLabel };
}
