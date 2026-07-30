/**
 * Shared host state for Expert/Assistant session pages:
 * rail location, keep-alive visited set, archive resume, side panel /
 * openTargets, history search chrome, browser panel open/close targets.
 *
 * Mode-specific conversation models and surfaces stay in the page hosts.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePanelRef } from "react-resizable-panels";

import { t } from "../../../../i18n";
import type { OpenTarget } from "../artifacts/open-target";
import { openInAppBrowser } from "../browser/open-in-app-browser";
import { useAutoOpenBrowserPanel } from "../browser/use-auto-open-browser-panel";
import {
  type OnMyAgentControlAction,
  useControlAction,
  useWorkspaceShellLayout,
} from "../../../shell";
import { useComposerStateStore } from "../surface/composer-state-store";
import { useVisitedRailViews } from "../sidebar/keep-alive-pane";
import { isPrimarySessionRailView } from "../sidebar/rail-navigation-memory";
import type { SessionArchiveResumeRequest } from "../chat/session-page-session-archive-page";
import { useRailLocation } from "./use-rail-location";
import { useSessionHostSidePanel } from "./use-session-host-side-panel";
import type { ShellMode } from "../sidebar/rail-navigation-memory";

export type SessionPageHostStateOptions = {
  mode: ShellMode;
  selectedWorkspaceId: string;
  selectedSessionId: string | null | undefined;
  selectedWorkspaceRoot: string;
  workspaces: ReadonlyArray<{ id: string; path?: string | null }>;
  draftWorkspaceDirectory?: string | null;
  onAccessibleTargetsChange?: (targets: OpenTarget[]) => void;
  /** Views that enable Cmd/Ctrl+F header history search. */
  historySearchViews: readonly string[];
  sidePanelDefaultWidth: number;
  sidePanelMinWidth: number;
  /**
   * Optional override for side-panel scope (e.g. expert draft session id).
   * When omitted: localAgent uses workspace key; assistant uses session/draft;
   * expert uses selectedSessionId.
   */
  sidePanelScopeId?: string | null;
  /** Composer session id for history "fill draft" (expert draft may differ). */
  historyComposerSessionId?: string | null;
};

export function useSessionPageHostState(options: SessionPageHostStateOptions) {
  const {
    mode,
    selectedWorkspaceId,
    selectedSessionId,
    selectedWorkspaceRoot,
    workspaces,
    draftWorkspaceDirectory,
    onAccessibleTargetsChange,
    historySearchViews,
    sidePanelDefaultWidth,
    sidePanelMinWidth,
  } = options;

  const { activeSidebarView, openRailView } = useRailLocation({
    mode,
    workspaceId: selectedWorkspaceId,
  });
  const visitedRailViews = useVisitedRailViews(
    activeSidebarView,
    selectedWorkspaceId,
  );
  const [pendingArchiveResume, setPendingArchiveResume] =
    useState<SessionArchiveResumeRequest | null>(null);

  const sidePanelSessionKey =
    mode === "assistant"
      ? (selectedSessionId ?? `assistant-draft:${selectedWorkspaceId}`)
      : selectedSessionId;
  const browserSessionScopeId =
    mode === "assistant"
      ? (sidePanelSessionKey as string)
      : selectedSessionId ?? undefined;

  const resolvedSidePanelScopeId =
    options.sidePanelScopeId !== undefined
      ? options.sidePanelScopeId
      : activeSidebarView === "localAgent"
        ? `localAgent:${selectedWorkspaceId}`
        : sidePanelSessionKey;

  const sidePanel = useSessionHostSidePanel({
    sidePanelScopeId: resolvedSidePanelScopeId,
    selectedWorkspaceId,
    selectedSessionId,
    onAccessibleTargetsChange,
  });

  const {
    setCurrentSidePanel: setCurrentSidePanelFromHook,
    setSidePanelState,
    setArtifactTarget,
    artifactTarget,
    accessibleTargets,
    removeAccessibleTarget,
    voiceExtensionEnabled,
    activeSidePanel,
    sessionSidePanel,
    sidePanelOpen,
  } = sidePanel;

  const setCurrentSidePanel = setCurrentSidePanelFromHook;
  const [artifactFocusToken, setArtifactFocusToken] = useState(0);

  const codeWorkspacePath =
    draftWorkspaceDirectory?.trim() || selectedWorkspaceRoot;
  const codeWorkspaceCatalogRoot =
    workspaces.find((workspace) => workspace.id === selectedWorkspaceId)?.path
      ?.trim() || selectedWorkspaceRoot;

  /** Header find bar (expands in chrome like in-chat search). */
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const [historySearchQuery, setHistorySearchQuery] = useState("");
  const [historyMatchCount, setHistoryMatchCount] = useState(0);
  const [historyActiveMatch, setHistoryActiveMatch] = useState(0);
  const historySearchInputRef = useRef<HTMLInputElement>(null);
  const browserPanelRef = usePanelRef();
  const preserveSidePanelOnPanelOpenRef = useRef(false);

  const historyComposerSessionId =
    options.historyComposerSessionId !== undefined
      ? options.historyComposerSessionId
      : selectedSessionId;

  const openBrowserPanelFromAgent = useCallback(() => {
    if (preserveSidePanelOnPanelOpenRef.current) {
      preserveSidePanelOnPanelOpenRef.current = false;
      return;
    }
    // Only auto-open for a real chat session — never for draft / new-task.
    if (!selectedSessionId) return;
    setCurrentSidePanel("browser");
  }, [selectedSessionId, setCurrentSidePanel]);
  useAutoOpenBrowserPanel(openBrowserPanelFromAgent, selectedSessionId);

  const { setRightSidebarExpandedWidth: setBrowserPanelWidth } =
    useWorkspaceShellLayout({
      expandedRightWidth: sidePanelDefaultWidth,
      minRightWidth: sidePanelMinWidth,
    });
  const sidePanelWidthRef = useRef(sidePanelDefaultWidth);

  const openWorkspaceSidePanelMenu = useCallback(() => {
    sidePanelWidthRef.current = sidePanelDefaultWidth;
    setBrowserPanelWidth(sidePanelDefaultWidth);
    // Right rail stays workspace tools (not history — history is a header popover).
    setCurrentSidePanel("codeMenu");
  }, [setBrowserPanelWidth, setCurrentSidePanel, sidePanelDefaultWidth]);

  const handleHistorySelectPrompt = useCallback(
    (text: string) => {
      const sessionId = historyComposerSessionId;
      if (!sessionId || !text.trim()) return;
      useComposerStateStore.getState().setDraft(sessionId, text);
    },
    [historyComposerSessionId],
  );

  /** Header find only — never opens the right workspace / history panel. */
  const openHistorySearch = useCallback(
    (event?: { stopPropagation?: () => void }) => {
      event?.stopPropagation?.();
      setHistorySearchOpen(true);
      window.setTimeout(() => historySearchInputRef.current?.focus(), 0);
    },
    [],
  );

  const closeHistorySearch = useCallback(() => {
    setHistorySearchOpen(false);
    setHistorySearchQuery("");
    setHistoryActiveMatch(0);
    setHistoryMatchCount(0);
  }, []);

  useEffect(() => {
    setHistoryActiveMatch(0);
  }, [historySearchQuery, historyComposerSessionId]);

  // Search-in-task: unified keymap dispatcher emits KEYMAP_EVENT_SEARCH_IN_TASK
  // (default ⌘/Ctrl+F). Also keep a local match for when host mounts before dispatcher.
  useEffect(() => {
    const onSearchEvent = () => {
      if (historySearchViews.includes(activeSidebarView)) {
        openHistorySearch();
      }
    };
    window.addEventListener("onmyagent:keymap:search-in-task", onSearchEvent);
    return () => {
      window.removeEventListener(
        "onmyagent:keymap:search-in-task",
        onSearchEvent,
      );
    };
  }, [activeSidebarView, historySearchViews, openHistorySearch]);

  const commitBrowserPanelWidth = useCallback(() => {
    const size = browserPanelRef.current?.getSize();
    if (size?.inPixels) {
      const next = Math.round(size.inPixels);
      if (sidePanelWidthRef.current === next) return;
      sidePanelWidthRef.current = next;
      setBrowserPanelWidth(next);
    }
  }, [browserPanelRef, setBrowserPanelWidth]);

  const browserUrlForTarget = useCallback((target: OpenTarget) => {
    if (/^wss?:\/\//i.test(target.value))
      return target.value.replace(/^ws:/i, "http:").replace(/^wss:/i, "https:");
    return target.value;
  }, []);

  const openTarget = useCallback(
    async (target: OpenTarget, options?: { auto?: boolean }) => {
      if (target.kind === "url" || target.preview === "browser") {
        const url = browserUrlForTarget(target);
        await openInAppBrowser({
          openSidePanel: () => setCurrentSidePanel("browser"),
          url,
          sessionId: selectedSessionId,
        });
        return;
      }
      if (options?.auto && artifactTarget?.id === target.id) return;
      setArtifactTarget(target);
      setArtifactFocusToken((token) => token + 1);
      preserveSidePanelOnPanelOpenRef.current = true;
      setCurrentSidePanel("artifacts");
    },
    [
      artifactTarget?.id,
      browserUrlForTarget,
      selectedSessionId,
      setArtifactTarget,
      setCurrentSidePanel,
    ],
  );

  const closeRightPane = useCallback(() => {
    setCurrentSidePanel(null);
  }, [setCurrentSidePanel]);

  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target =
        accessibleTargets.find(
          (item) =>
            item.id === requested?.id || item.value === requested?.value,
        ) ?? (requested?.kind && requested?.value ? requested : null);
      if (target) void openTarget(target);
    };
    const hide = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target = accessibleTargets.find(
        (item) => item.id === requested?.id || item.value === requested?.value,
      );
      if (target) removeAccessibleTarget(target);
    };
    window.addEventListener("onmyagent-open-accessible-target", open);
    window.addEventListener("onmyagent-hide-accessible-target", hide);
    return () => {
      window.removeEventListener("onmyagent-open-accessible-target", open);
      window.removeEventListener("onmyagent-hide-accessible-target", hide);
    };
  }, [accessibleTargets, openTarget, removeAccessibleTarget]);

  useEffect(() => {
    const handler = () => setCurrentSidePanel(null);
    window.addEventListener("onmyagent-close-right-pane", handler);
    return () =>
      window.removeEventListener("onmyagent-close-right-pane", handler);
  }, [setCurrentSidePanel]);

  // History is a header popover now; clear any persisted right-rail "history".
  useEffect(() => {
    if (sessionSidePanel === "history") {
      setCurrentSidePanel(null);
    }
  }, [sessionSidePanel, setCurrentSidePanel]);

  const openVoicePanelControlAction = useMemo<OnMyAgentControlAction | null>(
    () =>
      voiceExtensionEnabled
        ? {
            id: "voice.panel.open",
            label: t("session.open_voice_mode"),
            description: t("session.open_voice_mode_desc"),
            sideEffect: "none",
            execute: () => {
              setCurrentSidePanel("voice");
              return { open: true };
            },
          }
        : null,
    [setCurrentSidePanel, voiceExtensionEnabled],
  );
  useControlAction(openVoicePanelControlAction);

  const closeVoicePanelControlAction = useMemo<OnMyAgentControlAction | null>(
    () =>
      voiceExtensionEnabled && activeSidePanel === "voice"
        ? {
            id: "voice.panel.close",
            label: t("session.close_voice_mode"),
            description: t("session.close_voice_mode_desc"),
            sideEffect: "none",
            execute: () => {
              setCurrentSidePanel(null);
              return { open: false };
            },
          }
        : null,
    [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled],
  );
  useControlAction(closeVoicePanelControlAction);

  const isPrimarySessionView = isPrimarySessionRailView(activeSidebarView);

  // Leaving 助理/专家 chat for other rail pages must close the workspace panel.
  useEffect(() => {
    if (isPrimarySessionView) return;
    setCurrentSidePanel(null);
  }, [isPrimarySessionView, setCurrentSidePanel]);

  return {
    activeSidebarView,
    openRailView,
    visitedRailViews,
    pendingArchiveResume,
    setPendingArchiveResume,
    sidePanelSessionKey,
    browserSessionScopeId,
    sidePanelScopeId: resolvedSidePanelScopeId,
    ...sidePanel,
    setCurrentSidePanel,
    artifactFocusToken,
    setArtifactFocusToken,
    codeWorkspacePath,
    codeWorkspaceCatalogRoot,
    historySearchOpen,
    setHistorySearchOpen,
    historySearchQuery,
    setHistorySearchQuery,
    historyMatchCount,
    setHistoryMatchCount,
    historyActiveMatch,
    setHistoryActiveMatch,
    historySearchInputRef,
    browserPanelRef,
    preserveSidePanelOnPanelOpenRef,
    openWorkspaceSidePanelMenu,
    handleHistorySelectPrompt,
    openHistorySearch,
    closeHistorySearch,
    commitBrowserPanelWidth,
    openTarget,
    closeRightPane,
    setBrowserPanelWidth,
    setSidePanelState,
    isPrimarySessionView,
  };
}
