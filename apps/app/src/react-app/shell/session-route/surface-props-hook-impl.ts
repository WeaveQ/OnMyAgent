/** Surface props (composer + session chat controls) for SessionPage. */
import {
  useMemo,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react";

import { pickDirectory } from "../../../app/lib/desktop";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { buildOnMyAgentEnvRuntimeKey } from "../../../app/lib/onmyagent-env-runtime";
import {
  listCommands,
  revertSession,
  shellInSession,
} from "../../../app/lib/opencode-session";
import { unwrap } from "../../../app/lib/opencode";
import type { ResolvedWorkspaceEndpoint } from "../../../app/lib/workspace-endpoint";
import type {
  Client,
  CollaborationGoalRuntime,
  CollaborationPlanRuntime,
  ComposerDraft,
  ComposerMentionTarget,
  ComposerPart,
  ModelRef,
  SidebarSessionItem,
  TodoItem,
} from "../../../app/types";
import { isSandboxWorkspace } from "../../../app/utils";
import { t, type Language } from "../../../i18n";
import type { LocalPreferences } from "../../kernel/local-provider";
import type { PageMode } from "../../domains/session";
import type { SessionPageSurfaceProps } from "../../domains/session";
import {
  addAssistantSession,
  addExpertSession,
  shouldApplyExpertSelection,
  writeAssistantSessionCategory,
} from "../../domains/agents";
import {
  readCustomAgentIdForSession,
  readSessionAgentSnapshot,
  writeCustomAgentIdForSession,
  writeSessionAgentSnapshot,
} from "../../domains/agents";
import { usePendingAgentStore } from "../../domains/agents";
import { writeSessionOriginBestEffort } from "../../domains/agents";
import {
  createIsolatedExpertSessionRuntimeDirectory,
  clearOptimisticSessionUserMessage,
  dispatchAssistantSessionWorkspacesChanged,
  isSameDirectory,
  readAssistantSessionWorkspace,
  seedOptimisticSessionUserMessage,
  shouldIsolateExpertSessionDirectory,
  trackWorkspaceSessionSync,
  writeAssistantSessionWorkspace,
} from "../../domains/session";
import { useSessionActivityStore } from "../../domains/session";
import {
  buildOnMyAgentEnvSystemContext,
  applyAutoCaptureMemory,
  extractMemoryCandidatesFromUserText,
  scheduleSyncMemoryAwarenessFiles,
  shouldAttemptMemoryExtract,
} from "../../domains/shared";
import { getReactQueryClient } from "../../infra/query-client";
import { buildOnboardingProfileSystemPrompt } from "../onboarding-profile";
import { resolveSessionExpertId } from "./resolve-session-expert-id";
import {
  buildCustomInstructionsSystemPrompt,
  buildResponseToneSystemPrompt,
} from "../../kernel/response-tone";
import {
  applySessionAccessMode,
  applySessionScopedValue,
  buildAccessModeSystemPrompt,
  buildCollaborationModeSystemPrompt,
  buildGoalRuntimeSystemPrompt,
  buildLanguageSystemPrompt,
  deriveGoalSummary,
  draftHasSendableContent,
  draftToParts,
  isComposerGoalMode,
  isComposerPlanningMode,
  joinSystemParts,
  moveSessionModelOverride,
  moveSessionScopedValue,
  removeSessionScopedValue,
  resolveAttachmentUploadTarget,
  resolveComposerRuntimeTools,
  resolveDraftSendPlan,
  resolveDraftText,
  routeForSettingsSection,
  type SettingsSection,
} from "./composer";
import { shouldForceNewSessionOnIdle } from "./auto-new-session";
import {
  bindPendingAgentToSession,
  registerCreatedSessionStartIntent,
  resolvePendingAgentForPrompt,
} from "./agent-context";
import {
  installMarketplaceExpertAfterSessionCreated,
  kickoffMarketplaceExpertInstall,
} from "./intent";
import { activateCreatedSessionRoute } from "./created-session-actions";
import {
  type RouteWorkspace,
  serializeSDKError,
} from "./model";
import {
  insertCreatedSessionForWorkspace,
  insertSidebarSession,
  sessionBelongsToAnotherWorkspace,
} from "./sessions";
import { writeStoredDefaultModel } from "../../kernel/model-config";
import { focusPromptSoon, todoQueryKeyForSession } from "./state";
import type { OnMyAgentServerInfo } from "../../../app/lib/desktop";
import {
  writeActiveWorkspaceId,
  writeLastSessionFor,
} from "../session-memory";
import type { NavigateFunction } from "react-router-dom";
import { updateDefaultModelPrefs } from "./composer";
import { bagSessionSurfaceProps } from "../../domains/session";

type NavigateToWorkspaceSession = (
  workspaceId: string,
  sessionId?: string | null,
  options?: { replace?: boolean },
) => void;

export type SessionRouteSurfacePropsInput = {
  assistantDraftWorkspaceRoot: string;
  client: OnMyAgentServerClient | null;
  compactModelPickerOpen: boolean;
  creatingSessionWorkspaceIdsRef: MutableRefObject<Set<string>>;
  effectiveModelRef: ModelRef | null | undefined;
  forceNewSessionOnNextSendRef: MutableRefObject<boolean>;
  handleOpenSettings: (route?: string, workspaceId?: string) => void;
  handleRuntimeSessionUpdated: (update: {
    sessionId: string;
    info: Record<string, unknown>;
  }) => void;
  handleRuntimeSessionStatus?: (update: {
    sessionId: string;
    status: unknown;
  }) => void;
  listSlashCommands: SessionPageSurfaceProps["listCommands"];
  local: {
    prefs: LocalPreferences;
    setPrefs: (updater: (previous: LocalPreferences) => LocalPreferences) => void;
  };
  localeSnapshot: Language;
  modelAvailabilityBlocksTask: boolean;
  modelBehaviorOptions: NonNullable<
    import("../../domains/session").SessionSurfaceModelBag["modelBehaviorOptions"]
  >;
  modelLabel: string;
  modelVariantLabel: string;
  modelVariantValue: string | null;
  navigate: NavigateFunction;
  navigateToWorkspaceSession: NavigateToWorkspaceSession;
  onmyagentServerHostInfoState: OnMyAgentServerInfo | null;
  opencodeBaseUrl: string;
  opencodeClient: Client | null;
  pageMode: PageMode;
  providerConnectedIds: string[];
  refreshCreatedSessionSnapshot: (sessionId: string, directory: string) => Promise<void>;
  refreshRouteState: () => Promise<void> | void;
  rememberPendingCreatedSession: (workspaceId: string, sessionId: string) => void;
  selectedAgent: string | null;
  selectedSessionId: string | null;
  selectedWorkspace: RouteWorkspace | null | undefined;
  selectedWorkspaceEndpoint: ResolvedWorkspaceEndpoint | null;
  selectedWorkspaceId: string;
  sessionAccessModeById: Record<string, NonNullable<ComposerDraft["accessMode"]>>;
  sessionCollaborationModeById: Record<string, ComposerDraft["collaborationMode"]>;
  sessionGoalRuntimeById: Record<string, CollaborationGoalRuntime>;
  sessionModelOverrideById: Record<string, ModelRef>;
  sessionPlanRuntimeById: Record<string, CollaborationPlanRuntime>;
  sessionWorkspaceRoot: string;
  sessionsByWorkspaceId: Record<string, SidebarSessionItem[]>;
  sessionsByWorkspaceIdRef: MutableRefObject<Record<string, SidebarSessionItem[]>>;
  setAssistantDraftWorkspaceRoot: Dispatch<SetStateAction<string>>;
  setCompactModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setLastVisibleTodosBySessionId: Dispatch<
    SetStateAction<Record<string, TodoItem[]>>
  >;
  setLegacySelectedWorkspaceId: Dispatch<SetStateAction<string>>;
  setModelPickerOpen: Dispatch<SetStateAction<boolean>>;
  setModelPickerQuery: Dispatch<SetStateAction<string>>;
  setSelectedAgent: Dispatch<SetStateAction<string | null>>;
  setSessionAccessModeById: Dispatch<
    SetStateAction<Record<string, NonNullable<ComposerDraft["accessMode"]>>>
  >;
  setSessionCollaborationModeById: Dispatch<
    SetStateAction<Record<string, ComposerDraft["collaborationMode"]>>
  >;
  setSessionGoalRuntimeById: Dispatch<
    SetStateAction<Record<string, CollaborationGoalRuntime>>
  >;
  setSessionModelOverrideById: Dispatch<SetStateAction<Record<string, ModelRef>>>;
  setSessionPlanRuntimeById: Dispatch<
    SetStateAction<Record<string, CollaborationPlanRuntime>>
  >;
  setSessionsByWorkspaceId: Dispatch<
    SetStateAction<Record<string, SidebarSessionItem[]>>
  >;
  suppressRestoreSessionRef: MutableRefObject<boolean>;
  token: string;
};

export function useSessionRouteSurfaceProps(
  input: SessionRouteSurfacePropsInput,
): SessionPageSurfaceProps | null {
  const {
    assistantDraftWorkspaceRoot,
    client,
    compactModelPickerOpen,
    creatingSessionWorkspaceIdsRef,
    effectiveModelRef,
    forceNewSessionOnNextSendRef,
    handleOpenSettings,
    handleRuntimeSessionUpdated,
    handleRuntimeSessionStatus,
    listSlashCommands,
    local,
    localeSnapshot,
    modelAvailabilityBlocksTask,
    modelBehaviorOptions,
    modelLabel,
    modelVariantLabel,
    modelVariantValue,
    navigate,
    navigateToWorkspaceSession,
    onmyagentServerHostInfoState,
    opencodeBaseUrl,
    opencodeClient,
    pageMode,
    providerConnectedIds,
    refreshCreatedSessionSnapshot,
    refreshRouteState,
    rememberPendingCreatedSession,
    selectedAgent,
    selectedSessionId,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionAccessModeById,
    sessionCollaborationModeById,
    sessionGoalRuntimeById,
    sessionModelOverrideById,
    sessionPlanRuntimeById,
    sessionWorkspaceRoot,
    sessionsByWorkspaceId,
    sessionsByWorkspaceIdRef,
    setAssistantDraftWorkspaceRoot,
    setCompactModelPickerOpen,
    setLastVisibleTodosBySessionId,
    setLegacySelectedWorkspaceId,
    setModelPickerOpen,
    setModelPickerQuery,
    setSelectedAgent,
    setSessionAccessModeById,
    setSessionCollaborationModeById,
    setSessionGoalRuntimeById,
    setSessionModelOverrideById,
    setSessionPlanRuntimeById,
    setSessionsByWorkspaceId,
    suppressRestoreSessionRef,
    token,
  } = input;

  return useMemo(() => {
    if (
      !client ||
      !selectedWorkspaceId ||
      !opencodeBaseUrl ||
      !token ||
      !opencodeClient
    ) {
      return null;
    }

    // Transient-safety: when the user switches workspaces the URL-driven
    // selectedSessionId may still point at a session from the old workspace
    // for one render tick. Only block rendering when we KNOW the session
    // belongs to a different workspace (i.e., it exists in another
    // workspace's list). A brand-new session that hasn't been refreshed
    // into any list yet must still render so "New task" feels instant.
    const sessionOwnedByOtherWorkspace = sessionBelongsToAnotherWorkspace({
      sessionsByWorkspaceId,
      selectedSessionId,
      selectedWorkspaceId,
    });
    if (sessionOwnedByOtherWorkspace) {
      return null;
    }

    const draftComposerModeSessionId = `draft:${selectedWorkspaceId}`;
    const composerModeSessionId = selectedSessionId ?? draftComposerModeSessionId;
    const sessionAccessMode =
      sessionAccessModeById[composerModeSessionId] ?? "default";
    const sessionCollaborationMode =
      sessionCollaborationModeById[composerModeSessionId];
    const draftOnlyRuntimeFallback = selectedSessionId ? null : draftComposerModeSessionId;
    const planRuntime =
      sessionPlanRuntimeById[composerModeSessionId] ??
      (draftOnlyRuntimeFallback
        ? sessionPlanRuntimeById[draftOnlyRuntimeFallback]
        : undefined) ??
      null;
    const storedGoalRuntime =
      sessionGoalRuntimeById[composerModeSessionId] ??
      (draftOnlyRuntimeFallback
        ? sessionGoalRuntimeById[draftOnlyRuntimeFallback]
        : undefined) ??
      null;
    const goalRuntime =
      storedGoalRuntime?.source === "goal_intent" ? storedGoalRuntime : null;

    // Note: do NOT include `client`, `workspaceId`, `sessionId`,
    // `opencodeBaseUrl`, or `onmyagentToken` here. SessionPage forwards those
    // explicitly to SessionSurface from the per-workspace endpoint resolved
    // by `resolveWorkspaceEndpoint`. If we leak them in here, the spread of
    // `surfaceProps` in SessionPage overrides those correct values with the
    // local server's, and remote workspaces silently end up calling the
    // local server with the local `rem_*` id.
    const catalogWorkspaceRoot =
      selectedWorkspace?.path?.trim() || sessionWorkspaceRoot;
    const flatSurfaceProps = {
      workspaceRoot: sessionWorkspaceRoot,
      // Product Files / @ Mine use the catalog workspace, not expert session cwd.
      filesWorkspaceRoot: catalogWorkspaceRoot,
      connectedProviderIds: providerConnectedIds,
      developerMode: false,
      modelLabel,
      onModelClick: () => {
        setModelPickerQuery("");
        setModelPickerOpen(true);
      },
      modelPickerOpen: compactModelPickerOpen,
      modelUnavailable: modelAvailabilityBlocksTask,
      selectedModel: effectiveModelRef ?? { providerID: "", modelID: "" },
      sessionAccessMode,
      onSessionAccessModeChange: (mode: ComposerDraft["accessMode"]) => {
        setSessionAccessModeById((current) =>
          applySessionAccessMode(current, composerModeSessionId, mode),
        );
      },
      sessionCollaborationMode,
      onSessionCollaborationModeChange: (
        mode: ComposerDraft["collaborationMode"],
      ) => {
        setSessionCollaborationModeById((current) =>
          applySessionScopedValue(current, composerModeSessionId, mode),
        );
      },
      planRuntime,
      onPlanRuntimeChange: (runtime: CollaborationPlanRuntime | null) => {
        setSessionPlanRuntimeById((current) =>
          applySessionScopedValue(current, composerModeSessionId, runtime),
        );
      },
      goalRuntime,
      onGoalRuntimeChange: (runtime: CollaborationGoalRuntime | null) => {
        setSessionGoalRuntimeById((current) =>
          applySessionScopedValue(current, composerModeSessionId, runtime),
        );
      },
      onClearSessionProgress: () => {
        setLastVisibleTodosBySessionId((current) =>
          removeSessionScopedValue(current, composerModeSessionId),
        );
        if (selectedSessionId) {
          const currentTodoQueryKey = todoQueryKeyForSession(
            selectedWorkspaceId,
            selectedSessionId,
          );
          if (currentTodoQueryKey) {
            getReactQueryClient().setQueryData<TodoItem[]>(
              currentTodoQueryKey,
              [],
            );
          }
        }
        setSessionPlanRuntimeById((current) =>
          removeSessionScopedValue(current, composerModeSessionId),
        );
        setSessionGoalRuntimeById((current) =>
          removeSessionScopedValue(current, composerModeSessionId),
        );
      },
      onModelPickerOpenChange: setCompactModelPickerOpen,
      onModelChange: (model: ModelRef) => {
        // 1) Pin model for the current session/draft (existing sessions stay put).
        // 2) Remember as global default so new-task / new-session homes pick it next.
        setSessionModelOverrideById((current) => ({
          ...current,
          [composerModeSessionId]: model,
        }));
        local.setPrefs((previous) => updateDefaultModelPrefs(previous, model));
        writeStoredDefaultModel(model);
        setCompactModelPickerOpen(false);
      },
      onOpenSettingsSection: (section: SettingsSection) => {
        handleOpenSettings(routeForSettingsSection(section));
      },
      onSendDraft: async (draft: ComposerDraft) => {
        const text = resolveDraftText(draft);
        if (!draftHasSendableContent(draft)) return;
        if (modelAvailabilityBlocksTask)
          throw new Error(t("session.model_unavailable_send_blocked"));
        const planningMode = isComposerPlanningMode(draft.collaborationMode);

        // Honor the "click +新会话 then send" flow: if the user activated
        // draft mode in `SessionPage`, `forceNewSessionOnNextSendRef` is
        // true — always create a new session even when a real session is
        // currently selected. Also auto-new when idle past the prefs threshold.
        const selectedActivityStatus = selectedSessionId
          ? useSessionActivityStore
              .getState()
              .getStatus(selectedWorkspaceId, selectedSessionId)
          : "idle";
        const selectedSessionBusy =
          selectedActivityStatus === "thinking" ||
          selectedActivityStatus === "responding" ||
          selectedActivityStatus === "retrying" ||
          selectedActivityStatus === "waiting" ||
          selectedActivityStatus === "compacting";
        const idleForceNew = shouldForceNewSessionOnIdle({
          enabled: local.prefs.autoNewSessionOnIdle === true,
          idleHours: local.prefs.autoNewSessionIdleHours,
          selectedSessionId,
          sessions: sessionsByWorkspaceId[selectedWorkspaceId] ?? [],
          sessionBusy: selectedSessionBusy,
        });
        // Force-new / first send from a space-bound chat must keep the folder
        // binding, or the new session lands in Tasks and steals selection.
        const inheritAssistantWorkspaceDirectory =
          pageMode === "assistant" && selectedSessionId
            ? readAssistantSessionWorkspace(selectedSessionId)?.directory ??
              null
            : null;
        const sendPlan = resolveDraftSendPlan({
          selectedSessionId,
          forceNewSession:
            forceNewSessionOnNextSendRef.current || idleForceNew,
          pageMode,
          assistantDraftWorkspaceRoot,
          sessionWorkspaceRoot,
          inheritAssistantWorkspaceDirectory,
        });
        forceNewSessionOnNextSendRef.current = false;
        let { explicitAssistantWorkspace, taskWorkspaceRoot } = sendPlan;

        // Expert new-session: force taskWorkspaceRoot to the workspace root.
        // sessionWorkspaceRoot may still point at the previous expert's session
        // directory (URL navigate is async), which would cause shouldIsolate to
        // return false and reuse the wrong expert's directory (directory cross-
        // contamination). The user-picked folder (explicitAssistantWorkspace)
        // is preserved and takes precedence.
        if (pageMode === "expert" && sendPlan.needsNewSession && !explicitAssistantWorkspace.trim()) {
          taskWorkspaceRoot = selectedWorkspace?.path?.trim() || taskWorkspaceRoot;
        }

        // Expert sessions without a user-picked folder get an isolated directory
        // under the server runtime-state root, never inside the selected project.
        // Draft/folder equal to the workspace root still isolates so the files
        // panel does not scan or write runtime markers into the project tree.
        const workspaceRootForSession = selectedWorkspace?.path?.trim() || "";
        const ensureClient = selectedWorkspaceEndpoint?.client ?? client;
        const ensureWorkspaceId =
          selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspaceId;

        // Overlap marketplace package install with isolate-dir + session.create.
        // Summon already kickoffs install; coordinator makes this a no-op / join.
        const pendingForColdPath = usePendingAgentStore.getState().getAgent();
        const marketplaceInstallPromise = kickoffMarketplaceExpertInstall(
          pendingForColdPath,
        );

        if (pageMode === "expert" && sendPlan.needsNewSession) {
          const explicitFolder = explicitAssistantWorkspace.trim();
          const isolate = shouldIsolateExpertSessionDirectory(
            workspaceRootForSession,
            explicitFolder || taskWorkspaceRoot,
          );
          if (isolate && workspaceRootForSession) {
            const pendingForDir = pendingForColdPath;
            // New session: use the pending agent name + id. Never fall back to
            // the previously selected session's agent snapshot - that belongs
            // to a different expert and would create artifacts in the wrong dir.
            const agentName = pendingForDir?.name?.trim() || "expert";
            const agentId = pendingForDir?.id?.trim() || "";
            const isolated = await createIsolatedExpertSessionRuntimeDirectory({
              client: ensureClient,
              workspaceId: ensureWorkspaceId,
              workspaceRoot: workspaceRootForSession,
              agentName,
              agentId,
            });
            // Only bind the external runtime path when the server created it.
            // Otherwise opencode FileSystem.realPath throws ENOENT and the turn dies.
            if (isolated) {
              taskWorkspaceRoot = isolated.directory;
              explicitAssistantWorkspace = isolated.directory;
            } else {
              throw new Error("Unable to allocate an external expert session directory");
            }
          } else if (explicitFolder) {
            // User-picked folder (not workspace root): bind side panel to that path.
            explicitAssistantWorkspace = explicitFolder;
            taskWorkspaceRoot = explicitFolder;
          }
        }

        let skillCommandPrompt: {
          systemPrompt: string;
          visiblePrompt: string;
        } | null = null;
        if (draft.command) {
          const command = draft.command;
          const commandSource =
            command.source ??
            (await listCommands(opencodeClient, taskWorkspaceRoot || undefined))
              .find((item) => item.name === command.name)?.source;
          const isSkillCommand =
            commandSource === "skill" || command.name === "expert-manager";
          if (isSkillCommand) {
            const skillClient = selectedWorkspaceEndpoint?.client ?? client;
            const skillWorkspaceId =
              selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspaceId;
            const skill = await skillClient.getSkill(skillWorkspaceId, command.name, {
              includeGlobal: true,
            });
            const skillArguments = command.arguments.trim();
            skillCommandPrompt = {
              systemPrompt: [
                `The user invoked the /${command.name} skill. Read and follow this SKILL.md content for this turn.`,
                "The user-facing prompt may start with a [[skill:name]] marker; treat it as UI metadata and focus on the arguments after it.",
                "",
                "```markdown",
                skill.content,
                "```",
              ].join("\n"),
              visiblePrompt: `[[skill:${command.name}]] ${skillArguments || command.name}`.trim(),
            };
          }
        }

        let sessionId = sendPlan.initialSessionId;
        let createdSession: { id: string; directory?: string } | null = null;
        if (!sessionId) {
          if (creatingSessionWorkspaceIdsRef.current.has(selectedWorkspaceId))
            return;
          creatingSessionWorkspaceIdsRef.current.add(selectedWorkspaceId);
          try {
            createdSession = unwrap(
              await opencodeClient.session.create({
                directory: taskWorkspaceRoot || undefined,
              }),
            );
            sessionId = createdSession.id;
            createdSession.directory = taskWorkspaceRoot;
            if (explicitAssistantWorkspace) {
              writeAssistantSessionWorkspace({
                sessionId,
                ownerWorkspaceId: selectedWorkspaceId,
                directory: explicitAssistantWorkspace,
              });
              dispatchAssistantSessionWorkspacesChanged(selectedWorkspaceId);
            }
            const activityStore = useSessionActivityStore.getState();
            activityStore.startRun(selectedWorkspaceId, sessionId);
            const runtimeWorkspaceId = selectedWorkspaceEndpoint?.workspaceId;
            if (runtimeWorkspaceId && runtimeWorkspaceId !== selectedWorkspaceId) {
              activityStore.startRun(runtimeWorkspaceId, sessionId);
            }
          } finally {
            creatingSessionWorkspaceIdsRef.current.delete(selectedWorkspaceId);
          }
          if (sessionId) {
            registerCreatedSessionStartIntent({
              sessionId,
              intent: draft.sessionStartIntent,
              pageMode,
              addAssistantSession,
              addExpertSession,
              writeAssistantSessionCategory,
            });
          }
        }
        if (!sessionId) return;
        // Stable id for optimistic user bubble + promptAsync messageID so the
        // transcript never flashes empty between create and the real SSE turn.
        let optimisticMessageId: string | null =
          createdSession && !draft.messageID
            ? `msg_${crypto.randomUUID()}`
            : null;
        if (createdSession) {
          // ExpertPage keeps its draft surface mounted until the created
          // session is bound to the intended expert. Bind before navigating:
          // navigating first briefly renders the real route with draft state,
          // which looks like new chat → home → new chat and also lets fallback
          // selection effects choose another expert/session.
          if (pageMode === "expert") {
            const { pendingAgentSnapshot } = resolvePendingAgentForPrompt({
              currentAgent: usePendingAgentStore.getState().getAgent(),
              createdSession: true,
              sessionId,
              inheritFromSessionId: selectedSessionId,
            });
            if (pendingAgentSnapshot) {
              usePendingAgentStore.getState().setAgent(
                bindPendingAgentToSession({
                  agent: pendingAgentSnapshot,
                  sessionId,
                }),
              );
              writeCustomAgentIdForSession(
                sessionId,
                pendingAgentSnapshot.id,
              );
              writeSessionAgentSnapshot(sessionId, pendingAgentSnapshot);
            }
          }
          // Seed the user turn into the new session transcript *before* route
          // navigation / marketplace install so the surface never lands on a
          // blank "准备中" page after the draft → real session hop.
          if (optimisticMessageId && text) {
            seedOptimisticSessionUserMessage({
              workspaceId:
                selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspaceId,
              sessionId,
              messageId: optimisticMessageId,
              text,
              createdAt: Date.now(),
            });
          }
          setSessionsByWorkspaceId((current) => {
            const next = insertCreatedSessionForWorkspace({
              current,
              createdSession,
              workspaceId: selectedWorkspaceId,
            });
            sessionsByWorkspaceIdRef.current = next;
            return next;
          });
          writeSessionOriginBestEffort({
            client: selectedWorkspaceEndpoint?.client ?? client,
            workspaceId: selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspaceId,
            sessionId,
            kind: pageMode === "expert" ? "expert" : "assistant",
            agentId:
              pageMode === "expert"
                ? readCustomAgentIdForSession(sessionId)
                : undefined,
            directory: createdSession.directory ?? explicitAssistantWorkspace,
          });
          activateCreatedSessionRoute({
            selectedWorkspaceId,
            sessionId,
            setLegacySelectedWorkspaceId,
            writeActiveWorkspaceId,
            writeLastSessionFor,
            pageMode,
            rememberPendingCreatedSession,
            suppressRestoreSessionRef,
            navigateToWorkspaceSession,
            setAssistantDraftWorkspaceRoot,
            focusPromptSoon,
          });
        }
        setSessionAccessModeById((current) =>
          createdSession
            ? moveSessionScopedValue(
                current,
                composerModeSessionId,
                sessionId,
                draft.accessMode ?? "default",
              )
            : applySessionAccessMode(current, sessionId, draft.accessMode),
        );
        setSessionCollaborationModeById((current) =>
          createdSession
            ? moveSessionScopedValue(
                current,
                composerModeSessionId,
                sessionId,
                draft.collaborationMode,
              )
            : applySessionScopedValue(current, sessionId, draft.collaborationMode),
        );
        if (createdSession) {
          // Move draft override onto the new session, then pin the model actually
          // used for this send so later default-model changes do not rewrite it.
          const pinnedModel =
            sessionModelOverrideById[composerModeSessionId] ??
            usePendingAgentStore.getState().getAgent()?.model ??
            local.prefs.defaultModel ??
            null;
          setSessionModelOverrideById((current) => {
            const moved = moveSessionModelOverride(
              current,
              composerModeSessionId,
              sessionId,
            );
            if (!pinnedModel) return moved;
            return { ...moved, [sessionId]: pinnedModel };
          });
        }
        const planningIntent = draft.planningIntent;
        if (planningIntent) {
          setSessionPlanRuntimeById((current) => {
            const next = { ...current };
            delete next[composerModeSessionId];
            next[sessionId] = {
              status: "drafting",
              originalPrompt: planningIntent.originalPrompt,
              messageBaseline: planningIntent.messageBaseline,
              createdAt: Date.now(),
            };
            return next;
          });
        }
        const goalIntent = draft.goalIntent;
        if (goalIntent) {
          const now = Date.now();
          setSessionGoalRuntimeById((current) => {
            const next = { ...current };
            delete next[composerModeSessionId];
            next[sessionId] = {
              source: "goal_intent",
              status: "running",
              waitingReason: undefined,
              objective: goalIntent.objective,
              summary: deriveGoalSummary(goalIntent.objective),
              messageBaseline: goalIntent.messageBaseline,
              lastRunMessageBaseline: goalIntent.messageBaseline,
              startedAt: now,
              updatedAt: now,
              totalPausedMs: 0,
              lastRunStartedAt: now,
            };
            return next;
          });
        } else if (isComposerGoalMode(draft.collaborationMode)) {
          const existingGoal =
            sessionGoalRuntimeById[composerModeSessionId] ??
            sessionGoalRuntimeById[sessionId];
          if (existingGoal?.source === "goal_intent") {
            const now = Date.now();
            setSessionGoalRuntimeById((current) => {
              const currentGoal =
                current[composerModeSessionId] ??
                current[sessionId] ??
                existingGoal;
              const next = { ...current };
              delete next[composerModeSessionId];
              next[sessionId] = {
                ...currentGoal,
                summary:
                  currentGoal.summary || deriveGoalSummary(currentGoal.objective),
                status: "running",
                waitingReason: undefined,
                updatedAt: now,
                lastRunStartedAt: now,
                completedAt: undefined,
              };
              return next;
            });
          }
        }

        const runWithCreatedSessionRuntimeSync = async <T,>(
          action: () => Promise<T>,
        ) => {
          const release =
            createdSession && selectedWorkspaceEndpoint
              ? trackWorkspaceSessionSync(
                  {
                    workspaceId: selectedWorkspaceEndpoint.workspaceId,
                    baseUrl: selectedWorkspaceEndpoint.opencodeBaseUrl,
                    directory: taskWorkspaceRoot,
                    onmyagentToken: selectedWorkspaceEndpoint.token,
                    onSessionUpdated: handleRuntimeSessionUpdated,
                    onSessionStatus: handleRuntimeSessionStatus,
                  },
                  sessionId,
                )
              : null;
          try {
            return await action();
          } finally {
            release?.();
          }
        };

        if (draft.mode === "shell") {
          if (planningMode) {
            throw new Error(
              "Plan mode cannot run shell commands. Send a normal prompt to draft the plan first.",
            );
          }
          await runWithCreatedSessionRuntimeSync(async () => {
            await shellInSession(opencodeClient, sessionId, text, {
              directory: taskWorkspaceRoot || undefined,
            });
          });
          if (createdSession) {
            await refreshCreatedSessionSnapshot(sessionId, taskWorkspaceRoot);
          }
          return;
        }

        if (draft.command && !skillCommandPrompt) {
          if (planningMode) {
            throw new Error(
              "Plan mode cannot run slash commands directly. Send a normal prompt to draft the plan first.",
            );
          }
          const command = draft.command;
          const result = await runWithCreatedSessionRuntimeSync(() =>
            opencodeClient.session.command({
              sessionID: sessionId,
              command: command.name,
              arguments: command.arguments,
              directory: taskWorkspaceRoot || undefined,
            }),
          );
          if (result.error) {
            throw new Error(serializeSDKError(result.error));
          }
          if (createdSession) {
            await refreshCreatedSessionSnapshot(sessionId, taskWorkspaceRoot);
          }
          return;
        }

        const promptDraft: ComposerDraft = skillCommandPrompt
          ? {
              ...draft,
              command: undefined,
              text: skillCommandPrompt.visiblePrompt,
              resolvedText: skillCommandPrompt.visiblePrompt,
              parts: [
                { type: "text", text: skillCommandPrompt.visiblePrompt },
                ...draft.parts.filter(
                  (part): part is Extract<ComposerPart, { type: "agent" | "file" | "directory" }> =>
                    part.type === "agent" || part.type === "file" || part.type === "directory",
                ),
              ],
            }
          : draft;

        const attachmentUploadTarget = resolveAttachmentUploadTarget({
          fallbackClient: client,
          fallbackWorkspaceId: selectedWorkspaceId,
          workspaceClient: selectedWorkspaceEndpoint?.client,
          workspaceId: selectedWorkspaceEndpoint?.workspaceId,
        });

        const parts = await draftToParts(promptDraft, taskWorkspaceRoot, {
          uploadAttachment:
            attachmentUploadTarget
              ? async (attachment, uploadPath) => {
                  const { uploadUserFileToWorkspace } = await import(
                    "../../domains/workspace"
                  );
                  return uploadUserFileToWorkspace(
                    attachmentUploadTarget.client,
                    attachmentUploadTarget.workspaceId,
                    attachment.file,
                    { path: uploadPath },
                  );
                }
              : undefined,
          // User files land under uploads/ on the catalog workspace; expert task
          // cwd may be an isolated session subdir — do not nest under that cwd.
          inboxWorkspaceRoot:
            workspaceRootForSession || taskWorkspaceRoot || undefined,
        });
        const envRuntimeKey = buildOnMyAgentEnvRuntimeKey({
          baseUrl: client?.baseUrl ?? null,
          pid: onmyagentServerHostInfoState?.pid ?? null,
          port: onmyagentServerHostInfoState?.port ?? null,
        });
        // When the session was started from an agent card, the pending
        // agent store carries a system prompt (persona, tone, constraints).
        // Merge it with the env context so both reach the model in one
        // `system` field. Only applied on the first prompt for a new session
        // — the store is kept intact for subsequent turns so the transcript
        // still renders the agent avatar next to assistant messages.
        // When force-new / idle auto-new, selectedSessionId is still the
        // previous chat — inherit its expert binding if pending store is empty.
        const inheritFromSessionId = createdSession
          ? selectedSessionId
          : null;
        const { pendingAgentSnapshot, agentToolAccess } =
          resolvePendingAgentForPrompt({
            currentAgent: usePendingAgentStore.getState().getAgent(),
            createdSession: Boolean(createdSession),
            sessionId,
            inheritFromSessionId,
          });
        const runtimeToolAccess = resolveComposerRuntimeTools(
          agentToolAccess,
          draft.collaborationMode,
        );
        // Bind the pending agent to the session we just created so the
        // avatar/system prompt don't bleed into unrelated sessions the
        // user may navigate to later.
        if (pendingAgentSnapshot && sessionId) {
          usePendingAgentStore.getState().setAgent(
            bindPendingAgentToSession({
              agent: pendingAgentSnapshot,
              sessionId,
            }),
          );
          // Persist the custom agent ID so we can restore the agent's avatar
          // and name when the user re-opens this session later.
          writeCustomAgentIdForSession(sessionId, pendingAgentSnapshot.id);
          writeSessionAgentSnapshot(sessionId, pendingAgentSnapshot);
        }
        // Join marketplace install with env context prep — install was kicked
        // off before isolate/create so this usually has little/no remaining wait.
        // Coordinator dedupes when the resolved agent matches the early kickoff.
        const installBeforePrompt = pendingAgentSnapshot
          ? installMarketplaceExpertAfterSessionCreated(pendingAgentSnapshot)
          : marketplaceInstallPromise;
        const [envSystemContext] = await Promise.all([
          buildOnMyAgentEnvSystemContext(client, {
            cacheKey: sessionId,
            runtimeKey: envRuntimeKey,
          }),
          installBeforePrompt,
        ]);
        const selectedPromptModel =
          sessionModelOverrideById[composerModeSessionId] ??
          pendingAgentSnapshot?.model ??
          local.prefs.defaultModel ??
          undefined;
        const storedRuntimeForGoalPrompt =
          sessionGoalRuntimeById[composerModeSessionId] ??
          sessionGoalRuntimeById[sessionId];
        const runtimeForGoalPrompt =
          storedRuntimeForGoalPrompt?.source === "goal_intent"
            ? storedRuntimeForGoalPrompt
            : undefined;
        const currentPendingAgent = usePendingAgentStore.getState().getAgent();
        const storedSessionAgentId =
          readCustomAgentIdForSession(sessionId) ||
          readSessionAgentSnapshot(sessionId)?.id ||
          null;
        const boundExpertId = resolveSessionExpertId({
          sessionId,
          pendingAgentId: pendingAgentSnapshot?.id ?? null,
          currentAgentId: currentPendingAgent?.id ?? null,
          currentAgentBoundSessionId:
            currentPendingAgent?.boundSessionId ?? null,
          sessionAgentId: storedSessionAgentId,
        });
        const combinedSystem = joinSystemParts([
          envSystemContext,
          skillCommandPrompt?.systemPrompt,
          buildOnboardingProfileSystemPrompt(
            local.prefs.onboardingProfile,
            local.prefs.conversationMemory,
            { expertId: boundExpertId },
          ) ||
            undefined,
          buildResponseToneSystemPrompt(local.prefs.responseTone) || undefined,
          buildCustomInstructionsSystemPrompt(local.prefs.customInstructions) ||
            undefined,
          pendingAgentSnapshot?.systemPrompt || undefined,
          buildCollaborationModeSystemPrompt(draft.collaborationMode) ||
            undefined,
          buildGoalRuntimeSystemPrompt(
            draft.goalIntent
              ? { objective: draft.goalIntent.objective }
              : runtimeForGoalPrompt,
          ) || undefined,
          buildAccessModeSystemPrompt(draft.accessMode) || undefined,
          draft.hiddenSystemPrompt,
          buildLanguageSystemPrompt(localeSnapshot),
        ]);
        const runtimeMessageId = draft.messageID ?? optimisticMessageId;
        const runtimeWorkspaceId =
          selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspaceId;
        const userTurnText = resolveDraftText(promptDraft);
        // Refresh seed text if skill rewrite changed the visible prompt; same
        // messageId keeps addOptimistic idempotent on id.
        if (optimisticMessageId && userTurnText && userTurnText !== text) {
          seedOptimisticSessionUserMessage({
            workspaceId: runtimeWorkspaceId,
            sessionId,
            messageId: optimisticMessageId,
            text: userTurnText,
            createdAt: Date.now(),
          });
        }
        try {
          const result = await runWithCreatedSessionRuntimeSync(() =>
            opencodeClient.session.promptAsync({
              sessionID: sessionId,
              parts,
              ...(runtimeMessageId ? { messageID: runtimeMessageId } : {}),
              // Priority: user's manual override > agent's configured model > global default.
              // Never modify `pendingAgentSnapshot.model` — the agent's configured model
              // is owned by the agent page edit dialog.
              model: selectedPromptModel,
              agent: selectedAgent ?? undefined,
              ...(modelVariantValue ? { variant: modelVariantValue } : {}),
              ...(runtimeToolAccess ? { tools: runtimeToolAccess } : {}),
              ...(combinedSystem ? { system: combinedSystem } : {}),
              directory: taskWorkspaceRoot || undefined,
            }),
          );
          if (result.error) {
            throw new Error(serializeSDKError(result.error));
          }
        } catch (error) {
          if (optimisticMessageId && userTurnText) {
            clearOptimisticSessionUserMessage({
              workspaceId: runtimeWorkspaceId,
              sessionId,
              messageId: optimisticMessageId,
            });
          }
          throw error;
        }
        // Work memory auto-capture: only when enabled + autoCapture.
        // Writes long-term items + short-term notes (no silent path when auto off).
        const memoryState = local.prefs.conversationMemory;
        if (
          memoryState?.enabled &&
          memoryState.autoCapture &&
          userTurnText &&
          shouldAttemptMemoryExtract(userTurnText)
        ) {
          const candidates = extractMemoryCandidatesFromUserText(userTurnText, {
            sessionId,
            expertId: boundExpertId ?? undefined,
          });
          if (candidates.length > 0) {
            const nextMemory = applyAutoCaptureMemory(
              local.prefs.conversationMemory,
              candidates,
            );
            local.setPrefs((previous) => ({
              ...previous,
              conversationMemory: nextMemory,
            }));
            scheduleSyncMemoryAwarenessFiles(nextMemory);
          }
        }
        if (createdSession) {
          await refreshCreatedSessionSnapshot(sessionId, taskWorkspaceRoot);
        }
      },
      onDraftChange: () => {
        // Draft persistence will be wired once the full React shell owns session state.
      },
      attachmentsEnabled: true,
      attachmentsDisabledReason: null,
      modelVariantLabel,
      modelVariant: modelVariantValue,
      modelBehaviorOptions,
      onModelVariantChange: (value: string | null) => {
        local.setPrefs((previous) => ({ ...previous, modelVariant: value }));
      },
      agentLabel: selectedAgent
        ? selectedAgent.charAt(0).toUpperCase() + selectedAgent.slice(1)
        : t("session.default_agent"),
      selectedAgent,
      listAgents: async () => {
        const list = unwrap(await opencodeClient.app.agents());
        return list.filter(
          (agent) => !agent.hidden && agent.mode !== "subagent",
        );
      },
      onSelectAgent: (agent: string | null) => {
        const next = agent?.trim() ? agent.trim() : null;
        if (
          next &&
          !shouldApplyExpertSelection({
            nextExpertId: next,
            selectedExpertId: selectedAgent,
          })
        ) {
          return;
        }
        setSelectedAgent(next);
      },
      listCommands: listSlashCommands,
      recentFiles: [],
      searchFiles: async (query: string) => {
        const trimmed = query.trim();
        if (!trimmed) return [];
        const result = unwrap(
          await opencodeClient.find.files({
            query: trimmed,
            dirs: "true",
            limit: 50,
            directory: sessionWorkspaceRoot || undefined,
          }),
        );
        return result.map((path): ComposerMentionTarget => ({ path, kind: "file" }));
      },
      isRemoteWorkspace: selectedWorkspace?.workspaceType === "remote",
      isSandboxWorkspace: selectedWorkspace
        ? isSandboxWorkspace(selectedWorkspace)
        : false,
      onRevertToMessage: (messageId: string) => {
        void (async () => {
          if (!selectedSessionId) return;
          try {
            // Abort any running generation first, like the actions-store does
            try {
              await opencodeClient.session.abort({
                sessionID: selectedSessionId,
              });
            } catch {
              /* ok if not running */
            }
            await revertSession(opencodeClient, selectedSessionId, messageId);
            // Force a full reload of the session to pick up reverted state
            navigateToWorkspaceSession(selectedWorkspaceId, selectedSessionId);
            void refreshRouteState();
          } catch (error) {
            console.warn("[revert] failed", error);
          }
        })();
      },
      onChangeModel: (model: { providerID: string; modelID: string }) => {
        setSessionModelOverrideById((current) => ({
          ...current,
          [composerModeSessionId]: model,
        }));
        local.setPrefs((previous) => updateDefaultModelPrefs(previous, model));
        writeStoredDefaultModel(model);
      },
      draftWorkspaceDirectory:
        pageMode === "assistant" || pageMode === "expert"
          ? assistantDraftWorkspaceRoot
          : null,
      draftWorkspaceOwnerId:
        pageMode === "assistant" || pageMode === "expert"
          ? selectedWorkspaceId
          : null,
      onSelectDraftWorkspace:
        pageMode === "assistant" || pageMode === "expert"
          ? (path: string) => {
              const next = path.trim();
              if (next) setAssistantDraftWorkspaceRoot(next);
            }
          : undefined,
      onCreateDraftWorkspace:
        pageMode === "assistant" || pageMode === "expert"
          ? async (name: string) => {
              const folderName = name.trim();
              if (!folderName) {
                throw new Error(t("session.workspace_create_name_required"));
              }
              const parentPath = (selectedWorkspace?.path ?? sessionWorkspaceRoot ?? "").trim();
              const workspaceClient = selectedWorkspaceEndpoint?.client ?? client;
              const workspaceId =
                selectedWorkspaceEndpoint?.workspaceId ?? selectedWorkspaceId;
              if (!parentPath || !workspaceClient || !workspaceId?.trim()) {
                throw new Error(t("session.workspace_create_no_parent"));
              }
              // Create a subfolder under the active app workspace by writing an
              // allowed text file (server mkdir via ensureDir on parent). Dotfiles
              // like `.onmyagent-space` are rejected ("Only supported text
              // artifact files can be edited inline").
              const markerPath = `${folderName}/README.md`;
              await workspaceClient.writeWorkspaceFile(workspaceId, {
                path: markerPath,
                content: `# ${folderName}\n`,
                force: true,
              });
              const base = parentPath.replace(/[\\/]+$/, "");
              const sep = parentPath.includes("\\") ? "\\" : "/";
              return `${base}${sep}${folderName}`;
            }
          : undefined,
      onPickDraftWorkspace:
        pageMode === "assistant" || pageMode === "expert"
          ? () => {
              void pickDirectory({ title: t("session.choose_workspace") }).then((directory) => {
                if (typeof directory === "string" && directory.trim()) {
                  setAssistantDraftWorkspaceRoot(directory.trim());
                }
              });
            }
          : undefined,
      onClearDraftWorkspace:
        pageMode === "assistant" || pageMode === "expert"
          ? () => setAssistantDraftWorkspaceRoot("")
          : undefined,
      onOpenShortcutsSettings: () => {
        handleOpenSettings("/settings/shortcuts");
      },
    };
    return bagSessionSurfaceProps(flatSurfaceProps);
  }, [
    client,
    assistantDraftWorkspaceRoot,
    compactModelPickerOpen,
    effectiveModelRef,
    handleRuntimeSessionUpdated,
    handleRuntimeSessionStatus,
    handleOpenSettings,
    local,
    listSlashCommands,
    modelAvailabilityBlocksTask,
    modelBehaviorOptions,
    modelLabel,
    modelVariantLabel,
    modelVariantValue,
    navigate,
    opencodeBaseUrl,
    opencodeClient,
    pageMode,
    providerConnectedIds,
    refreshCreatedSessionSnapshot,
    selectedAgent,
    selectedSessionId,
    selectedWorkspace,
    selectedWorkspaceEndpoint,
    selectedWorkspaceId,
    sessionAccessModeById,
    sessionCollaborationModeById,
    sessionGoalRuntimeById,
    sessionModelOverrideById,
    sessionPlanRuntimeById,
    sessionWorkspaceRoot,
    sessionsByWorkspaceId,
    token,
  ]);
}
