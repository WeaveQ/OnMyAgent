import { describe, expect, test } from "bun:test";

import {
  DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
  MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
  getSidePanelState,
  setApplicationMenuVisible,
  setSidebarOpen,
  setSidePanelState,
  setWorkspaceLeftSidebarResizing,
  setWorkspaceLeftSidebarWidth,
  setWorkspaceRightSidebarExpanded,
  setWorkspaceRightSidebarExpandedWidth,
  toggleSidePanelState,
  toggleSidebar,
  toggleWorkspaceRightSidebar,
  type UiState,
} from "../src/react-app/shell/ui-state-store";

const baseState = {
  sidebarOpen: true,
  sidePanelState: {},
  applicationMenuVisible: false,
  workspaceLeftSidebarWidth: DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  workspaceLeftSidebarResizing: false,
  workspaceRightSidebarExpanded: false,
  workspaceRightSidebarExpandedWidth: DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
} satisfies UiState;

describe("ui state store pure reducers", () => {
  test("keeps sidebar toggles referentially stable when values do not change", () => {
    expect(setSidebarOpen(baseState, true)).toBe(baseState);
    expect(setSidebarOpen(baseState, false)).toEqual({ ...baseState, sidebarOpen: false });
    expect(toggleSidebar(baseState)).toEqual({ ...baseState, sidebarOpen: false });
  });

  test("sets, clears, and toggles per-session side panels", () => {
    expect(getSidePanelState(baseState, null)).toBeNull();
    expect(setSidePanelState(baseState, null, "browser")).toBe(baseState);

    const withBrowser = setSidePanelState(baseState, "ses_1", "browser");
    expect(withBrowser.sidePanelState.ses_1).toBe("browser");
    expect(setSidePanelState(withBrowser, "ses_1", "browser")).toBe(withBrowser);
    expect(toggleSidePanelState(withBrowser, "ses_1", "browser").sidePanelState.ses_1).toBeNull();
    expect(toggleSidePanelState(withBrowser, "ses_1", "artifacts").sidePanelState.ses_1).toBe("artifacts");
  });

  test("clamps workspace sidebar widths to supported ranges", () => {
    expect(setWorkspaceLeftSidebarWidth(baseState, 1).workspaceLeftSidebarWidth).toBe(MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH);
    expect(setWorkspaceLeftSidebarWidth(baseState, 9999).workspaceLeftSidebarWidth).toBe(MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH);
    expect(setWorkspaceLeftSidebarWidth(baseState, DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH)).toBe(baseState);

    expect(setWorkspaceRightSidebarExpandedWidth(baseState, 1).workspaceRightSidebarExpandedWidth).toBe(
      MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
    );
    expect(setWorkspaceRightSidebarExpandedWidth(baseState, 9999).workspaceRightSidebarExpandedWidth).toBe(
      MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
    );
    expect(setWorkspaceRightSidebarExpandedWidth(baseState, DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH)).toBe(
      baseState,
    );
  });

  test("updates menu, resizing, and right sidebar expansion state", () => {
    expect(setApplicationMenuVisible(baseState, false)).toBe(baseState);
    expect(setApplicationMenuVisible(baseState, true)).toEqual({ ...baseState, applicationMenuVisible: true });
    expect(setWorkspaceLeftSidebarResizing(baseState, false)).toBe(baseState);
    expect(setWorkspaceLeftSidebarResizing(baseState, true)).toEqual({ ...baseState, workspaceLeftSidebarResizing: true });
    expect(setWorkspaceRightSidebarExpanded(baseState, false)).toBe(baseState);
    expect(setWorkspaceRightSidebarExpanded(baseState, true)).toEqual({ ...baseState, workspaceRightSidebarExpanded: true });
    expect(toggleWorkspaceRightSidebar(baseState)).toEqual({ ...baseState, workspaceRightSidebarExpanded: true });
  });
});
