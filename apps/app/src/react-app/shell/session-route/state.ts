import { useSyncExternalStore } from "react";

import type {
  ModelBehaviorOption,
  PendingPermission,
  PendingQuestion,
  TodoItem,
} from "../../../app/types";
import { normalizeSessionStatus } from "../../../app/utils";
import {
  permissionKey,
  questionKey,
  todoKey,
} from "../../domains/session";
import { getReactQueryClient } from "../../infra/query-client";

export const emptyPendingPermissions: PendingPermission[] = [];
export const emptyPendingQuestions: PendingQuestion[] = [];
export const emptyTodos: TodoItem[] = [];
export const emptyModelBehaviorOptions: ModelBehaviorOption[] = [];
export const reloadAfterOrgOnboardingKey = "onmyagent.reloadAfterOrgOnboarding";

export function focusPromptSoon() {
  if (typeof window === "undefined") return;
  const focus = () => window.dispatchEvent(new Event("onmyagent:focusPrompt"));
  [0, 80, 240, 600].forEach((delay) => window.setTimeout(focus, delay));
}

export function permissionQueryKeyForSession(workspaceId: string, sessionId: string | null) {
  return workspaceId && sessionId ? permissionKey(workspaceId, sessionId) : null;
}

export function requiredPermissionQueryKey(workspaceId: string, sessionId: string) {
  return permissionKey(workspaceId, sessionId);
}

export function questionQueryKeyForSession(workspaceId: string, sessionId: string | null) {
  return workspaceId && sessionId ? questionKey(workspaceId, sessionId) : null;
}

export function requiredQuestionQueryKey(workspaceId: string, sessionId: string) {
  return questionKey(workspaceId, sessionId);
}

export function todoQueryKeyForSession(workspaceId: string, sessionId: string | null) {
  return workspaceId && sessionId ? todoKey(workspaceId, sessionId) : null;
}

export function useQueryCacheState<T>(
  queryKey: readonly unknown[] | null,
  fallback: T,
): T {
  const queryClient = getReactQueryClient();
  return useSyncExternalStore(
    (callback) =>
      queryKey ? queryClient.getQueryCache().subscribe(callback) : () => {},
    () =>
      queryKey ? (queryClient.getQueryData<T>(queryKey) ?? fallback) : fallback,
    () => fallback,
  );
}

// All workspace-scoped server URLs/clients/tokens come from
// `resolveWorkspaceEndpoint` in apps/app/src/app/lib/workspace-endpoint.ts.
// Don't compose `<baseUrl>/workspace/<id>` here.

export function isActiveSessionStatus(status: unknown) {
  return (
    status === "running" ||
    status === "retry" ||
    status === "busy" ||
    status === "streaming"
  );
}

export function getSessionStatus(session: unknown) {
  if (!session || typeof session !== "object") return normalizeSessionStatus(null);
  const value = session as {
    status?: unknown;
    state?: unknown;
    runStatus?: unknown;
  };
  const status =
    value.status ?? value.state ?? value.runStatus ?? null;
  return typeof status === "string" ? status : normalizeSessionStatus(status);
}
