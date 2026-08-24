export type WorkspaceFilesPanelLayoutState = {
  selectedPath: string | null;
  treeCollapsed: boolean;
  treeWidthPx: number;
};

export type WorkspaceFilesPanelLayoutAction =
  | { type: "collapse"; treeWidthPx: number }
  | { type: "expand"; treeWidthPx: number }
  | { type: "resize"; treeWidthPx: number }
  | { type: "select"; selectedPath: string }
  | { type: "reset-selection" };

export type WorkspaceFilesPanelLayoutMemory = {
  widthPx: number;
  collapsed: boolean;
};

export type WorkspaceFilesPanelLayoutControllerPorts = {
  readTreeWidthPx: () => number;
  readContainerWidthPx: () => number | undefined;
  clampTreeWidthPx: (widthPx: number, containerWidthPx?: number) => number;
  commitLayout: (action: WorkspaceFilesPanelLayoutAction) => void;
  persistLayout: (memory: WorkspaceFilesPanelLayoutMemory) => void;
};

export function createWorkspaceFilesPanelLayoutController(
  ports: WorkspaceFilesPanelLayoutControllerPorts,
) {
  const applyTreeLayout = (
    type: "collapse" | "expand" | "resize",
    requestedWidthPx: number,
    containerWidthPx: number | undefined,
    persist: boolean,
  ) => {
    const treeWidthPx = ports.clampTreeWidthPx(
      requestedWidthPx,
      containerWidthPx,
    );
    ports.commitLayout({ type, treeWidthPx });
    if (persist) {
      ports.persistLayout({
        widthPx: treeWidthPx,
        collapsed: type === "collapse",
      });
    }
  };

  return {
    collapse() {
      applyTreeLayout(
        "collapse",
        ports.readTreeWidthPx(),
        ports.readContainerWidthPx(),
        true,
      );
    },
    expand() {
      applyTreeLayout(
        "expand",
        ports.readTreeWidthPx(),
        ports.readContainerWidthPx(),
        true,
      );
    },
    resizeFromPointer(input: {
      startWidthPx: number;
      startClientX: number;
      clientX: number;
      containerWidthPx?: number;
    }) {
      applyTreeLayout(
        "resize",
        input.startWidthPx + (input.clientX - input.startClientX),
        input.containerWidthPx,
        false,
      );
    },
    finishResize() {
      applyTreeLayout(
        "resize",
        ports.readTreeWidthPx(),
        ports.readContainerWidthPx(),
        true,
      );
    },
    resizeByKeyboard(key: string) {
      if (key !== "ArrowLeft" && key !== "ArrowRight") return false;
      applyTreeLayout(
        "resize",
        ports.readTreeWidthPx() + (key === "ArrowLeft" ? -16 : 16),
        ports.readContainerWidthPx(),
        true,
      );
      return true;
    },
  };
}

export function createWorkspaceFilesPanelLayoutControllerForPanel(input: {
  treeWidthRef: { current: number };
  filesTreeLayoutMemory: {
    current: WorkspaceFilesPanelLayoutMemory;
  };
  setLayout: (
    update: (
      current: WorkspaceFilesPanelLayoutState,
    ) => WorkspaceFilesPanelLayoutState,
  ) => void;
  readContainerWidthPx: () => number | undefined;
  clampTreeWidthPx: (widthPx: number, containerWidthPx?: number) => number;
}) {
  return createWorkspaceFilesPanelLayoutController({
    readTreeWidthPx: () => input.treeWidthRef.current,
    readContainerWidthPx: input.readContainerWidthPx,
    clampTreeWidthPx: input.clampTreeWidthPx,
    commitLayout: (action) => {
      if ("treeWidthPx" in action) {
        input.treeWidthRef.current = action.treeWidthPx;
      }
      input.setLayout((current) =>
        reduceWorkspaceFilesPanelLayout(current, action),
      );
    },
    persistLayout: (memory) => {
      input.filesTreeLayoutMemory.current = {
        widthPx: memory.widthPx,
        collapsed: memory.collapsed,
      };
    },
  });
}

export function reduceWorkspaceFilesPanelLayout(
  state: WorkspaceFilesPanelLayoutState,
  action: WorkspaceFilesPanelLayoutAction,
): WorkspaceFilesPanelLayoutState {
  switch (action.type) {
    case "collapse":
      return {
        ...state,
        treeCollapsed: true,
        treeWidthPx: action.treeWidthPx,
      };
    case "expand":
    case "resize":
      return {
        ...state,
        treeCollapsed: false,
        treeWidthPx: action.treeWidthPx,
      };
    case "select":
      return { ...state, selectedPath: action.selectedPath };
    case "reset-selection":
      return { ...state, selectedPath: null };
  }
}

export function resolveWorkspaceFilesPanelMode(
  state: WorkspaceFilesPanelLayoutState,
): "tree" | "split" | "preview" {
  if (!state.selectedPath) return "tree";
  return state.treeCollapsed ? "preview" : "split";
}
