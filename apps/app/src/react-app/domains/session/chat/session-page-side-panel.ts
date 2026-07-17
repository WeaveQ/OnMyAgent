import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { usePanelRef } from "react-resizable-panels";

import { isElectronRuntime } from "../../../../app/utils";
import { useWorkspaceShellLayout } from "../../../shell";
import type { SidePanelItem } from "../../../shell";
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
import { GLOBAL_VOICE_SIDE_PANEL_KEY } from "./session-page-model";
import { useAutoOpenBrowserPanel } from "../browser/use-auto-open-browser-panel";

type UseSessionPageSidePanelInput = {
  selectedWorkspaceId: string;
  selectedSessionId: string | null;
  sessionSidePanel: SidePanelItem | null;
  voiceSidePanelOpen: boolean;
  voiceExtensionEnabled: boolean;
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
    voiceExtensionEnabled,
    voiceSidePanelOpen,
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
  const activeSidePanel = voiceSidePanelOpen
    ? "voice"
    : sessionSidePanel;
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
      setSidePanelState(
        GLOBAL_VOICE_SIDE_PANEL_KEY,
        panel === "voice" ? "voice" : null,
      );
      if (panel === "voice") return;
      setSidePanelState(selectedSessionId, panel);
    },
    [selectedSessionId, setSidePanelState],
  );

  const toggleCurrentSidePanel = useCallback(
    (panel: SidePanelItem) => {
      if (panel === "voice") {
        toggleSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, "voice");
        return;
      }
      setSidePanelState(GLOBAL_VOICE_SIDE_PANEL_KEY, null);
      toggleSidePanelState(selectedSessionId, panel);
    },
    [selectedSessionId, setSidePanelState, toggleSidePanelState],
  );

  const openBrowserPanelFromAgent = useCallback(() => {
    if (preserveSidePanelOnPanelOpenRef.current) {
      preserveSidePanelOnPanelOpenRef.current = false;
      return;
    }
    setCurrentSidePanel("browser");
  }, [setCurrentSidePanel]);
  useAutoOpenBrowserPanel(openBrowserPanelFromAgent);

  const {
    rightSidebarExpandedWidth: browserPanelWidth,
    setRightSidebarExpandedWidth: setBrowserPanelWidth,
  } = useWorkspaceShellLayout({
    expandedRightWidth: 520,
    minRightWidth: 320,
  });
  const [browserPanelDefaultWidth, setBrowserPanelDefaultWidth] =
    useState(browserPanelWidth);

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
        if (isElectronRuntime()) {
          setCurrentSidePanel("browser");
          const createTab = window.__ONMYAGENT_ELECTRON__?.browser?.createTab;
          if (!createTab) throw new Error("Browser bridge is unavailable.");
          await createTab(url);
        } else {
          window.open(url, "_blank", "noopener,noreferrer");
        }
        return;
      }
      if (options?.auto && artifactTarget?.id === target.id) return;
      setArtifactTarget(target);
      preserveSidePanelOnPanelOpenRef.current = true;
      setCurrentSidePanel("artifacts");
    },
    [artifactTarget?.id, browserUrlForTarget, setCurrentSidePanel],
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
    setCurrentSidePanel("browser");
  }, [setCurrentSidePanel]);

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
    setCurrentSidePanel("codeMenu");
  }, [setCurrentSidePanel]);

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

  useEffect(() => {
    if (activeSidePanel === "voice" && !voiceExtensionEnabled) {
      setCurrentSidePanel(null);
    }
  }, [activeSidePanel, setCurrentSidePanel, voiceExtensionEnabled]);

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
    closeRightPane,
    openBrowserRailPane,
    openArtifactRailPane,
    openReviewRailPane,
    openTerminalRailPane,
    openCodeMenuRailPane,
  };
}
