/**
 * Global quick-capture → session route:
 * - create session + seed composer + optional auto-send
 * - push model catalog into the desktop mini panel
 * - tray "continue last session"
 * - consume shell pending queue (settings page → navigate → mount)
 */
import {
  useCallback,
  useEffect,
  useRef,
  type Dispatch,
  type SetStateAction,
} from "react";

import { createClient, unwrap } from "../../../app/lib/opencode";
import { resolveWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import {
  clearSessionDraft,
  saveSessionDraft,
  setComposerDraftAfterNewTask,
  useComposerStateStore,
} from "../../domains/session";
import {
  readActiveWorkspaceId,
  readLastSessionFor,
  writeActiveWorkspaceId,
  writeLastSessionFor,
} from "../session-memory";
import {
  peekPendingQuickCapture,
  subscribePendingQuickCapture,
  takePendingQuickCapture,
} from "../quick-capture-pending";
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
        writeActiveWorkspaceId(workspaceId || null);
        writeLastSessionFor(workspaceId, session.id, pageMode);
        rememberPendingCreatedSession(workspaceId, session.id);
        setSessionsByWorkspaceId((current) =>
          insertSidebarSession({
            current,
            workspaceId,
            session,
            pageMode,
          }),
        );
        navigateToWorkspaceSession(workspaceId, session.id);

        // Prefer model chosen in the quick-capture panel; fall back to session default.
        const model =
          modelOverride?.providerID && modelOverride?.modelID
            ? modelOverride
            : effectiveModelRef;

        // Quick-capture should auto-send without leaving the capture text in the
        // composer. Prefill only when auto-send is impossible (no model / failed).
        const seedComposerForManualSend = () => {
          useComposerStateStore.getState().setDraft(session.id, text);
          saveSessionDraft(workspaceId, session.id, {
            text,
            mode: "prompt",
          });
          focusPromptSoon();
        };

        if (model?.providerID && model?.modelID) {
          // Ensure composer is empty while the turn streams in.
          useComposerStateStore.getState().setDraft(session.id, "");
          clearSessionDraft(workspaceId, session.id);
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
              // Re-clear in case surface remount rehydrated a draft.
              useComposerStateStore.getState().setDraft(session.id, "");
              clearSessionDraft(workspaceId, session.id);
            } catch (error) {
              console.warn(
                "[quick-capture] auto-send failed; draft left in composer",
                error,
              );
              seedComposerForManualSend();
            }
          })();
        } else {
          // No model yet — leave text in composer so the user can send after pick.
          seedComposerForManualSend();
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

  // Keep quick-capture model picker + theme in sync with the main app.
  useEffect(() => {
    if (!isDesktopRuntime()) return;

    const pushContext = () => {
      const models = (allowedModelOptions ?? [])
        .filter((option) => option?.providerID && option?.modelID)
        .slice(0, 80)
        .map((option) => ({
          providerID: option.providerID,
          modelID: option.modelID,
          title: option.title?.trim() || option.modelID,
          disabled: option.disabled === true,
        }));
      void Promise.all([
        import("../../../app/lib/desktop"),
        import("../../../app/theme"),
      ])
        .then(([{ desktopBridge }, themeApi]) =>
          desktopBridge.setQuickCaptureContext({
            modelLabel: modelLabel?.trim() || "",
            selectedProviderID: effectiveModelRef?.providerID ?? "",
            selectedModelID: effectiveModelRef?.modelID ?? "",
            theme: themeApi.getResolvedThemeMode(),
            models,
          }),
        )
        .catch(() => undefined);
    };

    pushContext();
    let unsubscribe = () => undefined;
    void import("../../../app/theme")
      .then((themeApi) => {
        unsubscribe = themeApi.subscribeToTheme(pushContext);
      })
      .catch(() => undefined);
    return () => unsubscribe();
  }, [allowedModelOptions, effectiveModelRef, modelLabel]);

  // Shell bridge enqueues while SessionRoute may be unmounted. Consume when we
  // have a workspace (do not wait on model readiness — draft/send handles that).
  const selectedWorkspaceIdRef = useRef(selectedWorkspaceId);
  selectedWorkspaceIdRef.current = selectedWorkspaceId;
  const createWithPromptRef = useRef(handleCreateTaskWithPrompt);
  createWithPromptRef.current = handleCreateTaskWithPrompt;

  useEffect(() => {
    const consume = () => {
      // Prefer live selection; fall back to last active workspace from memory.
      const workspaceId =
        selectedWorkspaceIdRef.current.trim() ||
        readActiveWorkspaceId()?.trim() ||
        "";
      if (!workspaceId) {
        // Keep pending until a workspace is available (bridge already navigated).
        if (peekPendingQuickCapture()) {
          console.info(
            "[quick-capture] pending submit waiting for workspace",
          );
        }
        return;
      }
      const pending = takePendingQuickCapture();
      if (!pending) return;
      console.info("[quick-capture] consuming pending submit", {
        workspaceId,
        textLength: pending.text.length,
        hasModel: Boolean(pending.model),
      });
      void createWithPromptRef.current(
        workspaceId,
        pending.text,
        pending.model ?? null,
      );
    };

    // Mount / workspace ready.
    consume();
    // Late enqueue while already on SessionRoute.
    return subscribePendingQuickCapture(consume);
  }, [selectedWorkspaceId]);

  return { handleCreateTaskWithPrompt, handleOpenRecentSession };
}

// Re-export type for callers that only need the pending-map shape.
export type { PendingCreatedSessionMap };
