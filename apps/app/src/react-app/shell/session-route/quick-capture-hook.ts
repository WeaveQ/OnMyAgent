/**
 * Global quick-capture → session route:
 * - create session + seed composer + optional auto-send
 * - push model catalog into the desktop mini panel
 * - tray "continue last session"
 */
import { useCallback, useEffect, type Dispatch, type SetStateAction } from "react";

import { createClient, unwrap } from "../../../app/lib/opencode";
import { resolveWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import {
  saveSessionDraft,
  setComposerDraftAfterNewTask,
  useComposerStateStore,
} from "../../domains/session";
import {
  readLastSessionFor,
  writeActiveWorkspaceId,
  writeLastSessionFor,
} from "../session-memory";
import { isDesktopRuntime } from "../../../app/utils";
import { focusPromptSoon } from "./state";
import {
  findFirstSessionIdMatching,
  insertSidebarSession,
  type PendingCreatedSessionMap,
} from "./sessions";
import type { RouteWorkspace } from "./model";
import type { SidebarSessionItem } from "../../../app/types";

type ModelRef = { providerID: string; modelID: string } | null | undefined;

type ModelOption = {
  providerID: string;
  modelID: string;
  title?: string;
  disabled?: boolean;
};

type Input = {
  baseUrl: string;
  token: string;
  pageMode: "assistant" | "expert";
  workspaces: RouteWorkspace[];
  selectedWorkspaceId: string;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  sessionMatchesPageMode: (sessionId: string) => boolean;
  effectiveModelRef: ModelRef;
  allowedModelOptions: ModelOption[] | null | undefined;
  modelLabel: string | null | undefined;
  handleCreateTaskInWorkspace: (workspaceId: string) => void | Promise<void>;
  navigateToWorkspaceSession: (
    workspaceId: string,
    sessionId?: string | null,
  ) => void;
  rememberPendingCreatedSession: (workspaceId: string, sessionId: string) => void;
  setSessionsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, SidebarSessionItem[]>>
  >;
};

export function useSessionRouteQuickCapture(input: Input) {
  const {
    baseUrl,
    token,
    pageMode,
    workspaces,
    selectedWorkspaceId,
    sessionsByWorkspaceId,
    sessionMatchesPageMode,
    effectiveModelRef,
    allowedModelOptions,
    modelLabel,
    handleCreateTaskInWorkspace,
    navigateToWorkspaceSession,
    rememberPendingCreatedSession,
    setSessionsByWorkspaceId,
  } = input;

  const handleCreateTaskWithPrompt = useCallback(
    async (
      workspaceId: string,
      prompt: string,
      modelOverride?: { providerID: string; modelID: string } | null,
    ) => {
      const text = prompt.trim();
      if (!text) {
        void handleCreateTaskInWorkspace(workspaceId);
        return;
      }
      const workspace = workspaces.find((item) => item.id === workspaceId);
      if (!workspace) {
        void handleCreateTaskInWorkspace(workspaceId);
        return;
      }
      const endpoint = resolveWorkspaceEndpoint(workspace, {
        baseUrl,
        token,
      });
      if (!endpoint?.token) {
        // No runtime endpoint yet — open empty new-task and seed draft key.
        void handleCreateTaskInWorkspace(workspaceId);
        setComposerDraftAfterNewTask(workspaceId, text);
        return;
      }
      const workspaceClient = createClient(
        endpoint.opencodeBaseUrl,
        workspace.path?.trim() || undefined,
        { token: endpoint.token, mode: "onmyagent" },
      );
      try {
        const session = unwrap(
          await workspaceClient.session.create({
            directory: workspace.path?.trim() || undefined,
          }),
        );
        // Composer UI reads Zustand composer-state-store (not saveSessionDraft alone).
        const seedComposer = () => {
          useComposerStateStore.getState().setDraft(session.id, text);
        };
        seedComposer();
        if (typeof window !== "undefined") {
          window.setTimeout(seedComposer, 0);
          window.requestAnimationFrame(() => {
            window.requestAnimationFrame(seedComposer);
          });
          // Late retries: session surface may mount after navigate.
          window.setTimeout(seedComposer, 120);
          window.setTimeout(seedComposer, 200);
        }
        saveSessionDraft(workspaceId, session.id, {
          text,
          mode: "prompt",
        });
        writeActiveWorkspaceId(workspaceId || null);
        writeLastSessionFor(workspaceId, session.id, pageMode);
        rememberPendingCreatedSession(workspaceId, session.id);
        setSessionsByWorkspaceId((current) =>
          insertSidebarSession({
            current,
            workspaceId,
            session,
          }),
        );
        navigateToWorkspaceSession(workspaceId, session.id);
        focusPromptSoon();

        // Prefer model chosen in the quick-capture panel; fall back to session default.
        const model =
          modelOverride?.providerID && modelOverride?.modelID
            ? modelOverride
            : effectiveModelRef;
        if (model?.providerID && model?.modelID) {
          void (async () => {
            try {
              await workspaceClient.session.promptAsync({
                sessionID: session.id,
                model: {
                  providerID: model.providerID,
                  modelID: model.modelID,
                },
                parts: [{ type: "text", text }],
              });
              // Clear draft after successful send so composer does not re-show it.
              useComposerStateStore.getState().setDraft(session.id, "");
            } catch (error) {
              // Keep draft in composer so the user can press send manually.
              console.warn(
                "[quick-capture] auto-send failed; draft left in composer",
                error,
              );
              seedComposer();
              focusPromptSoon();
            }
          })();
        }
      } catch (error) {
        console.warn("[quick-capture] create session failed", error);
        void handleCreateTaskInWorkspace(workspaceId);
        setComposerDraftAfterNewTask(workspaceId, text);
      }
    },
    [
      baseUrl,
      effectiveModelRef,
      handleCreateTaskInWorkspace,
      navigateToWorkspaceSession,
      pageMode,
      rememberPendingCreatedSession,
      setSessionsByWorkspaceId,
      token,
      workspaces,
    ],
  );

  const handleOpenRecentSession = useCallback(() => {
    const workspaceId = selectedWorkspaceId.trim();
    if (!workspaceId) return;
    const lastId = readLastSessionFor(workspaceId, pageMode);
    if (lastId) {
      navigateToWorkspaceSession(workspaceId, lastId);
      return;
    }
    const first = findFirstSessionIdMatching(
      sessionsByWorkspaceId[workspaceId] ?? [],
      sessionMatchesPageMode,
    );
    if (first) {
      navigateToWorkspaceSession(workspaceId, first);
      return;
    }
    void handleCreateTaskInWorkspace(workspaceId);
  }, [
    handleCreateTaskInWorkspace,
    navigateToWorkspaceSession,
    pageMode,
    selectedWorkspaceId,
    sessionMatchesPageMode,
    sessionsByWorkspaceId,
  ]);

  // Keep quick-capture model picker in sync with available models / default.
  useEffect(() => {
    if (!isDesktopRuntime()) return;
    const models = (allowedModelOptions ?? [])
      .filter((option) => option?.providerID && option?.modelID)
      .slice(0, 80)
      .map((option) => ({
        providerID: option.providerID,
        modelID: option.modelID,
        title: option.title?.trim() || option.modelID,
        disabled: option.disabled === true,
      }));
    void import("../../../app/lib/desktop")
      .then(({ desktopBridge }) =>
        desktopBridge.setQuickCaptureContext({
          modelLabel: modelLabel?.trim() || "",
          selectedProviderID: effectiveModelRef?.providerID ?? "",
          selectedModelID: effectiveModelRef?.modelID ?? "",
          models,
        }),
      )
      .catch(() => undefined);
  }, [allowedModelOptions, effectiveModelRef, modelLabel]);

  return { handleCreateTaskWithPrompt, handleOpenRecentSession };
}

// Re-export type for callers that only need the pending-map shape.
export type { PendingCreatedSessionMap };
