/** @jsxImportSource react */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ChevronRight,
  Folder,
  FolderOpen,
  PanelLeft,
  PanelLeftClose,
  X,
} from "lucide-react";

import type {
  OnMyAgentServerClient,
  OnMyAgentWorkspaceFileCatalogEntry,
} from "../../../../app/lib/onmyagent-server";
import {
  listCodeWorkspaceFiles,
  readCodeWorkspaceFile,
} from "../../../../app/lib/desktop";
import { t } from "../../../../i18n";
import { isElectronRuntime } from "../../../../app/utils";
import { ArtifactIcon } from "../artifacts/artifact-icon";
import {
  canPreviewOpenTargetInline,
  classifyOpenTarget,
  type OpenTarget,
} from "../artifacts/open-target";
import { PreviewLoading, PreviewUnavailable } from "../artifacts/preview";
import { workspaceFileOpenTarget } from "../artifacts/workspace-file-open-target";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import {
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  type WorkspaceFileTreeNode,
} from "../chat/session-page-files-model";
import { EmbeddedBrowserViewport } from "../browser/browser-panel";

const FILES_TREE_DEFAULT_WIDTH = 220;
const FILES_TREE_MIN_WIDTH = 160;
const FILES_TREE_MAX_WIDTH_PX = 480;

/** Session-lifetime layout for the files tree column. */
let filesTreeLayoutMemory: { widthPx: number; collapsed: boolean } = {
  widthPx: FILES_TREE_DEFAULT_WIDTH,
  collapsed: false,
};

type FilePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "text"; content: string }
  | { status: "browser"; url: string }
  | { status: "unavailable" }
  | { status: "error"; message: string };

function clampTreeWidth(px: number, containerWidth?: number) {
  const maxFromContainer =
    typeof containerWidth === "number" && containerWidth > 0
      ? Math.floor(containerWidth * 0.55)
      : FILES_TREE_MAX_WIDTH_PX;
  const max = Math.max(
    FILES_TREE_MIN_WIDTH,
    Math.min(FILES_TREE_MAX_WIDTH_PX, maxFromContainer),
  );
  return Math.min(
    max,
    Math.max(FILES_TREE_MIN_WIDTH, Math.round(px) || FILES_TREE_DEFAULT_WIDTH),
  );
}

function basenamePath(path: string) {
  return path.split("/").filter(Boolean).at(-1) ?? path;
}

function flattenWorkspaceFileTree(
  node: WorkspaceFileTreeNode,
): OnMyAgentWorkspaceFileCatalogEntry[] {
  return node.children.flatMap((child) => [
    {
      path: child.path,
      kind: child.kind,
      size: child.size,
      mtimeMs: child.mtimeMs,
      revision: "",
    },
    ...flattenWorkspaceFileTree(child),
  ]);
}

function openTargetsToCatalogEntries(
  targets: OpenTarget[] | undefined,
): OnMyAgentWorkspaceFileCatalogEntry[] {
  return (targets ?? []).flatMap((target) => {
    if (target.kind !== "file" || !target.value.trim()) return [];
    return [{
      path: target.value.trim().replace(/\\/g, "/").replace(/^\.\//, ""),
      kind: "file" as const,
      size: target.size ?? 0,
      mtimeMs: target.updatedAt ?? 0,
      revision: "",
    }];
  });
}

function WorkspaceTreeFileIcon(props: { name: string; className?: string }) {
  const preview = classifyOpenTarget(props.name, "file");
  return <ArtifactIcon type={preview} name={props.name} className={props.className} />;
}

function WorkspaceTreeRow(props: {
  node: WorkspaceFileTreeNode;
  level: number;
  expanded: Set<string>;
  selectedPath: string | null;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
}) {
  const isDirectory = props.node.kind === "dir";
  const isExpanded = props.expanded.has(props.node.path);
  const FolderIcon = isExpanded ? FolderOpen : Folder;
  const fullName = props.node.name;

  return (
    <div>
      <button
        type="button"
        className={cn(
          "flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left text-xs text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
          props.selectedPath === props.node.path && "bg-dls-list-selected text-dls-text",
        )}
        style={{ paddingLeft: 8 + props.level * 14 }}
        title={fullName}
        aria-label={fullName}
        aria-expanded={isDirectory ? isExpanded : undefined}
        onClick={() => {
          if (isDirectory) props.onToggle(props.node.path);
          else props.onSelect(props.node.path);
        }}
      >
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition-transform",
            !isDirectory && "opacity-0",
            isExpanded && "rotate-90",
          )}
        />
        {isDirectory ? (
          <FolderIcon
            className="size-3.5 shrink-0 text-dls-text/75"
            strokeWidth={1.75}
            aria-hidden="true"
          />
        ) : (
          <WorkspaceTreeFileIcon name={fullName} className="size-3.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1 truncate">{fullName}</span>
      </button>
      {isDirectory && isExpanded
        ? props.node.children.map((child) => (
            <WorkspaceTreeRow
              key={child.path}
              node={child}
              level={props.level + 1}
              expanded={props.expanded}
              selectedPath={props.selectedPath}
              onToggle={props.onToggle}
              onSelect={props.onSelect}
            />
          ))
        : null}
    </div>
  );
}

function TreeToggleButton(props: {
  collapsed: boolean;
  onCollapse: () => void;
  onExpand: () => void;
}) {
  const label = props.collapsed ? t("files.expand_tree") : t("files.collapse_tree");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            onClick={props.collapsed ? props.onExpand : props.onCollapse}
            aria-label={label}
            aria-expanded={!props.collapsed}
          >
            {props.collapsed ? (
              <PanelLeft className="size-3.5" />
            ) : (
              <PanelLeftClose className="size-3.5" />
            )}
          </Button>
        }
      />
      <TooltipContent side="bottom">
        <span>{label}</span>
      </TooltipContent>
    </Tooltip>
  );
}

export function WorkspaceFilesPanel(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string | null;
  workspaceCatalogRoot: string;
  workspacePath: string;
  fileRoot?: string | null;
  fileTargets?: OpenTarget[];
}) {
  const [tree, setTree] = useState<WorkspaceFileTreeNode | null>(null);
  const [treeLoading, setTreeLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [preview, setPreview] = useState<FilePreviewState>({ status: "idle" });
  const [treeError, setTreeError] = useState<string | null>(null);
  const [loadedDirectories, setLoadedDirectories] = useState<Set<string>>(
    () => new Set(),
  );

  const [treeCollapsed, setTreeCollapsed] = useState(
    () => filesTreeLayoutMemory.collapsed,
  );
  const [treeWidthPx, setTreeWidthPx] = useState(() =>
    clampTreeWidth(filesTreeLayoutMemory.widthPx),
  );
  const splitRowRef = useRef<HTMLDivElement>(null);
  const treeWidthRef = useRef(treeWidthPx);
  treeWidthRef.current = treeWidthPx;

  /** Ignore stale async previews when the user clicks another file quickly. */
  const previewRequestIdRef = useRef(0);
  const loadingDirsRef = useRef<Set<string>>(new Set());

  const scopedFileRoot = props.fileRoot?.trim() ?? "";
  const fileRoot =
    scopedFileRoot ||
    props.workspacePath?.trim() ||
    props.workspaceCatalogRoot?.trim() ||
    "";
  const hasScopedFileRoot = Boolean(scopedFileRoot);
  const requiresSessionFileRoot =
    props.fileRoot !== undefined && !scopedFileRoot && !fileRoot;

  const rootRelativePrefix = useMemo(() => {
    const root = props.workspaceCatalogRoot.replaceAll("\\", "/").replace(/\/+$/, "");
    const selected = fileRoot.replaceAll("\\", "/").replace(/\/+$/, "");
    if (!root || !selected || selected === root) return "";
    return selected.startsWith(`${root}/`) ? selected.slice(root.length + 1) : "";
  }, [fileRoot, props.workspaceCatalogRoot]);

  // Only prefix-filter when listing the catalog without an explicit scoped root.
  const catalogPrefix = hasScopedFileRoot ? "" : rootRelativePrefix;

  const resetSelection = useCallback(() => {
    previewRequestIdRef.current += 1;
    setSelectedPath(null);
    setPreview({ status: "idle" });
  }, []);

  const rememberTreeWidth = useCallback((widthPx: number, collapsed: boolean) => {
    const containerWidth = splitRowRef.current?.getBoundingClientRect().width;
    const next = clampTreeWidth(widthPx, containerWidth);
    setTreeWidthPx(next);
    treeWidthRef.current = next;
    filesTreeLayoutMemory = { widthPx: next, collapsed };
  }, []);

  const collapseTree = useCallback(() => {
    rememberTreeWidth(treeWidthRef.current, true);
    setTreeCollapsed(true);
  }, [rememberTreeWidth]);

  const expandTree = useCallback(() => {
    filesTreeLayoutMemory = { ...filesTreeLayoutMemory, collapsed: false };
    setTreeCollapsed(false);
  }, []);

  /** Pointer-drag splitter between tree and preview (reliable hit target). */
  const startTreeResize = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) return;
      event.preventDefault();
      const handle = event.currentTarget;
      const startX = event.clientX;
      const startWidth = treeWidthRef.current;
      const containerWidth = splitRowRef.current?.getBoundingClientRect().width;
      handle.setPointerCapture(event.pointerId);

      const onMove = (moveEvent: PointerEvent) => {
        const next = clampTreeWidth(
          startWidth + (moveEvent.clientX - startX),
          containerWidth,
        );
        setTreeWidthPx(next);
        treeWidthRef.current = next;
      };
      const onUp = (upEvent: PointerEvent) => {
        try {
          handle.releasePointerCapture(upEvent.pointerId);
        } catch {
          // already released
        }
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        window.removeEventListener("pointercancel", onUp);
        rememberTreeWidth(treeWidthRef.current, false);
      };

      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
      window.addEventListener("pointercancel", onUp);
    },
    [rememberTreeWidth],
  );

  // Load / reload the file tree when the listing root changes.
  useEffect(() => {
    let disposed = false;
    setTreeLoading(true);
    setTreeError(null);
    resetSelection();
    setExpanded(new Set());
    setLoadedDirectories(new Set());
    loadingDirsRef.current = new Set();

    if (!fileRoot.trim()) {
      // No workspace path — fall back to session artifact chips only.
      if (!disposed) {
        setTree(
          filterHiddenFromTree(
            buildWorkspaceFileTree(openTargetsToCatalogEntries(props.fileTargets)),
          ),
        );
        setLoadedDirectories(new Set([""]));
        setTreeLoading(false);
      }
      return () => {
        disposed = true;
      };
    }

    if (isElectronRuntime()) {
      void listCodeWorkspaceFiles({ workspacePath: fileRoot })
        .then((result) => {
          if (disposed) return;
          setTree(
            filterHiddenFromTree(
              buildWorkspaceFileTree(
                result.items.map((item) => ({ ...item, revision: "" })),
              ),
            ),
          );
          setLoadedDirectories(new Set([""]));
          setTreeLoading(false);
        })
        .catch((nextError) => {
          if (disposed) return;
          setTree(null);
          setTreeError(
            nextError instanceof Error ? nextError.message : String(nextError),
          );
          setTreeLoading(false);
        });
      return () => {
        disposed = true;
      };
    }

    if (!props.client || !props.workspaceId) {
      setTree(null);
      setTreeLoading(false);
      return () => {
        disposed = true;
      };
    }

    void props.client
      .listWorkspaceFiles(props.workspaceId, {
        includeDirs: true,
        limit: 10_000,
        ...(fileRoot ? { root: fileRoot } : {}),
        prefix: catalogPrefix || undefined,
      })
      .then((result) => {
        if (disposed) return;
        const prefixWithSlash = catalogPrefix ? `${catalogPrefix}/` : "";
        const items = result.items.flatMap((item) => {
          if (catalogPrefix && item.path === catalogPrefix) return [];
          if (catalogPrefix && !item.path.startsWith(prefixWithSlash)) return [];
          return [{
            ...item,
            path: catalogPrefix ? item.path.slice(prefixWithSlash.length) : item.path,
          }];
        });
        const nextTree = filterHiddenFromTree(buildWorkspaceFileTree(items));
        setTree(nextTree);
        // Server listing is flat/eager — open top-level folders for discoverability.
        setExpanded(
          new Set(
            nextTree.children
              .filter((node) => node.kind === "dir")
              .map((node) => node.path),
          ),
        );
        setTreeLoading(false);
      })
      .catch((nextError) => {
        if (disposed) return;
        setTree(null);
        setTreeError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
        setTreeLoading(false);
      });

    return () => {
      disposed = true;
    };
  }, [
    catalogPrefix,
    fileRoot,
    props.client,
    props.fileTargets,
    props.workspaceId,
    resetSelection,
  ]);

  const selectFile = useCallback(
    async (path: string) => {
      // Re-clicking the same file keeps current preview (no flicker).
      if (path === selectedPath && preview.status !== "idle" && preview.status !== "error") {
        return;
      }

      const requestId = ++previewRequestIdRef.current;
      const browserFileRoot = fileRoot || props.workspacePath;
      const fileName = basenamePath(path);
      const target = workspaceFileOpenTarget({
        fileRoot: browserFileRoot,
        path,
        name: fileName,
        size: 0,
        mtimeMs: 0,
      });

      setSelectedPath(path);
      setTreeError(null);

      // Browser-openable (e.g. html) — embedded viewport.
      if (isElectronRuntime() && browserFileRoot && target.kind === "url") {
        if (previewRequestIdRef.current !== requestId) return;
        setPreview({ status: "browser", url: target.value });
        return;
      }

      // Office / binary / media: select only, no byte dump.
      if (!canPreviewOpenTargetInline(target)) {
        if (previewRequestIdRef.current !== requestId) return;
        setPreview({ status: "unavailable" });
        return;
      }

      const canReadLocal = isElectronRuntime() && Boolean(fileRoot);
      const canReadRemote = Boolean(props.client && props.workspaceId);
      if (!canReadLocal && !canReadRemote) {
        if (previewRequestIdRef.current !== requestId) return;
        setPreview({ status: "idle" });
        return;
      }

      setPreview({ status: "loading" });
      try {
        let content: string;
        if (canReadLocal) {
          const result = await readCodeWorkspaceFile({
            workspacePath: fileRoot,
            relativePath: path,
          });
          content = result.content;
        } else {
          const client = props.client;
          const workspaceId = props.workspaceId;
          if (!client || !workspaceId) return;
          const result = await client.readWorkspaceFile(
            workspaceId,
            rootRelativePrefix ? `${rootRelativePrefix}/${path}` : path,
          );
          content = result.content;
        }
        if (previewRequestIdRef.current !== requestId) return;
        setPreview({ status: "text", content });
      } catch (nextError) {
        if (previewRequestIdRef.current !== requestId) return;
        setPreview({
          status: "error",
          message:
            nextError instanceof Error ? nextError.message : String(nextError),
        });
      }
    },
    [
      fileRoot,
      preview.status,
      props.client,
      props.workspaceId,
      props.workspacePath,
      rootRelativePrefix,
      selectedPath,
    ],
  );

  const toggleDirectory = useCallback(
    async (path: string) => {
      setExpanded((current) => {
        const next = new Set(current);
        if (next.has(path)) next.delete(path);
        else next.add(path);
        return next;
      });

      // Lazy-load children only in desktop local listing mode.
      if (!isElectronRuntime() || !fileRoot) return;
      if (loadedDirectories.has(path) || loadingDirsRef.current.has(path)) return;

      loadingDirsRef.current.add(path);
      try {
        const result = await listCodeWorkspaceFiles({
          workspacePath: fileRoot,
          relativePath: path,
        });
        setTree((current) => {
          if (!current) return current;
          const entries = [
            ...flattenWorkspaceFileTree(current),
            ...result.items.map((item) => ({ ...item, revision: "" })),
          ];
          return filterHiddenFromTree(buildWorkspaceFileTree(entries));
        });
        setLoadedDirectories((current) => new Set(current).add(path));
      } catch (nextError) {
        setTreeError(
          nextError instanceof Error ? nextError.message : String(nextError),
        );
      } finally {
        loadingDirsRef.current.delete(path);
      }
    },
    [fileRoot, loadedDirectories],
  );

  const selectedName = selectedPath ? basenamePath(selectedPath) : null;
  /** Preview pane only mounts after the user picks a file — no empty detail column on open. */
  const detailOpen = Boolean(selectedPath);

  const treeBody = treeLoading ? (
    <div className="flex h-full min-h-24 flex-col items-center justify-center gap-2 px-3 py-8 text-dls-secondary">
      <LoadingSpinner size="default" />
      <p className="text-xs">{t("files.loading")}</p>
    </div>
  ) : treeError && !tree?.children.length ? (
    <div className="px-3 py-6 text-center text-xs text-dls-secondary">
      {treeError}
    </div>
  ) : tree?.children.length ? (
    tree.children.map((node) => (
      <WorkspaceTreeRow
        key={node.path}
        node={node}
        level={0}
        expanded={expanded}
        selectedPath={selectedPath}
        onSelect={(path) => void selectFile(path)}
        onToggle={(path) => void toggleDirectory(path)}
      />
    ))
  ) : (
    <div className="flex flex-col items-center gap-2 px-3 py-8 text-center">
      <div
        className="flex size-10 items-center justify-center rounded-xl bg-dls-surface-muted text-dls-secondary ring-1 ring-dls-border/60"
        aria-hidden="true"
      >
        <FolderOpen className="size-5" strokeWidth={1.5} />
      </div>
      <p className="text-xs font-medium text-dls-text">
        {requiresSessionFileRoot
          ? t("files.no_session_files")
          : t("files.no_files")}
      </p>
      <p className="text-xs leading-4 text-dls-secondary">
        {requiresSessionFileRoot
          ? t("files.no_session_files_hint")
          : t("files.no_files_hint")}
      </p>
    </div>
  );

  const previewBody =
    preview.status === "loading" ? (
      <PreviewLoading />
    ) : preview.status === "error" ? (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-4 font-mono text-xs leading-5 text-dls-text">
        {preview.message}
      </pre>
    ) : preview.status === "unavailable" ? (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 px-6 text-center">
        {selectedName ? (
          <WorkspaceTreeFileIcon name={selectedName} className="size-8" />
        ) : null}
        <PreviewUnavailable className="text-center" />
      </div>
    ) : preview.status === "browser" ? (
      <EmbeddedBrowserViewport
        url={preview.url}
        announcePanelOpen={false}
        className="min-h-0 flex-1 overflow-hidden bg-dls-surface"
      />
    ) : preview.status === "text" ? (
      <pre className="min-h-0 flex-1 overflow-auto whitespace-pre p-4 font-mono text-xs leading-5 text-dls-text">
        {preview.content}
      </pre>
    ) : (
      <div className="flex min-h-0 flex-1 items-center justify-center px-6 text-center text-sm text-dls-secondary">
        {t("files.preview_empty")}
      </div>
    );

  const previewHeader = (
    <div className="flex h-9 shrink-0 items-center gap-1 border-b border-dls-border px-2">
      {treeCollapsed ? (
        <TreeToggleButton
          collapsed
          onCollapse={collapseTree}
          onExpand={expandTree}
        />
      ) : null}
      <div
        className="min-w-0 flex-1 truncate px-1 text-xs text-dls-secondary"
        title={selectedPath ?? undefined}
      >
        {selectedPath ?? t("session.code_side_panel_files")}
      </div>
      {detailOpen && !treeCollapsed ? (
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="shrink-0 text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          onClick={resetSelection}
          aria-label={t("files.close_preview")}
          title={t("files.close_preview")}
        >
          <X className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );

  const treeColumn = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-9 shrink-0 items-center justify-between gap-1 border-b border-dls-border px-2">
        <span className="truncate px-1 text-xs font-medium text-dls-secondary">
          {t("session.code_side_panel_files")}
        </span>
        {/* Collapse only when a detail pane is open (otherwise tree is already full-width). */}
        {detailOpen ? (
          <TreeToggleButton
            collapsed={false}
            onCollapse={collapseTree}
            onExpand={expandTree}
          />
        ) : null}
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">{treeBody}</div>
    </div>
  );

  // No file selected → tree only (do not reserve an empty detail column).
  if (!detailOpen) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-dls-background">
        {treeColumn}
      </div>
    );
  }

  // Detail open + tree collapsed → preview only.
  if (treeCollapsed) {
    return (
      <div className="flex h-full min-h-0 flex-col bg-dls-background">
        {previewHeader}
        {previewBody}
      </div>
    );
  }

  // Detail open + tree visible → custom splitter (file-tree | preview).
  // Pointer drag on a real wide hit target — more reliable than 1px ResizableHandle.
  return (
    <div
      ref={splitRowRef}
      className="flex h-full min-h-0 bg-dls-background"
    >
      <div
        className="min-h-0 shrink-0 overflow-hidden"
        style={{ width: treeWidthPx }}
      >
        {treeColumn}
      </div>

      <div
        role="separator"
        aria-orientation="vertical"
        aria-label={t("files.resize_tree")}
        tabIndex={0}
        onPointerDown={startTreeResize}
        onKeyDown={(event) => {
          if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
          event.preventDefault();
          const delta = event.key === "ArrowLeft" ? -16 : 16;
          rememberTreeWidth(treeWidthRef.current + delta, false);
        }}
        className={cn(
          "group relative z-20 hidden w-2 shrink-0 cursor-col-resize touch-none outline-none sm:block",
          "focus-visible:outline-none",
        )}
      >
        {/* Single painted rule centered in the grab strip */}
        <div
          className={cn(
            "pointer-events-none absolute inset-y-0 left-1/2 w-px -translate-x-1/2",
            "bg-dls-border/70 transition-colors",
            "group-hover:bg-dls-border-strong group-active:bg-dls-accent",
            "group-focus-visible:bg-dls-accent",
          )}
        />
      </div>

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        {previewHeader}
        {previewBody}
      </div>
    </div>
  );
}
