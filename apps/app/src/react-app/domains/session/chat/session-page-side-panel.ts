import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { usePanelRef } from "react-resizable-panels";

import {
  DEFAULT_BROWSER_SIDE_PANEL_WIDTH,
  DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
  MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  useWorkspaceShellLayout,
  type SidePanelItem,
} from "../../../shell";
import {
  isCollectibleArtifactTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import {
  hiddenAccessibleTargetsStorageKey,
  isTrackableAccessibleTarget,
  readHiddenAccessibleTargetIds,
  writeHiddenAccessibleTargetIds,
} from "./session-page-accessible-targets";
import { openInAppBrowser } from "../browser/open-in-app-browser";
import { useAutoOpenBrowserPanel } from "../browser/use-auto-open-browser-panel";

type UseSessionPageSidePanelInput = {
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  sessionSidePanel: SidePanelItem | null;
  browserPanelRef: ReturnType<typeof usePanelRef>;
  setSidePanelState: (sessionId: string | null, panel: SidePanelItem | null) => void;
  toggleSidePanelState: (sessionId: string | null, panel: SidePanelItem) => void;
  onAccessibleTargetsChange?: (targets: OpenTarget[]) => void;
};

export function useSessionPageSidePanel(input: UseSessionPageSidePanelInput) {
  const {
    browserPanelRef,
    onAccessibleTargetsChange,
    selectedSessionId,
    selectedWorkspaceId,
    sessionSidePanel,
    setSidePanelState,
    toggleSidePanelState,
  } = input;
  const [artifactTarget, setArtifactTarget] = useState<OpenTarget | null>(null);
  const [openTargets, setOpenTargets] = useState<OpenTarget[]>([]);
  const [hiddenAccessibleTargetIds, setHiddenAccessibleTargetIds] = useState<
    Set<string>
  >(() => new Set());
  const loadedHiddenTargetsKeyRef = useRef<string | null>(null);
  const preserveSidePanelOnPanelOpenRef = useRef(false);

  const accessibleTargets = useMemo(
    () =>
      openTargets.filter(
        (target) =>
          isTrackableAccessibleTarget(target) &&
          !hiddenAccessibleTargetIds.has(target.id),
      ),
    [hiddenAccessibleTargetIds, openTargets],
  );
  const artifactFileTargets = useMemo(
    () => accessibleTargets.filter(isCollectibleArtifactTarget),
    [accessibleTargets],
  );
  const visibleArtifactTarget = artifactTarget ?? artifactFileTargets[0] ?? null;
  const activeSidePanel = sessionSidePanel;
  const sidePanelOpen = activeSidePanel !== null;
  const browserRailActive = activeSidePanel === "browser";
  const artifactRailActive = activeSidePanel === "artifacts";
  const reviewRailActive = activeSidePanel === "review";
  const terminalRailActive = activeSidePanel === "terminal";
  const codeMenuRailActive = activeSidePanel === "codeMenu";
  const artifactTargetCount = artifactFileTargets.length;
  const hasArtifactTargets = artifactTargetCount > 0;

  const setCurrentSidePanel = useCallback(
    (panel: SidePanelItem | null) => {
      setSidePanelState(selectedSessionId, panel);
    },
    [selectedSessionId, setSidePanelState],
  );

  const toggleCurrentSidePanel = useCallback(
    (panel: SidePanelItem) => {
      toggleSidePanelState(selectedSessionId, panel);
    },
    [selectedSessionId, toggleSidePanelState],
  );

  const {
    rightSidebarExpandedWidth: browserPanelWidth,
    setRightSidebarExpandedWidth: setBrowserPanelWidth,
  } = useWorkspaceShellLayout({
    // Same default as assistant/expert hosts and outer workspace rail.
    expandedRightWidth: DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
    minRightWidth: MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  });
  const [browserPanelDefaultWidth, setBrowserPanelDefaultWidth] =
    useState(browserPanelWidth);

  /** Snap outer rail + ResizablePanel defaultSize to an explicit pixel width. */
  const snapSidePanelWidth = useCallback(
    (width: number) => {
      setBrowserPanelWidth(width);
      setBrowserPanelDefaultWidth(width);
      browserPanelRef.current?.resize(`${width}px`);
    },
    [browserPanelRef, setBrowserPanelWidth],
  );

  const snapToMenuWidth = useCallback(() => {
    snapSidePanelWidth(DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH);
  }, [snapSidePanelWidth]);

  /** Browser needs more room than the compact tool menu (360). */
  const snapToBrowserWidth = useCallback(() => {
    snapSidePanelWidth(DEFAULT_BROWSER_SIDE_PANEL_WIDTH);
  }, [snapSidePanelWidth]);

  const openBrowserPanelFromAgent = useCallback(() => {
    if (preserveSidePanelOnPanelOpenRef.current) {
      preserveSidePanelOnPanelOpenRef.current = false;
      return;
    }
    if (!selectedSessionId) return;
    snapToBrowserWidth();
    setCurrentSidePanel("browser");
  }, [selectedSessionId, setCurrentSidePanel, snapToBrowserWidth]);
  useAutoOpenBrowserPanel(openBrowserPanelFromAgent, selectedSessionId);

  useEffect(() => {
    if (sidePanelOpen) return;
    setBrowserPanelDefaultWidth(browserPanelWidth);
  }, [sidePanelOpen, browserPanelWidth]);

  useEffect(() => {
    loadedHiddenTargetsKeyRef.current = hiddenAccessibleTargetsStorageKey(
      selectedWorkspaceId,
      selectedSessionId,
    );
    setArtifactTarget(null);
    setOpenTargets([]);
    setHiddenAccessibleTargetIds(
      readHiddenAccessibleTargetIds(
        selectedWorkspaceId,
        selectedSessionId,
      ),
    );
  }, [selectedSessionId, selectedWorkspaceId]);

  useEffect(() => {
    if (
      loadedHiddenTargetsKeyRef.current !==
      hiddenAccessibleTargetsStorageKey(
        selectedWorkspaceId,
        selectedSessionId,
      )
    )
      return;
    writeHiddenAccessibleTargetIds(
      selectedWorkspaceId,
      selectedSessionId,
      hiddenAccessibleTargetIds,
    );
  }, [hiddenAccessibleTargetIds, selectedSessionId, selectedWorkspaceId]);

  useEffect(() => {
    onAccessibleTargetsChange?.(accessibleTargets);
  }, [accessibleTargets, onAccessibleTargetsChange]);

  const commitBrowserPanelWidth = useCallback(() => {
    const size = browserPanelRef.current?.getSize();
    if (size?.inPixels) setBrowserPanelWidth(Math.round(size.inPixels));
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
        snapToBrowserWidth();
        await openInAppBrowser({
          openSidePanel: () => setCurrentSidePanel("browser"),
          url,
          sessionId: selectedSessionId,
        });
        return;
      }
      if (options?.auto && artifactTarget?.id === target.id) return;
      setArtifactTarget(target);
      preserveSidePanelOnPanelOpenRef.current = true;
      setCurrentSidePanel("artifacts");
    },
    [
      artifactTarget?.id,
      browserUrlForTarget,
      selectedSessionId,
      setCurrentSidePanel,
      snapToBrowserWidth,
    ],
  );

  const handleOpenTargetsChange = useCallback((targets: OpenTarget[]) => {
    setOpenTargets(targets);
    setArtifactTarget((current) => {
      if (!current) return current;
      const updated = targets.find(
        (target) => target.id === current.id || target.value === current.value,
      );
      if (!updated) return current;
      return isCollectibleArtifactTarget(updated) ? updated : null;
    });
  }, []);

  const closeRightPane = useCallback(() => {
    setCurrentSidePanel(null);
  }, [setCurrentSidePanel]);

  const openBrowserRailPane = useCallback(() => {
    // User clicked 浏览器: seed Baidu only when this session has no page tabs yet.
    // Agent open / openTarget(url) must not go through seedHomeWhenEmpty.
    // Expand to browser default (520) — tool menu stays compact at 360.
    snapToBrowserWidth();
    void openInAppBrowser({
      openSidePanel: () => setCurrentSidePanel("browser"),
      sessionId: selectedSessionId,
      seedHomeWhenEmpty: true,
    }).catch(() => {
      setCurrentSidePanel("browser");
    });
  }, [selectedSessionId, setCurrentSidePanel, snapToBrowserWidth]);

  const openArtifactRailPane = useCallback(() => {
    if (!artifactRailActive) {
      preserveSidePanelOnPanelOpenRef.current = true;
    }
    setCurrentSidePanel("artifacts");
  }, [artifactRailActive, setCurrentSidePanel]);

  const openReviewRailPane = useCallback(() => {
    setCurrentSidePanel("review");
  }, [setCurrentSidePanel]);

  const openTerminalRailPane = useCallback(() => {
    setCurrentSidePanel("terminal");
  }, [setCurrentSidePanel]);

  const openCodeMenuRailPane = useCallback(() => {
    // Tool list is compact; keep 360 so it doesn’t leave a dead gap.
    snapToMenuWidth();
    setCurrentSidePanel("codeMenu");
  }, [setCurrentSidePanel, snapToMenuWidth]);

  const removeAccessibleTarget = useCallback((target: OpenTarget) => {
    setHiddenAccessibleTargetIds((current) => new Set(current).add(target.id));
    setArtifactTarget((current) =>
      current?.id === target.id ? null : current,
    );
  }, []);

  useEffect(() => {
    const open = (event: Event) => {
      const requested = (event as CustomEvent<OpenTarget>).detail;
      const target =
        accessibleTargets.find(
          (item) => item.id === requested?.id || item.value === requested?.value,
        ) ?? (requested?.kind && requested?.value ? requested : null);
      if (target) openTarget(target);
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


  return {
    activeSidePanel,
    sidePanelOpen,
    browserRailActive,
    artifactRailActive,
    reviewRailActive,
    terminalRailActive,
    codeMenuRailActive,
    visibleArtifactTarget,
    artifactFileTargets,
    artifactTargetCount,
    hasArtifactTargets,
    browserPanelDefaultWidth,
    commitBrowserPanelWidth,
    setCurrentSidePanel,
    openTarget,
    handleOpenTargetsChange,
    removeAccessibleTarget,
    closeRightPane,
    openBrowserRailPane,
    openArtifactRailPane,
    openReviewRailPane,
    openTerminalRailPane,
    openCodeMenuRailPane,
  };
}
