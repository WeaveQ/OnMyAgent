import { create } from "zustand";

export const PERSISTED_UI_STATE_KEY = "onmyagent:ui-state:v1";
/**
 * One-shot migration for the Windows native menu bar default.
 * v2 forced show; v3 hides the File/Edit/View strip on Windows again.
 */
const APPLICATION_MENU_DEFAULT_MIGRATION_KEY = "onmyagent:ui-menu-default-v3";
const SIDEBAR_COOKIE_NAME = "sidebar_state";
const LEGACY_WORKSPACE_LEFT_SIDEBAR_WIDTH_KEY = "onmyagent.workspace-shell.left-width.v1";
const LEGACY_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_KEY = "onmyagent.workspace-shell.right-expanded.v3";
const LEGACY_WORKSPACE_RIGHT_SIDEBAR_WIDTH_KEY = "onmyagent.workspace-shell.right-width.v1";

export const DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH = 260;
export const MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH = 220;
export const MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH = 420;
export const DEFAULT_WORKSPACE_RIGHT_SIDEBAR_COLLAPSED_WIDTH = 72;
export const DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH = 520;
export const MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH = 420;
export const MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH = 960;

export const SIDE_PANEL_ITEMS = [
  "browser",
  "artifacts",
  "extensions",
  "voice",
  "codeMenu",
  "review",
  "terminal",
  "canvas",
  "history",
] as const;
export type SidePanelItem = (typeof SIDE_PANEL_ITEMS)[number];
export type SidePanelState = Record<string, SidePanelItem | null>;

export type PersistedUiState = {
  sidePanelState?: SidePanelState;
  applicationMenuVisible?: boolean;
  workspaceLeftSidebarWidth?: number;
  workspaceRightSidebarExpanded?: boolean;
  workspaceRightSidebarExpandedWidth?: number;
};

export type UiState = {
  sidebarOpen: boolean;
  sidePanelState: SidePanelState;
  applicationMenuVisible: boolean;
  workspaceLeftSidebarWidth: number;
  workspaceLeftSidebarResizing: boolean;
  workspaceRightSidebarExpanded: boolean;
  workspaceRightSidebarExpandedWidth: number;
};

const initialState: UiState = {
  sidebarOpen: true,
  sidePanelState: {},
  // Windows/Linux: hide native File/Edit/View bar (app UI is enough). macOS
  // system menu bar is unaffected by this flag in Electron.
  applicationMenuVisible: false,
  workspaceLeftSidebarWidth: DEFAULT_WORKSPACE_LEFT_SIDEBAR_WIDTH,
  workspaceLeftSidebarResizing: false,
  workspaceRightSidebarExpanded: false,
  workspaceRightSidebarExpandedWidth: DEFAULT_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_WIDTH,
};

function clampNumber(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function normalizeNumber(value: unknown, min: number, max: number) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return clampNumber(value, min, max);
}

function readLegacyNumber(key: string, min: number, max: number) {
  if (globalThis.window === undefined) {
    return null;
  }

  const parsed = Number(window.localStorage.getItem(key));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return clampNumber(parsed, min, max);
}

function readLegacyWorkspaceLayoutState() {
  if (globalThis.window === undefined) {
    return {};
  }

  const rightSidebarExpanded = window.localStorage.getItem(LEGACY_WORKSPACE_RIGHT_SIDEBAR_EXPANDED_KEY);

  return {
    workspaceLeftSidebarWidth: readLegacyNumber(
      LEGACY_WORKSPACE_LEFT_SIDEBAR_WIDTH_KEY,
      MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH,
      MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH,
    ) ?? undefined,
    workspaceRightSidebarExpanded: rightSidebarExpanded == null ? undefined : rightSidebarExpanded === "1",
    workspaceRightSidebarExpandedWidth: readLegacyNumber(
      LEGACY_WORKSPACE_RIGHT_SIDEBAR_WIDTH_KEY,
      MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
      MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
    ) ?? undefined,
  } satisfies Partial<PersistedUiState>;
}

function isSidePanelItem(value: unknown): value is SidePanelItem {
  return SIDE_PANEL_ITEMS.includes(value as SidePanelItem);
}

function normalizeSidePanelState(value: unknown): SidePanelState {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return initialState.sidePanelState;
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, SidePanelItem | null] => (
        typeof entry[0] === "string" && (entry[1] === null || isSidePanelItem(entry[1]))
      ),
    ),
  );
}

function readSidebarCookieOpen(): boolean | null {
  if (globalThis.window === undefined) {
    return null;
  }

  const prefix = `${SIDEBAR_COOKIE_NAME}=`;
  const cookie = window.document.cookie
    .split("; ")
    .find((row) => row.startsWith(prefix));

  if (!cookie) {
    return null;
  }

  return cookie.slice(prefix.length) === "true";
}

function readPersistedUiState(): UiState {
  if (globalThis.window === undefined) {
    return initialState;
  }

  try {
    const raw = window.localStorage.getItem(PERSISTED_UI_STATE_KEY);
    const sidebarOpen = readSidebarCookieOpen() ?? initialState.sidebarOpen;
    const legacyLayoutState = readLegacyWorkspaceLayoutState();

    if (!raw) {
      return {
        ...initialState,
        sidebarOpen,
        applicationMenuVisible: resolveApplicationMenuVisibleDefault(undefined),
        workspaceLeftSidebarWidth:
          legacyLayoutState.workspaceLeftSidebarWidth ?? initialState.workspaceLeftSidebarWidth,
        workspaceRightSidebarExpanded:
          legacyLayoutState.workspaceRightSidebarExpanded ?? initialState.workspaceRightSidebarExpanded,
        workspaceRightSidebarExpandedWidth:
          legacyLayoutState.workspaceRightSidebarExpandedWidth ?? initialState.workspaceRightSidebarExpandedWidth,
      };
    }

    const parsed: PersistedUiState = JSON.parse(raw);
    const sidePanelState = normalizeSidePanelState(parsed.sidePanelState);

    return {
      ...initialState,
      sidebarOpen,
      sidePanelState,
      applicationMenuVisible: resolveApplicationMenuVisibleDefault(parsed.applicationMenuVisible),
      workspaceLeftSidebarWidth: normalizeNumber(
        parsed.workspaceLeftSidebarWidth,
        MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH,
        MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH,
      ) ?? legacyLayoutState.workspaceLeftSidebarWidth ?? initialState.workspaceLeftSidebarWidth,
      workspaceRightSidebarExpanded:
        parsed.workspaceRightSidebarExpanded ??
        legacyLayoutState.workspaceRightSidebarExpanded ??
        initialState.workspaceRightSidebarExpanded,
      workspaceRightSidebarExpandedWidth: normalizeNumber(
        parsed.workspaceRightSidebarExpandedWidth,
        MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
        MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH,
      ) ?? legacyLayoutState.workspaceRightSidebarExpandedWidth ?? initialState.workspaceRightSidebarExpandedWidth,
    };
  } catch {
    return initialState;
  }
}

function isWindowsRenderer(): boolean {
  if (globalThis.window === undefined || typeof navigator === "undefined") {
    return false;
  }
  return /Win/i.test(navigator.platform) || /Windows/i.test(navigator.userAgent);
}

/**
 * Windows: hide the native File/Edit/View menu bar by default.
 * One-shot v3 migration overrides older v2 "force show" so existing installs
 * also get the clean chrome unless the user later toggles it back on.
 */
function resolveApplicationMenuVisibleDefault(persisted: boolean | undefined): boolean {
  if (globalThis.window === undefined) {
    return persisted ?? initialState.applicationMenuVisible;
  }

  const migrated = window.localStorage.getItem(APPLICATION_MENU_DEFAULT_MIGRATION_KEY) === "1";
  if (!migrated) {
    try {
      window.localStorage.setItem(APPLICATION_MENU_DEFAULT_MIGRATION_KEY, "1");
    } catch {
      // ignore quota / private mode
    }
    if (isWindowsRenderer()) {
      return false;
    }
    return persisted ?? initialState.applicationMenuVisible;
  }

  return persisted ?? initialState.applicationMenuVisible;
}

export function persistUiState(state: UiState): void {
  if (globalThis.window === undefined) {
    return;
  }

  try {
    window.localStorage.setItem(
      PERSISTED_UI_STATE_KEY,
      JSON.stringify({
        sidePanelState: state.sidePanelState,
        applicationMenuVisible: state.applicationMenuVisible,
        workspaceLeftSidebarWidth: state.workspaceLeftSidebarWidth,
        workspaceRightSidebarExpanded: state.workspaceRightSidebarExpanded,
        workspaceRightSidebarExpandedWidth: state.workspaceRightSidebarExpandedWidth,
      } satisfies PersistedUiState),
    );
  } catch {
    return;
  }
}

export function setSidebarOpen(state: UiState, open: boolean): UiState {
  if (state.sidebarOpen === open) {
    return state;
  }

  return {
    ...state,
    sidebarOpen: open,
  };
}

export function toggleSidebar(state: UiState): UiState {
  return setSidebarOpen(state, !state.sidebarOpen);
}

export function getSidePanelState(state: UiState, sessionId: string | null | undefined): SidePanelItem | null {
  if (!sessionId) {
    return null;
  }

  return state.sidePanelState[sessionId] ?? null;
}

export function setSidePanelState(
  state: UiState,
  sessionId: string | null | undefined,
  panel: SidePanelItem | null,
): UiState {
  if (!sessionId || getSidePanelState(state, sessionId) === panel) {
    return state;
  }

  return {
    ...state,
    sidePanelState: {
      ...state.sidePanelState,
      [sessionId]: panel,
    },
  };
}

export function toggleSidePanelState(
  state: UiState,
  sessionId: string | null | undefined,
  panel: SidePanelItem,
): UiState {
  return setSidePanelState(state, sessionId, getSidePanelState(state, sessionId) === panel ? null : panel);
}

export function setApplicationMenuVisible(state: UiState, visible: boolean): UiState {
  if (state.applicationMenuVisible === visible) {
    return state;
  }

  return {
    ...state,
    applicationMenuVisible: visible,
  };
}

export function setWorkspaceLeftSidebarWidth(state: UiState, width: number): UiState {
  const nextWidth = clampNumber(width, MIN_WORKSPACE_LEFT_SIDEBAR_WIDTH, MAX_WORKSPACE_LEFT_SIDEBAR_WIDTH);
  if (state.workspaceLeftSidebarWidth === nextWidth) {
    return state;
  }

  return {
    ...state,
    workspaceLeftSidebarWidth: nextWidth,
  };
}

export function setWorkspaceLeftSidebarResizing(state: UiState, resizing: boolean): UiState {
  if (state.workspaceLeftSidebarResizing === resizing) {
    return state;
  }

  return {
    ...state,
    workspaceLeftSidebarResizing: resizing,
  };
}

export function setWorkspaceRightSidebarExpanded(state: UiState, expanded: boolean): UiState {
  if (state.workspaceRightSidebarExpanded === expanded) {
    return state;
  }

  return {
    ...state,
    workspaceRightSidebarExpanded: expanded,
  };
}

export function setWorkspaceRightSidebarExpandedWidth(state: UiState, width: number): UiState {
  const nextWidth = clampNumber(width, MIN_WORKSPACE_RIGHT_SIDEBAR_WIDTH, MAX_WORKSPACE_RIGHT_SIDEBAR_WIDTH);
  if (state.workspaceRightSidebarExpandedWidth === nextWidth) {
    return state;
  }

  return {
    ...state,
    workspaceRightSidebarExpandedWidth: nextWidth,
  };
}

export function toggleWorkspaceRightSidebar(state: UiState): UiState {
  return setWorkspaceRightSidebarExpanded(state, !state.workspaceRightSidebarExpanded);
}

function syncApplicationMenuVisible(visible: boolean): void {
  void globalThis.window?.__ONMYAGENT_ELECTRON__?.invokeDesktop?.("__setApplicationMenuVisible", visible);
}

type UiStateStore = UiState & {
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSidePanelState: (sessionId: string | null | undefined, panel: SidePanelItem | null) => void;
  toggleSidePanelState: (sessionId: string | null | undefined, panel: SidePanelItem) => void;
  setApplicationMenuVisible: (visible: boolean) => void;
  setWorkspaceLeftSidebarWidth: (width: number) => void;
  setWorkspaceLeftSidebarResizing: (resizing: boolean) => void;
  setWorkspaceRightSidebarExpanded: (expanded: boolean) => void;
  setWorkspaceRightSidebarExpandedWidth: (width: number) => void;
  toggleWorkspaceRightSidebar: () => void;
};

export const useUiStateStore = create<UiStateStore>((set) => ({
  ...readPersistedUiState(),
  setSidebarOpen: (open) => set((state) => setSidebarOpen(state, open)),
  toggleSidebar: () => set((state) => toggleSidebar(state)),
  setSidePanelState: (sessionId, panel) => set((state) => setSidePanelState(state, sessionId, panel)),
  toggleSidePanelState: (sessionId, panel) => set((state) => toggleSidePanelState(state, sessionId, panel)),
  setApplicationMenuVisible: (visible) => {
    set((state) => setApplicationMenuVisible(state, visible));
    syncApplicationMenuVisible(visible);
  },
  setWorkspaceLeftSidebarWidth: (width) => set((state) => setWorkspaceLeftSidebarWidth(state, width)),
  setWorkspaceLeftSidebarResizing: (resizing) => set((state) => setWorkspaceLeftSidebarResizing(state, resizing)),
  setWorkspaceRightSidebarExpanded: (expanded) => set((state) => setWorkspaceRightSidebarExpanded(state, expanded)),
  setWorkspaceRightSidebarExpandedWidth: (width) => set((state) => setWorkspaceRightSidebarExpandedWidth(state, width)),
  toggleWorkspaceRightSidebar: () => set((state) => toggleWorkspaceRightSidebar(state)),
}));

syncApplicationMenuVisible(useUiStateStore.getState().applicationMenuVisible);

useUiStateStore.subscribe((state) => persistUiState(state));
