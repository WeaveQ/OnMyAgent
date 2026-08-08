/**
 * Side-panel + open-target tracking shared by Expert/Assistant session hosts.
 * (Named host-side-panel to avoid clashing with chat/session-page-side-panel.)
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import {
  isCollectibleArtifactTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import {
  hiddenAccessibleTargetsStorageKey,
  readHiddenAccessibleTargetIds,
  writeHiddenAccessibleTargetIds,
} from "../sidebar/session-chrome";
import { useUiStateStore, type SidePanelItem } from "../../../shell";
import { isTrackableAccessibleTarget } from "./shared-page-utils";

export function useSessionHostSidePanel(options: {
  sidePanelScopeId: string | null | undefined;
  selectedWorkspaceId: string;
  selectedSessionId: string | null | undefined;
  onAccessibleTargetsChange?: (targets: OpenTarget[]) => void;
}) {
  const {
    sidePanelScopeId,
    selectedWorkspaceId,
    selectedSessionId,
    onAccessibleTargetsChange,
  } = options;

  const sessionSidePanel = useUiStateStore((state) =>
    sidePanelScopeId
      ? (state.sidePanelState[sidePanelScopeId] ?? null)
      : null,
  );
  const setSidePanelState = useUiStateStore((state) => state.setSidePanelState);
  const toggleSidePanelState = useUiStateStore(
    (state) => state.toggleSidePanelState,
  );

  const [artifactTarget, setArtifactTarget] = useState<OpenTarget | null>(null);
  const [openTargets, setOpenTargets] = useState<OpenTarget[]>([]);
  const [hiddenAccessibleTargetIds, setHiddenAccessibleTargetIds] = useState<
    Set<string>
  >(() => new Set());
  const loadedHiddenTargetsKeyRef = useRef<string | null>(null);

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
  const visibleArtifactTarget =
    artifactTarget ?? artifactFileTargets[0] ?? null;
  const artifactTargetCount = artifactFileTargets.length;
  const hasArtifactTargets = artifactTargetCount > 0;
  const activeSidePanel = sessionSidePanel;
  const sidePanelOpen = activeSidePanel !== null;

  const setCurrentSidePanel = useCallback(
    (panel: SidePanelItem | null) => {
      if (!sidePanelScopeId) return;
      setSidePanelState(sidePanelScopeId, panel);
    },
    [setSidePanelState, sidePanelScopeId],
  );

  const toggleCurrentSidePanel = useCallback(
    (panel: SidePanelItem) => {
      if (!sidePanelScopeId) return;
      toggleSidePanelState(sidePanelScopeId, panel);
    },
    [sidePanelScopeId, toggleSidePanelState],
  );

  useEffect(() => {
    loadedHiddenTargetsKeyRef.current = hiddenAccessibleTargetsStorageKey(
      selectedWorkspaceId,
      selectedSessionId,
    );
    setArtifactTarget(null);
    setOpenTargets([]);
    setHiddenAccessibleTargetIds(
      readHiddenAccessibleTargetIds(selectedWorkspaceId, selectedSessionId),
    );
  }, [selectedSessionId, selectedWorkspaceId]);

  useEffect(() => {
    if (
      loadedHiddenTargetsKeyRef.current !==
      hiddenAccessibleTargetsStorageKey(selectedWorkspaceId, selectedSessionId)
    ) {
      return;
    }
    writeHiddenAccessibleTargetIds(
      selectedWorkspaceId,
      selectedSessionId,
      hiddenAccessibleTargetIds,
    );
  }, [hiddenAccessibleTargetIds, selectedSessionId, selectedWorkspaceId]);

  useEffect(() => {
    onAccessibleTargetsChange?.(accessibleTargets);
  }, [accessibleTargets, onAccessibleTargetsChange]);

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

  const removeAccessibleTarget = useCallback((target: OpenTarget) => {
    setHiddenAccessibleTargetIds((current) => new Set(current).add(target.id));
    setArtifactTarget((current) =>
      current?.id === target.id ? null : current,
    );
  }, []);

  return {
    sessionSidePanel,
    setSidePanelState,
    toggleSidePanelState,
    setCurrentSidePanel,
    toggleCurrentSidePanel,
    artifactTarget,
    setArtifactTarget,
    openTargets,
    setOpenTargets,
    hiddenAccessibleTargetIds,
    setHiddenAccessibleTargetIds,
    accessibleTargets,
    artifactFileTargets,
    visibleArtifactTarget,
    artifactTargetCount,
    hasArtifactTargets,
    activeSidePanel,
    sidePanelOpen,
    handleOpenTargetsChange,
    removeAccessibleTarget,
  };
}
