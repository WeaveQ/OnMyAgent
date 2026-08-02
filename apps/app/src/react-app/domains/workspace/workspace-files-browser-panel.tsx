/** @jsxImportSource react */
/**
 * Workspace catalog browser — used under Task files for historical compatibility
 * until write-time provenance (P1) can filter assistant_task vs expert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  CirclePlus,
  Cloud,
  Copy,
  FileSearch,
  FileStack,
  Folder,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  TableBody,
  TableCell,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { typeScale } from "@/react-app/design-system/type-scale";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import {
  listCodeWorkspaceFiles,
  revealDesktopItemInDir,
} from "../../../app/lib/desktop";
import type {
  OnMyAgentServerClient,
  OnMyAgentWorkspaceFileCatalogEntry,
} from "../../../app/lib/onmyagent-server";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import { FilesTreeDirRow } from "./workspace-files-tree-dir-row";
import {
  canEditArtifactTarget,
  openArtifactForEditing,
} from "../../capabilities/artifacts/open-artifact-for-editing";
import {
  type OpenTarget,
} from "../../capabilities/artifacts/open-target";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";
import {
  FilePreviewDrawer,
  type WorkspaceFilePreviewNode,
  type WorkspaceFilePreviewState,
} from "./workspace-files-preview-drawer";
import {
  buildWorkspaceFileTree,
  pruneEmptyDirectoriesFromTree,
  filterHiddenFromTree,
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
  shouldHideEntry,
  sortTaskSourceTreeCopy,
  sortWorkspaceFileTreeCopy,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import {
  FilesSortableTableHeader,
  useFilesTableSort,
} from "./workspace-files-table-sort";
import {
  FILE_PREVIEW_SELECTION_DEBOUNCE_MS,
  shouldForceExternalPreviewForSize,
} from "../../capabilities/artifacts/file-preview-policy";
import {
  resolveOpenSourceSessionAction,
  type SourceSessionStatus,
} from "./workspace-files-open-session";
import { FilesRefreshButton } from "./workspace-files-chrome";
import {
  FILE_CATEGORIES,
  WORKSPACE_FILES_CATALOG_LIMIT,
  buildTreeOutlineRows,
  buildUngroupedFolderNode,
  canPreviewWorkspaceFileInline,
  collectExpandableDirPaths,
  collectMatchingFilesUnder,
  fileCategoryLabel,
  filesSourceTabSubtitleKey,
  filesSourceTabTitleKey,
  filterWorkspaceFileTree,
  filterWorkspaceTreeBySourceTab,
  formatWorkspaceFolderDisplayName,
  getFileCategory,
  isAutomationTaskFolderName,
  isFilesUngroupedPath,
  relativeDisplayPath,
  usesLocalFileRenderer,
  type FileCategory,
  type TreeOutlineRow,
} from "./workspace-files-model";

function folderDisplayName(node: WorkspaceFileTreeNode): string {
  if (isFilesUngroupedPath(node.path)) return t("files.ungrouped");
  return formatWorkspaceFolderDisplayName(node.name, node.mtimeMs);
}

function FileKindIcon(props: { node: WorkspaceFileTreeNode; fileRoot: string }) {
  if (props.node.kind === "dir") {
    if (isFilesUngroupedPath(props.node.path)) {
      return (
        <FileStack
          className="size-4 shrink-0 text-dls-secondary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      );
    }
    return (
      <Folder
        className="size-4 shrink-0 text-dls-text opacity-100"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    );
  }
  const target = workspaceFileOpenTarget({
    fileRoot: props.fileRoot || "/",
    path: props.node.path,
    name: props.node.name,
    size: props.node.size,
    mtimeMs: props.node.mtimeMs,
  });
  return (
    <ArtifactIcon
      type={target.preview}
      name={props.node.name}
      className="size-4 shrink-0"
    />
  );
}

type FileNode = WorkspaceFilePreviewNode;
type FilePreviewState = WorkspaceFilePreviewState;

function FilesListEmptyState(props: {
  filtered: boolean;
  sessionScoped: boolean;
}) {
  const Icon = props.filtered ? FileSearch : props.sessionScoped ? FileStack : FolderOpen;
  const title = props.filtered
    ? t("files.no_matching_files")
    : props.sessionScoped
      ? t("files.no_session_files")
      : t("files.no_files");
  const description = props.filtered
    ? t("files.no_matching_files_hint")
    : props.sessionScoped
      ? t("files.no_session_files_hint")
      : t("files.no_files_hint");

  return (
    <div className="flex min-h-56 flex-1 items-center justify-center px-6 py-12">
      <Empty className="max-w-sm flex-none border-0 bg-transparent p-0" variant="ghost">
        <EmptyHeader>
          <EmptyMedia
            variant="icon"
            className="mb-3 size-14 rounded-2xl bg-dls-surface-muted/80 text-dls-secondary shadow-sm ring-1 ring-dls-border/60 [&_svg]:size-7"
          >
            <Icon aria-hidden="true" strokeWidth={1.5} />
          </EmptyMedia>
          <EmptyTitle className="text-sm font-medium text-dls-text">
            {title}
          </EmptyTitle>
          <EmptyDescription className="mt-1 text-xs leading-5 text-dls-secondary">
            {description}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}


const FILE_FAVORITES_STORAGE_KEY = "onmyagent.files.favorites.v1";

function readFavoritePaths(workspaceId: string): Set<string> {
  if (typeof window === "undefined" || !workspaceId.trim()) return new Set();
  try {
    const raw = window.localStorage.getItem(FILE_FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const list = parsed[workspaceId.trim()];
    return new Set(Array.isArray(list) ? list.filter((p) => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

function writeFavoritePaths(workspaceId: string, paths: Set<string>) {
  if (typeof window === "undefined" || !workspaceId.trim()) return;
  try {
    const raw = window.localStorage.getItem(FILE_FAVORITES_STORAGE_KEY);
    const parsed =
      raw && raw.trim()
        ? (JSON.parse(raw) as Record<string, string[]>)
        : {};
    parsed[workspaceId.trim()] = Array.from(paths);
    window.localStorage.setItem(FILE_FAVORITES_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage failures
  }
}

/** Inline quick actions after the file/folder name (hover row → show; hover icon → tooltip).
 * Add-to-conversation is only for concrete files, not folders.
 */
function FileNameQuickActions(props: {
  path: string;
  favorited: boolean;
  /** Files only — folders omit the add-to-conversation control. */
  showAddToTask?: boolean;
  onAddToTask?: () => void;
  onOpenInFolder: () => void;
  onToggleFavorite: () => void;
}) {
  const quickBtnClass =
    "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-dls-secondary opacity-0 transition-[opacity,color,background-color,transform] duration-150 hover:bg-dls-hover hover:text-dls-text hover:scale-105 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30";
  const iconClass = "size-4";
  const favoriteLabel = props.favorited
    ? t("files.unfavorite")
    : t("files.favorite");
  const showAdd = Boolean(props.showAddToTask && props.onAddToTask);

  return (
    <span className="ms-1 inline-flex shrink-0 items-center gap-1.5">
      {showAdd ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={quickBtnClass}
                aria-label={t("files.add_to_task")}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onAddToTask?.();
                }}
              />
            }
          >
            <CirclePlus className={iconClass} strokeWidth={1.75} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {t("files.add_to_task")}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={quickBtnClass}
              aria-label={t("files.open_folder")}
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenInFolder();
              }}
            />
          }
        >
          <FolderOpen className={iconClass} strokeWidth={1.75} aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {t("files.open_folder")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={cn(
                quickBtnClass,
                props.favorited && "text-dls-accent opacity-100",
              )}
              aria-label={favoriteLabel}
              aria-pressed={props.favorited}
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleFavorite();
              }}
            />
          }
        >
          <Star
            className={iconClass}
            strokeWidth={1.75}
            aria-hidden
            fill={props.favorited ? "currentColor" : "none"}
          />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {favoriteLabel}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

function openSourceSessionLabel(status: SourceSessionStatus): string {
  if (status === "archived") return t("files.open_source_session_archived");
  if (status === "missing") return t("files.open_source_session_missing");
  return t("files.open_source_session");
}

function FileRowActionsMenu(props: {
  name: string;
  pathCopied: boolean;
  favorited: boolean;
  openSourceSession?: {
    status: SourceSessionStatus;
    canOpen: boolean;
  } | null;
  onOpenSourceSession?: () => void;
  onOpenInFolder: () => void;
  onAddToTask: () => void;
  onToggleFavorite: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
  const openSession = props.openSourceSession;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            onClick={(event) => event.stopPropagation()}
            className="text-dls-secondary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
            aria-label={t("files.file_actions", { name: props.name })}
          >
            <MoreHorizontal className="size-4" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-44">
        {/* Hope-style order: cloud first, then add-to-task / open folder / favorite */}
        <DropdownMenuItem disabled className="opacity-60">
          <Cloud />
          {t("files.upload_to_cloud_soon")}
        </DropdownMenuItem>
        {openSession && openSession.status !== "none" ? (
          <DropdownMenuItem
            disabled={!openSession.canOpen || !props.onOpenSourceSession}
            title={
              openSession.status === "missing"
                ? t("files.open_source_session_missing")
                : undefined
            }
            data-files-open-source-session="true"
            onClick={(event) => {
              event.stopPropagation();
              if (!openSession.canOpen) return;
              props.onOpenSourceSession?.();
            }}
          >
            <MessageSquare />
            {openSourceSessionLabel(openSession.status)}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onAddToTask();
          }}
        >
          <CirclePlus />
          {t("files.add_to_task")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenInFolder();
          }}
        >
          <FolderOpen />
          {t("files.open_folder")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleFavorite();
          }}
        >
          <Star fill={props.favorited ? "currentColor" : "none"} />
          {props.favorited ? t("files.unfavorite") : t("files.favorite")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onCopyPath();
          }}
        >
          <Copy />
          {props.pathCopied ? t("files.copied") : t("files.copy_path")}
        </DropdownMenuItem>
        <DropdownMenuItem
          variant="destructive"
          onClick={(event) => {
            event.stopPropagation();
            props.onDelete();
          }}
        >
          <Trash2 />
          {t("common.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceFilesBrowserPanel(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  /**
   * Live session ids that can be opened from Files (Tasks / Experts).
   */
  activeSessionIds?: ReadonlySet<string> | readonly string[] | null;
  /**
   * Soft-archived session ids — still openable; label uses archived copy.
   */
  archivedSessionIds?: ReadonlySet<string> | readonly string[] | null;
  /**
   * Optional session id → title for outline rows (~10-char truncate + hover full).
   */
  sessionTitleByKey?: ReadonlyMap<string, string> | Record<string, string> | null;
  /**
   * Path / folder aliases → real session id (e.g. automation group folders).
   */
  sessionIdByPathKey?: ReadonlyMap<string, string> | Record<string, string> | null;
  /**
   * Navigate to the conversation that produced a file/session folder.
   */
  onOpenSourceSession?: (sessionId: string) => void;
  /**
   * Directory to list. Callers should pass the OnMyAgent-selected workspace
   * folder (`workspaceRoot`) so the list does not follow session/tool context.
   * When omitted, falls back to `workspaceRoot`.
   */
  fileRoot?: string | null;
  /**
   * Split top-level folders: task = non-expert archives; expert = expert agent dirs.
   */
  sourceTab?: "task" | "expert";
  /** Optional marketplace packageName slugs for stronger expert-folder matching. */
  knownExpertPackageSlugs?: readonly string[];
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onEditError?: () => void;
  /** Optional: attach file into a new/current task (composer). */
  onAddToTask?: (relativePath: string) => void;
  /** WP3: @mention + instruction for agent about any file type. */
  onAskAgentAboutFile?: (input: {
    path: string;
    name: string;
    preview: string;
  }) => void;
}) {
  const sourceTab = props.sourceTab ?? "task";
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<OnMyAgentWorkspaceFileCatalogEntry[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [catalogTruncated, setCatalogTruncated] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  /** Brief success flash after a user-initiated refresh (not first mount). */
  const [refreshDone, setRefreshDone] = useState(false);
  const manualRefreshRef = useRef(false);
  const refreshDoneTimerRef = useRef<number | null>(null);
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);
  const [typeFilter, setTypeFilter] = useState<FileCategory>("all");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [previewState, setPreviewState] = useState<FilePreviewState>({ status: "idle" });
  /**
   * Tasks/Experts are a conversation outline — expand/collapse in place.
   * No folder drill-in (unlike Mine). Session rows open the source chat.
   */
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const [pathCopiedFlash, setPathCopiedFlash] = useState<string | null>(null);
  const [favoritePaths, setFavoritePaths] = useState<Set<string>>(
    () => readFavoritePaths(props.workspaceId),
  );
  const { sortKey, sortDir, toggleSort } = useFilesTableSort();
  const workspaceRootNormalized = props.workspaceRoot.trim().replace(/[\\/]+$/, "");
  const fileRoot =
    props.fileRoot === undefined
      ? props.workspaceRoot.trim()
      : props.fileRoot?.trim() ?? "";
  const hasScopedFileRoot = props.fileRoot !== undefined && Boolean(fileRoot);
  // Scoped tool/session folder (not the app workspace vault root).
  const toolFolderScoped =
    hasScopedFileRoot &&
    Boolean(fileRoot) &&
    fileRoot.replace(/[\\/]+$/, "") !== workspaceRootNormalized;
  const requiresSessionFileRoot = toolFolderScoped;

  const selectedTarget = useMemo(() => {
    if (!selectedFile) return null;
    return workspaceFileOpenTarget({
      fileRoot,
      path: selectedFile.path,
      name: selectedFile.name,
      size: selectedFile.size,
      mtimeMs: selectedFile.mtimeMs,
    });
  }, [fileRoot, selectedFile]);

  useEffect(() => {
    if (!fileRoot.trim()) {
      setEntries([]);
      setError(null);
      setLoading(false);
      manualRefreshRef.current = false;
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);

    const finishRefreshFlash = () => {
      if (!manualRefreshRef.current) return;
      manualRefreshRef.current = false;
      setRefreshDone(true);
      if (refreshDoneTimerRef.current != null) {
        window.clearTimeout(refreshDoneTimerRef.current);
      }
      refreshDoneTimerRef.current = window.setTimeout(() => {
        setRefreshDone(false);
        refreshDoneTimerRef.current = null;
      }, 1400);
    };

    // Always recursive from workspace root. Outline folders previously used a
    // shallow list (top-level dirs only) so every badge said "0 files" and
    // expand showed no children. Navigation is client-side via the tree.
    const load = async (): Promise<OnMyAgentWorkspaceFileCatalogEntry[]> => {
      if (isElectronRuntime()) {
        const result = await listCodeWorkspaceFiles({
          workspacePath: fileRoot,
          recursive: true,
        });
        return result.items.map((item) => ({
          path: item.path,
          kind: item.kind,
          size: item.size,
          mtimeMs: item.mtimeMs,
          revision: "",
        }));
      }

      if (!props.client || !props.workspaceId.trim()) {
        throw new Error(t("files.load_failed"));
      }

      const catalog = await props.client.listWorkspaceFiles(props.workspaceId, {
        includeDirs: true,
        limit: WORKSPACE_FILES_CATALOG_LIMIT,
        shallow: false,
        ...(hasScopedFileRoot ? { root: fileRoot } : {}),
      });
      return catalog.items;
    };

    void load()
      .then((items) => {
        if (cancelled) return;
        setEntries(items);
        setCatalogTruncated(items.length >= WORKSPACE_FILES_CATALOG_LIMIT);
        finishRefreshFlash();
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        manualRefreshRef.current = false;
        setRefreshDone(false);
        setCatalogTruncated(false);
        setError(
          loadError instanceof Error ? loadError.message : t("files.load_failed"),
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [fileRoot, hasScopedFileRoot, props.client, props.workspaceId, refreshKey]);

  useEffect(() => {
    return () => {
      if (refreshDoneTimerRef.current != null) {
        window.clearTimeout(refreshDoneTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setSelectedFile(null);
    setPreviewState({ status: "idle" });
    setExpandedPaths(new Set());
  }, [fileRoot, props.workspaceId, sourceTab]);

  useEffect(() => {
    // Filters flatten the outline; reset expand state when filters change.
    setExpandedPaths(new Set());
  }, [query, typeFilter]);

  // WP4: debounce selection so rapid row clicks don't thrash preview loads.
  const [previewSelection, setPreviewSelection] = useState<{
    file: FileNode | null;
    target: OpenTarget | null;
  }>({ file: null, target: null });
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPreviewSelection({ file: selectedFile, target: selectedTarget });
    }, FILE_PREVIEW_SELECTION_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [selectedFile, selectedTarget]);

  useEffect(() => {
    const activeFile = previewSelection.file;
    const activeTarget = previewSelection.target;
    if (!props.client || !props.workspaceId.trim() || !activeTarget || !activeFile) {
      setPreviewState({ status: "idle" });
      return;
    }

    if (activeTarget.preview === "browser") {
      setPreviewState({ status: "browser" });
      return;
    }

    if (!canPreviewWorkspaceFileInline(activeTarget)) {
      setPreviewState({ status: "external" });
      return;
    }

    // Local office overlay (Electron) reads from disk — skip size force-out for
    // pptx/docx/xlsx so large decks still open in-app like before.
    const localOfficeOverlay =
      usesLocalFileRenderer(activeTarget) &&
      isElectronRuntime() &&
      Boolean(fileRoot.trim());

    if (
      !localOfficeOverlay &&
      shouldForceExternalPreviewForSize({
        sizeBytes: activeFile.size,
        preview: activeTarget.preview,
      })
    ) {
      setPreviewState({ status: "too_large" });
      return;
    }

    let cancelled = false;
    setPreviewState({ status: "loading" });

    if (activeTarget.preview === "image") {
      let objectUrl: string | null = null;
      void props.client
        .downloadWorkspaceFile(props.workspaceId, activeTarget.value)
        .then((result) => {
          if (cancelled) return;
          objectUrl = URL.createObjectURL(new Blob([result.data], {
            type: result.contentType ?? "application/octet-stream",
          }));
          setPreviewState({ status: "binary", url: objectUrl });
        })
        .catch((previewError: unknown) => {
          if (cancelled) return;
          setPreviewState({
            status: "error",
            message: previewError instanceof Error ? previewError.message : t("files.preview_failed"),
          });
        });

      return () => {
        cancelled = true;
        if (objectUrl) URL.revokeObjectURL(objectUrl);
      };
    }

    const previewRequest = usesLocalFileRenderer(activeTarget)
      ? Promise.resolve({
          status: "local" as const,
          filePath: activeFile.path.startsWith("/")
            ? activeFile.path
            : `${fileRoot.replace(/[/\\]+$/, "")}/${activeFile.path.replace(/^[/\\]+/, "")}`,
          revision: activeTarget.updatedAt ?? Date.now(),
        })
      : props.client
          .readWorkspaceFile(props.workspaceId, activeTarget.value)
          .then((result) => ({ status: "ready" as const, content: result.content }));

    void previewRequest
      .then((state) => {
        if (!cancelled) setPreviewState(state);
      })
      .catch((previewError: unknown) => {
        if (cancelled) return;
        setPreviewState({
          status: "error",
          message: previewError instanceof Error ? previewError.message : t("files.preview_failed"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [fileRoot, previewSelection, props.client, props.workspaceId]);

  const visibleFileTree = useMemo(() => {
    // Hide system markers, then drop empty dirs (e.g. expert sessions with only
    // onmyagent-session.json) so Files only shows folders with real content.
    const tree = pruneEmptyDirectoriesFromTree(
      filterHiddenFromTree(
        buildWorkspaceFileTree(
          entries.filter((entry) => !shouldHideEntry(entry.path)),
        ),
      ),
    );
    const bySource = filterWorkspaceTreeBySourceTab(
      tree,
      sourceTab,
      props.knownExpertPackageSlugs ?? [],
    );
    const filtered = filterWorkspaceFileTree(bySource, query, typeFilter) ?? {
      ...bySource,
      children: [],
    };
    // Task tab: keep user spaces (projects/) above automation runs.
    if (sourceTab === "task") {
      return sortTaskSourceTreeCopy(
        filtered,
        sortKey,
        sortDir,
        isAutomationTaskFolderName,
      );
    }
    return sortWorkspaceFileTreeCopy(filtered, sortKey, sortDir);
  }, [
    entries,
    props.knownExpertPackageSlugs,
    query,
    sortDir,
    sortKey,
    sourceTab,
    typeFilter,
  ]);

  /**
   * Root-level files not under a session folder → ungrouped outline bucket.
   */
  const ungroupedFolder = useMemo(() => {
    const loose = visibleFileTree.children.filter((child) => child.kind === "file");
    if (loose.length === 0) return null;
    return buildUngroupedFolderNode(loose, t("files.ungrouped"));
  }, [visibleFileTree]);

  const filterActive = typeFilter !== "all" || Boolean(query.trim());

  /** Outline roots: task/project folders + optional ungrouped bucket. */
  const browseRoots = useMemo((): WorkspaceFileTreeNode[] => {
    const dirs = visibleFileTree.children.filter((child) => child.kind === "dir");
    return ungroupedFolder ? [...dirs, ungroupedFolder] : dirs;
  }, [ungroupedFolder, visibleFileTree]);

  /** Search/type filter → flat matching files across the catalog. */
  const filteredFlatNodes = useMemo(() => {
    if (!filterActive) return [] as WorkspaceFileTreeNode[];
    return collectMatchingFilesUnder(
      visibleFileTree,
      query,
      typeFilter,
      sortKey,
      sortDir,
    );
  }, [filterActive, query, sortDir, sortKey, typeFilter, visibleFileTree]);

  const expandableDirPaths = useMemo(
    () => collectExpandableDirPaths(browseRoots),
    [browseRoots],
  );

  /** Always an in-place conversation outline (unless filtering). */
  const treeRows = useMemo((): TreeOutlineRow[] => {
    if (filterActive) return [];
    return buildTreeOutlineRows(browseRoots, expandedPaths, {
      sessionTitleByKey: props.sessionTitleByKey ?? undefined,
    });
  }, [browseRoots, expandedPaths, filterActive, props.sessionTitleByKey]);

  const listedNodes = filterActive ? filteredFlatNodes : ([] as WorkspaceFileTreeNode[]);

  const treeAllExpanded =
    expandableDirPaths.length > 0 &&
    expandableDirPaths.every((path) => expandedPaths.has(path));

  const canExpandDeep = expandableDirPaths.length > 0;

  const toggleTreeExpanded = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAllTree = useCallback(() => {
    setExpandedPaths(new Set(expandableDirPaths));
  }, [expandableDirPaths]);

  const collapseAllTree = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const openSessionForPath = useCallback(
    (relativePath: string) => {
      const action = resolveOpenSourceSessionAction({
        relativePath,
        activeSessionIds: props.activeSessionIds,
        archivedSessionIds: props.archivedSessionIds,
        sessionIdByPathKey: props.sessionIdByPathKey,
      });
      if (action.canOpen && action.sessionId) {
        props.onOpenSourceSession?.(action.sessionId);
      }
    },
    [
      props.activeSessionIds,
      props.archivedSessionIds,
      props.sessionIdByPathKey,
      props.onOpenSourceSession,
    ],
  );

  const openSourceForPath = useCallback(
    (relativePath: string) =>
      resolveOpenSourceSessionAction({
        relativePath,
        activeSessionIds: props.activeSessionIds,
        archivedSessionIds: props.archivedSessionIds,
        sessionIdByPathKey: props.sessionIdByPathKey,
      }),
    [
      props.activeSessionIds,
      props.archivedSessionIds,
      props.sessionIdByPathKey,
    ],
  );

  const absoluteForPath = useCallback(
    (relativePath: string) =>
      relativePath.startsWith("/")
        ? relativePath
        : `${fileRoot.replace(/[/\\]+$/, "")}/${relativePath.replace(/^[/\\]+/, "")}`,
    [fileRoot],
  );

  const openArtifactTarget = useCallback(
    async (target: OpenTarget) => {
      const abs =
        target.kind === "file" && target.value
          ? absoluteForPath(target.value)
          : "";
      try {
        if (abs && isElectronRuntime()) {
          const { openWorkspaceFileExternally } = await import(
            "./workspace-files-open-external"
          );
          await openWorkspaceFileExternally({
            absolutePath: abs,
            fileName: target.name || target.value || "",
          });
          return;
        }
        await props.onOpenArtifact?.(target);
      } catch (openError) {
        setPreviewState({
          status: "error",
          message: openError instanceof Error ? openError.message : t("files.preview_failed"),
        });
      }
    },
    [absoluteForPath, props.onOpenArtifact],
  );

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      try {
        await revealDesktopItemInDir(absoluteForPath(filePath));
      } catch (openError) {
        console.error("Failed to open directory:", openError);
      }
    },
    [absoluteForPath],
  );

  const handleCopyFilePath = useCallback(
    async (filePath: string) => {
      try {
        await navigator.clipboard.writeText(absoluteForPath(filePath));
        setPathCopiedFlash(filePath);
        window.setTimeout(() => setPathCopiedFlash(null), 1600);
      } catch (copyError) {
        console.error("Failed to copy path:", copyError);
      }
    },
    [absoluteForPath],
  );

  /** Prefer path for composer attach; falls back to clipboard for “add to task”. */
  const handleAddToTask = useCallback(
    async (filePath: string) => {
      if (props.onAddToTask) {
        props.onAddToTask(filePath);
        return;
      }
      await handleCopyFilePath(filePath);
    },
    [handleCopyFilePath, props],
  );

  useEffect(() => {
    setFavoritePaths(readFavoritePaths(props.workspaceId));
  }, [props.workspaceId]);

  const handleToggleFavorite = useCallback(
    (path: string) => {
      const key = path.trim();
      if (!key) return;
      setFavoritePaths((current) => {
        const next = new Set(current);
        if (next.has(key)) next.delete(key);
        else next.add(key);
        writeFavoritePaths(props.workspaceId, next);
        return next;
      });
    },
    [props.workspaceId],
  );

  const handleEditFile = useCallback(
    async (filePath: string) => {
      try {
        await openArtifactForEditing(filePath);
      } catch {
        props.onEditError?.();
      }
    },
    [props.onEditError],
  );

  const handleDeleteFile = useCallback((file: FileNode) => {
    setPendingDelete(file);
  }, []);

  const confirmDelete = useCallback(async () => {
    const file = pendingDelete;
    if (!file || !props.client || !props.workspaceId.trim()) {
      setPendingDelete(null);
      return;
    }
    try {
      await props.client.deleteWorkspaceFile(props.workspaceId, file.path, {
        ...(hasScopedFileRoot ? { root: fileRoot } : {}),
      });
      setRefreshKey((key) => key + 1);
      if (selectedFile?.path === file.path) {
        setSelectedFile(null);
      }
    } catch (deleteError) {
      console.error("Failed to delete file:", deleteError);
    }
    setPendingDelete(null);
  }, [fileRoot, hasScopedFileRoot, pendingDelete, props.client, props.workspaceId, selectedFile?.path]);

  const handleSelectFile = useCallback(
    async (file: FileNode) => {
      setSelectedFile(file);
      const target = workspaceFileOpenTarget({
        fileRoot,
        path: file.path,
        name: file.name,
        size: file.size,
        mtimeMs: file.mtimeMs,
      });
      if (target.preview === "browser") {
        await openArtifactTarget(target);
      } else if (!canPreviewWorkspaceFileInline(target)) {
        await openArtifactTarget(target);
      }
    },
    [fileRoot, openArtifactTarget],
  );

  const closePreview = useCallback(() => {
    setSelectedFile(null);
    setPreviewState({ status: "idle" });
    setCopiedPath(false);
  }, []);

  const handleCopyPath = useCallback(async () => {
    if (!selectedFile) return;
    const absolute = selectedFile.path.startsWith("/")
      ? selectedFile.path
      : `${fileRoot}/${selectedFile.path}`;
    try {
      await navigator.clipboard.writeText(absolute);
      setCopiedPath(true);
      window.setTimeout(() => setCopiedPath(false), 1600);
    } catch (copyError) {
      console.error("Failed to copy path:", copyError);
    }
  }, [fileRoot, selectedFile]);

  useEffect(() => {
    if (!selectedFile) return;
    const handler = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        closePreview();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [closePreview, selectedFile]);

  // Title/subtitle left · tools right (task + expert share this panel).
  return (
    <div className="flex h-full min-h-0 w-full flex-col px-6 pb-10 pt-5">
          <div className="mb-3 flex w-full min-w-0 shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
            <div className="min-w-0 flex-1 text-left">
              <div className="flex min-w-0 items-center gap-1">
                <h1
                  className={cn(
                    typeScale.pageTitle,
                    "min-w-0 truncate text-left",
                  )}
                >
                  {t(filesSourceTabTitleKey(sourceTab))}
                </h1>
                <FilesRefreshButton
                  source="browser"
                  loading={loading}
                  refreshDone={refreshDone}
                  disabled={
                    !fileRoot.trim() ||
                    (!isElectronRuntime() &&
                      (!props.client || !props.workspaceId.trim()))
                  }
                  onClick={() => {
                    manualRefreshRef.current = true;
                    setRefreshDone(false);
                    setRefreshKey((key) => key + 1);
                  }}
                />
              </div>
              <p className={cn(typeScale.pageSubtitle, "mt-1 max-w-2xl text-left")}>
                {t(filesSourceTabSubtitleKey(sourceTab))}
              </p>
            </div>

            {/* expand/collapse · type · search — right of title */}
            <div
              className="mt-1.5 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2"
              data-files-browser-pathbar="true"
            >
              {canExpandDeep ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  disabled={loading || filterActive}
                  aria-pressed={treeAllExpanded}
                  onClick={() => {
                    if (treeAllExpanded) collapseAllTree();
                    else expandAllTree();
                  }}
                  className={cn(
                    "size-9 shrink-0 rounded-full",
                    treeAllExpanded &&
                      "border-dls-accent/40 bg-dls-accent/10 text-dls-text",
                  )}
                  data-files-expand-collapse="true"
                  data-files-tree-expanded={
                    treeAllExpanded ? "true" : "false"
                  }
                  aria-label={
                    treeAllExpanded
                      ? t("files.collapse_all_folders")
                      : t("files.expand_all_folders")
                  }
                  title={
                    treeAllExpanded
                      ? t("files.collapse_all_folders")
                      : t("files.expand_all_folders")
                  }
                >
                  {treeAllExpanded ? (
                    <ChevronsDownUp className="size-3.5 shrink-0" aria-hidden />
                  ) : (
                    <ChevronsUpDown className="size-3.5 shrink-0" aria-hidden />
                  )}
                </Button>
              ) : null}
              <div className="relative shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => setTypeMenuOpen((prev) => !prev)}
                  className="h-9 gap-1.5 rounded-full px-3 text-sm"
                >
                  <SlidersHorizontal
                    data-icon="inline-start"
                    className="size-3.5 text-dls-secondary"
                  />
                  {fileCategoryLabel(typeFilter)}
                  <ChevronDown
                    className={cn(
                      "size-3.5 transition-transform",
                      typeMenuOpen && "rotate-180",
                    )}
                  />
                </Button>
                {typeMenuOpen ? (
                  <div
                    className="absolute right-0 top-full z-50 mt-1.5 flex min-w-[148px] flex-col rounded-xl border border-dls-border bg-dls-surface-solid py-1 shadow-md"
                    style={{
                      // Opaque on mac Electron glass — dls-surface alone is translucent.
                      backgroundColor:
                        "var(--dls-surface-solid, var(--dls-surface))",
                    }}
                  >
                    {FILE_CATEGORIES.map((cat) => (
                      <MenuRowButton
                        key={cat}
                        align="center"
                        type="button"
                        onClick={() => {
                          setTypeFilter(cat);
                          setTypeMenuOpen(false);
                        }}
                        active={typeFilter === cat}
                      >
                        {fileCategoryLabel(cat)}
                      </MenuRowButton>
                    ))}
                  </div>
                ) : null}
              </div>
              <InputGroup
                controlSize="default"
                radius="lg"
                tone="surface"
                className="min-w-[11rem] w-48 rounded-full sm:w-56"
              >
                <InputGroupAddon align="inline-start">
                  <Search className="size-3.5" />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  placeholder={t("files.search_placeholder")}
                  className="h-9 text-sm placeholder:text-dls-secondary"
                />
              </InputGroup>
            </div>
          </div>

          {catalogTruncated ? (
            <p
              className="mb-2 shrink-0 text-sm text-dls-secondary"
              data-files-catalog-truncated="true"
            >
              {t("files.catalog_truncated", {
                limit: String(WORKSPACE_FILES_CATALOG_LIMIT),
              })}
            </p>
          ) : null}

          <div className="relative flex min-h-0 flex-1 flex-col">
              {loading && entries.length === 0 ? (
                <div className="flex h-full min-h-48 items-center justify-center text-sm text-dls-secondary">
                  {t("files.loading")}
                </div>
              ) : error ? (
                <div className="flex h-full min-h-48 items-center justify-center px-6 text-center text-sm text-dls-secondary">
                  {error}
                </div>
              ) : (
                <div className="flex min-h-0 flex-1 flex-col gap-3">
                  {(!filterActive ? treeRows.length : listedNodes.length) > 0 ? (
                    /*
                      Scroll only file rows. Use a raw <table> (not Table wrapper)
                      so sticky thead is not trapped by Table's overflow-x-auto shell.
                      Sticky header + name column must use solid surfaces — glass
                      tokens (dls-surface*) are translucent and let row text bleed through.
                    */
                    <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-xl border border-dls-border bg-dls-surface-solid">
                      <table className="w-full table-fixed caption-bottom text-sm">
                        <FilesSortableTableHeader
                          sortKey={sortKey}
                          sortDir={sortDir}
                          onToggleSort={toggleSort}
                          actionsLabel={t("files.column_actions")}
                        />
                        <TableBody>
                          {!filterActive
                            ? treeRows.map((row) => {
                                if (row.type === "dir") {
                                  const node = row.node;
                                  const title =
                                    row.displayTitle?.trim() ||
                                    folderDisplayName(node);
                                  return (
                                    <FilesTreeDirRow
                                      node={node}
                                      depth={row.depth}
                                      expanded={row.expanded}
                                      fileCount={row.fileCount}
                                      title={title}
                                      fileRoot={fileRoot}
                                      sessionAction={openSourceForPath(node.path)}
                                      favorited={favoritePaths.has(node.path)}
                                      FileKindIcon={FileKindIcon}
                                      FileNameQuickActions={FileNameQuickActions}
                                      onToggleExpanded={toggleTreeExpanded}
                                      onOpenSession={openSessionForPath}
                                      onOpenInFolder={(path) => void handleOpenFile(path)}
                                      onToggleFavorite={handleToggleFavorite}
                                    />
                                  );
                                }

                                const fileNode = row.node;
                                return (
                                  <TableRow
                                    key={`tree-file:${fileNode.path}`}
                                    data-workspace-file-row="file"
                                    data-files-tree-depth={String(row.depth)}
                                    role="button"
                                    tabIndex={0}
                                    className={cn(
                                      "group h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dls-accent/30",
                                      selectedFile?.path === fileNode.path &&
                                        "bg-dls-surface-muted",
                                    )}
                                    onClick={() => void handleSelectFile(fileNode)}
                                    onKeyDown={(event) => {
                                      if (event.target !== event.currentTarget) return;
                                      if (event.key !== "Enter" && event.key !== " ")
                                        return;
                                      event.preventDefault();
                                      void handleSelectFile(fileNode);
                                    }}
                                  >
                                    <TableCell className="py-2">
                                      <span
                                        className="flex min-w-0 items-center gap-2.5"
                                        style={{
                                          paddingLeft: `${row.depth * 1.25}rem`,
                                        }}
                                      >
                                        <span className="size-3.5 shrink-0" />
                                        <FileKindIcon
                                          node={fileNode}
                                          fileRoot={fileRoot}
                                        />
                                        <span
                                          className="min-w-0 truncate text-sm font-medium text-dls-text"
                                          title={fileNode.path}
                                        >
                                          {fileNode.name}
                                        </span>
                                        <FileNameQuickActions
                                          path={fileNode.path}
                                          favorited={favoritePaths.has(fileNode.path)}
                                          showAddToTask
                                          onAddToTask={() =>
                                            void handleAddToTask(fileNode.path)
                                          }
                                          onOpenInFolder={() =>
                                            void handleOpenFile(fileNode.path)
                                          }
                                          onToggleFavorite={() =>
                                            handleToggleFavorite(fileNode.path)
                                          }
                                        />
                                      </span>
                                    </TableCell>
                                    <TableCell className="text-left py-2 text-xs text-dls-secondary">
                                      {fileCategoryLabel(
                                        getFileCategory(fileNode.name),
                                      )}
                                    </TableCell>
                                    <TableCell className="text-left py-2 text-xs text-dls-secondary tabular-nums">
                                      {fileNode.mtimeMs > 0
                                        ? formatWorkspaceFileTime(fileNode.mtimeMs)
                                        : "-"}
                                    </TableCell>
                                    <TableCell className="text-left py-2 text-xs text-dls-secondary tabular-nums">
                                      {formatWorkspaceFileSize(fileNode.size)}
                                    </TableCell>
                                    <TableCell className="relative py-2">
                                      <FileRowActionsMenu
                                        name={fileNode.name}
                                        pathCopied={
                                          pathCopiedFlash === fileNode.path
                                        }
                                        favorited={favoritePaths.has(fileNode.path)}
                                        openSourceSession={openSourceForPath(
                                          fileNode.path,
                                        )}
                                        onOpenSourceSession={() => {
                                          const action = openSourceForPath(
                                            fileNode.path,
                                          );
                                          if (action.canOpen && action.sessionId) {
                                            props.onOpenSourceSession?.(
                                              action.sessionId,
                                            );
                                          }
                                        }}
                                        onOpenInFolder={() =>
                                          void handleOpenFile(fileNode.path)
                                        }
                                        onAddToTask={() =>
                                          void handleAddToTask(fileNode.path)
                                        }
                                        onToggleFavorite={() =>
                                          handleToggleFavorite(fileNode.path)
                                        }
                                        onCopyPath={() =>
                                          void handleCopyFilePath(fileNode.path)
                                        }
                                        onDelete={() => handleDeleteFile(fileNode)}
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            : listedNodes.map((node) => {
                            // Filter mode: flat matching files only.
                            return (
                              <TableRow
                                key={node.path}
                                data-workspace-file-row={node.kind}
                                role="button"
                                tabIndex={0}
                                className={cn(
                                  "group h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dls-accent/30",
                                  selectedFile?.path === node.path &&
                                    "bg-dls-surface-muted",
                                )}
                                onClick={() => void handleSelectFile(node)}
                                onKeyDown={(event) => {
                                  if (event.target !== event.currentTarget) return;
                                  if (event.key !== "Enter" && event.key !== " ") return;
                                  event.preventDefault();
                                  void handleSelectFile(node);
                                }}
                              >
                                <TableCell className="py-2">
                                  <span className="flex min-w-0 items-center gap-2.5">
                                    <FileKindIcon node={node} fileRoot={fileRoot} />
                                    <span
                                      className="min-w-0 truncate text-sm font-medium text-dls-text"
                                      title={node.path}
                                    >
                                      {relativeDisplayPath(node.path, "")}
                                    </span>
                                    <FileNameQuickActions
                                      path={node.path}
                                      favorited={favoritePaths.has(node.path)}
                                      showAddToTask
                                      onAddToTask={() =>
                                        void handleAddToTask(node.path)
                                      }
                                      onOpenInFolder={() =>
                                        void handleOpenFile(node.path)
                                      }
                                      onToggleFavorite={() =>
                                        handleToggleFavorite(node.path)
                                      }
                                    />
                                  </span>
                                </TableCell>
                                <TableCell className="text-left py-2 text-xs text-dls-secondary">
                                  {fileCategoryLabel(getFileCategory(node.name))}
                                </TableCell>
                                <TableCell className="text-left py-2 text-xs text-dls-secondary tabular-nums">
                                  {node.mtimeMs > 0
                                    ? formatWorkspaceFileTime(node.mtimeMs)
                                    : "-"}
                                </TableCell>
                                <TableCell className="text-left py-2 text-xs text-dls-secondary tabular-nums">
                                  {formatWorkspaceFileSize(node.size)}
                                </TableCell>
                                <TableCell className="relative py-2">
                                  <FileRowActionsMenu
                                    name={node.name}
                                    pathCopied={pathCopiedFlash === node.path}
                                    favorited={favoritePaths.has(node.path)}
                                    openSourceSession={openSourceForPath(node.path)}
                                    onOpenSourceSession={() => {
                                      const action = openSourceForPath(node.path);
                                      if (action.canOpen && action.sessionId) {
                                        props.onOpenSourceSession?.(action.sessionId);
                                      }
                                    }}
                                    onOpenInFolder={() =>
                                      void handleOpenFile(node.path)
                                    }
                                    onAddToTask={() => void handleAddToTask(node.path)}
                                    onToggleFavorite={() =>
                                      handleToggleFavorite(node.path)
                                    }
                                    onCopyPath={() => void handleCopyFilePath(node.path)}
                                    onDelete={() => handleDeleteFile(node)}
                                  />
                                </TableCell>
                              </TableRow>
                            );
                          })}
                        </TableBody>
                      </table>
                    </div>
                  ) : (
                    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-dashed border-dls-border bg-dls-surface/50">
                      <FilesListEmptyState
                        filtered={typeFilter !== "all" || Boolean(query.trim())}
                        sessionScoped={requiresSessionFileRoot}
                      />
                    </div>
                  )}
                </div>
              )}
            <FilePreviewDrawer
              open={Boolean(selectedFile && selectedTarget)}
              file={selectedFile}
              target={selectedTarget}
              state={previewState}
              copied={copiedPath}
              onClose={closePreview}
              onCopyPath={handleCopyPath}
              onEdit={
                selectedTarget && previewState.status === "local" && canEditArtifactTarget(selectedTarget)
                  ? () => void handleEditFile(previewState.filePath)
                  : undefined
              }
              onOpenInFolder={selectedFile ? () => handleOpenFile(selectedFile.path) : undefined}
              onOpenExternally={
                selectedTarget && selectedFile
                  ? () => void openArtifactTarget(selectedTarget)
                  : undefined
              }
              onAskAgent={
                selectedFile && selectedTarget && props.onAskAgentAboutFile
                  ? () =>
                      props.onAskAgentAboutFile?.({
                        path: selectedFile.path,
                        name: selectedFile.name,
                        preview: selectedTarget.preview,
                      })
                  : props.onAddToTask && selectedFile
                    ? () => props.onAddToTask?.(selectedFile.path)
                    : undefined
              }
            />
          </div>

      {typeMenuOpen && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setTypeMenuOpen(false)}
          onContextMenu={() => setTypeMenuOpen(false)}
        />
      )}
      <ConfirmModal
        open={pendingDelete !== null}
        title={t("files.delete_confirm_title")}
        message={t("files.delete_confirm_desc", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
