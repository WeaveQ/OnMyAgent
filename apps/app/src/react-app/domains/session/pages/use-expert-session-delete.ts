/**
 * Expert permanent-delete: sessions + workspace files + registry + packages.
 */
import { useCallback, useState } from "react";
import {
  OnMyAgentServerError,
  type OnMyAgentServerClient,
} from "../../../../app/lib/onmyagent-server";
import { deleteExpertPackage } from "../../../../app/lib/desktop";
import { getReactQueryClient } from "../../../infra/query-client";
import { t } from "../../../../i18n";
import {
  canHardDeleteExpert,
  clearExpertLocalSessionBindings,
  invalidateExpertPackageQuery,
  useAgentRegistryStore,
  type AgentRegistry,
} from "../../agents";
import {
  collectSessionSubtreeIds,
  permanentlyRemoveAssistantArchivedTask,
  permanentlyRemoveAssistantArchivedTaskTree,
  readAssistantArchivedTasks,
} from "../../shared";
import { deleteSessionOwnedWorkspaceFiles } from "../../workspace";
import {
  readExpertPinnedAgentIds,
  writeExpertPinnedAgentIds,
} from "../sidebar/conversation-model";
import { useExpertUnreadStore } from "../status/expert-unread-store";
import { isElectronRuntime } from "../../../../app/utils";
import type {
  ExpertDeleteRequest,
  ExpertDeleteResult,
  ExpertDirectoryProjection,
} from "@onmyagent/types/server";
import type {
  ExpertPackageDeleteInput,
  ExpertPackageDeleteResult,
} from "@onmyagent/types/desktop-ipc";
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
  source?: "mine" | "installed";
  sessionDirectories?: Record<string, string>;
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

/** Unused shelf experts have no origin rows; the server reports this before desktop uninstall. */
export function isExpertDeleteTargetNotFound(error: unknown): boolean {
  if (error instanceof OnMyAgentServerError) {
    return error.code === "expert_delete_target_not_found";
  }
  return error instanceof Error && error.message === "expert_delete_target_not_found";
}

export function realExpertDeleteSessionIds(sessionIds: readonly string[]): string[] {
  return sessionIds.map((id) => id.trim()).filter((id) => id && !id.startsWith("draft:"));
}

/** Draft-only UI rows skip the origin saga. Empty means “delete every origin”. */
export function shouldSkipServerExpertSessionDelete(sessionIds: readonly string[]): boolean {
  return sessionIds.length > 0 && realExpertDeleteSessionIds(sessionIds).length === 0;
}

/** Leftover UI sessions without origin rows must not block package uninstall. */
export function shouldContinueExpertDeleteAfterServerError(error: unknown): boolean {
  return isExpertDeleteTargetNotFound(error);
}

export function shouldProceedWithDesktopPackageDelete(input: {
  source?: "mine" | "installed";
  sessionIds: readonly string[];
  serverResult?: Pick<ExpertDeleteResult, "state" | "steps">;
  serverMissed: boolean;
}): boolean {
  if (input.serverMissed) return true;
  if (input.source === "mine") return true;
  if (!input.serverResult) return shouldSkipServerExpertSessionDelete(input.sessionIds);
  return input.serverResult.state === "completed";
}

export async function awaitExpertDeleteStep<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label}_timeout`)), timeoutMs);
      }),
    ]);
  } catch (error) {
    void promise.then(() => undefined, () => undefined);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

export const EXPERT_DELETE_SERVER_TIMEOUT_MS = 60_000;
export const EXPERT_DELETE_DESKTOP_TIMEOUT_MS = 15_000;

export type RunExpertHardDeleteInput = {
  workspaceId: string;
  operationId: string;
  agentId: string;
  packageName: string;
  marketplace: ExpertPackageDeleteInput["marketplace"];
  sessionIds: readonly string[];
  source?: "mine" | "installed";
};

export type RunExpertHardDeleteDeps = {
  deleteExpert: OnMyAgentServerClient["deleteExpert"];
  deleteExpertPackage: (input: ExpertPackageDeleteInput) => Promise<ExpertPackageDeleteResult>;
  timeoutMs?: number;
  onServerResult?: (result: ExpertDeleteResult) => void;
  onBeforeDesktop?: (input: {
    serverResult?: ExpertDeleteResult;
    serverMissed: boolean;
  }) => void | Promise<void>;
};

/**
 * Shipped expert hard-delete RPCs: server session origins then desktop package.
 * Leftover UI sessionIds that 404 origins still uninstall the package.
 */
export async function runExpertHardDelete(
  input: RunExpertHardDeleteInput,
  deps: RunExpertHardDeleteDeps,
): Promise<{
  server?: ExpertDeleteResult;
  desktop: ExpertPackageDeleteResult;
  serverMissed: boolean;
}> {
  const serverTimeoutMs = deps.timeoutMs ?? EXPERT_DELETE_SERVER_TIMEOUT_MS;
  const desktopTimeoutMs = deps.timeoutMs ?? EXPERT_DELETE_DESKTOP_TIMEOUT_MS;
  const requestedIds = realExpertDeleteSessionIds(input.sessionIds);
  const request: ExpertDeleteRequest = {
    operationId: input.operationId,
    agentId: input.agentId,
    packageName: input.packageName,
    marketplace: input.marketplace,
    sessionIds: requestedIds,
  };
  let serverResult: ExpertDeleteResult | undefined;
  let serverMissed = false;
  const runServerDelete = (sessionIds: string[]) =>
    awaitExpertDeleteStep(
      deps.deleteExpert(input.workspaceId, { ...request, sessionIds }),
      serverTimeoutMs,
      "expert_delete_server",
    );
  if (!shouldSkipServerExpertSessionDelete(input.sessionIds)) {
    try {
      serverResult = await runServerDelete(requestedIds);
    } catch (error) {
      if (!shouldContinueExpertDeleteAfterServerError(error)) {
        throw error;
      }
      if (requestedIds.length === 0) {
        serverMissed = true;
      } else {
        try {
          serverResult = await runServerDelete([]);
        } catch (retryError) {
          if (!shouldContinueExpertDeleteAfterServerError(retryError)) {
            throw retryError;
          }
          serverMissed = true;
        }
      }
    }
  }
  if (serverResult) {
    deps.onServerResult?.(serverResult);
    if (serverResult.state !== "completed") {
      throw new Error(summarizeExpertDeleteProgress({ server: serverResult }));
    }
  }
  if (
    !shouldProceedWithDesktopPackageDelete({
      source: input.source,
      sessionIds: input.sessionIds,
      serverResult,
      serverMissed,
    })
  ) {
    throw new Error("expert_delete_target_not_found");
  }
  await deps.onBeforeDesktop?.({ serverResult, serverMissed });
  const desktop = await awaitExpertDeleteStep(
    deps.deleteExpertPackage({
      operationId: input.operationId,
      agentId: input.agentId,
      packageName: input.packageName,
      marketplace: input.marketplace,
    }),
    desktopTimeoutMs,
    "expert_delete_desktop",
  );
  return { server: serverResult, desktop, serverMissed };
}

/** Self-created packages live in my-experts; summoned installs live in experts. */
export function resolveExpertPackageDeleteMarketplace(input: {
  source?: "mine" | "installed";
  agentId: string;
  registry?: AgentRegistry | null;
}): "my-experts" | "experts" {
  if (input.source === "installed") return "experts";
  if (input.source === "mine") return "my-experts";
  const agent = input.registry?.agents.find((item) => item.id === input.agentId.trim());
  return agent?.marketplaceSource === "installed" ? "experts" : "my-experts";
}

export function resolveExpertDeleteSessionDirectory(input: {
  sessionId: string;
  sessionDirectories?: Record<string, string>;
  currentAgentSessions: ReadonlyArray<{ id: string; directory?: string | null }>;
  archivedDirectory?: string | null;
}): string | null {
  const id = input.sessionId.trim();
  if (!id) return null;
  return (
    input.sessionDirectories?.[id]?.trim() ||
    input.currentAgentSessions.find((session) => session.id === id)?.directory?.trim() ||
    input.archivedDirectory?.trim() ||
    null
  );
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
    async (
      sessionId: string,
      agentSlug?: string | null,
      directoryOverride?: string | null,
    ) => {
      const client = input.client;
      const workspaceId = input.workspaceId.trim();
      const id = sessionId.trim();
      if (!client || !workspaceId || !id) return;
      const archived = readAssistantArchivedTasks(workspaceId).find(
        (task) => task.sessionId === id,
      );
      const directory = resolveExpertDeleteSessionDirectory({
        sessionId: id,
        sessionDirectories: directoryOverride?.trim()
          ? { [id]: directoryOverride.trim() }
          : undefined,
        currentAgentSessions: input.currentAgentSessions,
        archivedDirectory: archived?.directory ?? null,
      });
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
        const subtreeIds = collectSessionSubtreeIds(
          input.currentAgentSessions,
          target.sessionId,
        );
        for (const id of subtreeIds) {
          await purgeExpertSessionFiles(id, input.activeConversationAgentId);
        }
        permanentlyRemoveAssistantArchivedTaskTree(
          input.workspaceId,
          target.sessionId,
        );
        clearExpertLocalSessionBindings(subtreeIds);
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
        const marketplace = resolveExpertPackageDeleteMarketplace({
          source: target.source,
          agentId: target.agentId,
          registry: input.registry ?? null,
        });
        let deletedSessionIds: string[] = [];
        const { server: serverResult, desktop: desktopResult } = await runExpertHardDelete(
          {
            workspaceId: input.workspaceId,
            operationId,
            agentId: target.agentId,
            packageName,
            marketplace,
            sessionIds: target.sessionIds,
            source: target.source,
          },
          {
            deleteExpert: (workspaceId, request) => client.deleteExpert(workspaceId, request),
            deleteExpertPackage,
            onServerResult: (server) => {
              setDeleteProgress({ status: "running", operationId, server });
            },
            onBeforeDesktop: async ({ serverResult: completedServer }) => {
              deletedSessionIds =
                target.sessionIds.length > 0
                  ? [...target.sessionIds]
                  : (completedServer?.steps ?? [])
                      .map((step) => step.sessionId.trim())
                      .filter(Boolean);
              for (const sessionId of deletedSessionIds) {
                await purgeExpertSessionFiles(
                  sessionId,
                  target.packageName || target.agentId,
                  target.sessionDirectories?.[sessionId],
                );
              }
              const queryClient = getReactQueryClient();
              const directoryQueryKey = expertDirectoryQueryKey(input.workspaceId);
              if (deletedSessionIds.length > 0) {
                evictExpertDirectorySessions(input.workspaceId, deletedSessionIds);
                const directoryStore = useExpertDirectoryStore.getState();
                directoryStore.expireOverlay(input.workspaceId, deletedSessionIds);
                const identity = directoryStore.getProjectionIdentity(input.workspaceId);
                const remainingIds = new Set(identity.sessionIds);
                const remainingAgents = new Map(identity.agentIdBySessionId);
                for (const sessionId of deletedSessionIds) {
                  remainingIds.delete(sessionId);
                  remainingAgents.delete(sessionId);
                }
                directoryStore.setIdentity(input.workspaceId, {
                  sessionIds: remainingIds,
                  agentIdBySessionId: remainingAgents,
                });
                const currentDirectory =
                  queryClient.getQueryData<ExpertDirectoryProjection>(directoryQueryKey);
                if (currentDirectory) {
                  queryClient.setQueryData(
                    directoryQueryKey,
                    stripExpertDirectorySessionsFromProjection(currentDirectory, deletedSessionIds),
                  );
                }
              }
            },
          },
        );
        const queryClient = getReactQueryClient();
        const directoryQueryKey = expertDirectoryQueryKey(input.workspaceId);
        setDeleteProgress({ status: "running", operationId, server: serverResult, desktop: desktopResult });
        if (desktopResult.state !== "completed") {
          const error = summarizeExpertDeleteProgress({ server: serverResult, desktop: desktopResult });
          setDeleteProgress({ status: "failed", operationId, server: serverResult, desktop: desktopResult, error });
          throw new Error(error);
        }
        await queryClient.invalidateQueries({ queryKey: directoryQueryKey });
        await invalidateExpertPackageQuery();
        clearExpertLocalSessionBindings(deletedSessionIds);
        for (const sessionId of deletedSessionIds) {
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
