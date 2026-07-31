/** @jsxImportSource react */
/**
 * Workspace catalog browser — used under 任务文件 for historical compatibility
 * until write-time provenance (P1) can filter assistant_task vs expert.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Cloud,
  Copy,
  ExternalLink,
  FileSearch,
  FileStack,
  Folder,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  Pencil,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  X,
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
  TableHead,
  TableHeader,
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
import { OfficeFilePreview } from "../../capabilities/artifacts/office-file-preview";
import {
  canEditArtifactTarget,
  openArtifactForEditing,
} from "../../capabilities/artifacts/open-artifact-for-editing";
import { ArtifactSpreadsheetEditor } from "../../capabilities/artifacts/artifact-spreadsheet-editor";
import {
  type OpenTarget,
} from "../../capabilities/artifacts/open-target";
import {
  HTMLPreview,
  ImagePreview,
  MarkdownPreview,
  PlainText,
  PreviewError,
  PreviewLoading,
  PreviewUnavailable,
} from "../../capabilities/artifacts/preview";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";
import {
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  findWorkspaceFileNode,
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
  shouldHideEntry,
  sortWorkspaceFileTreeCopy,
  workspaceFileBreadcrumbs,
  workspaceNameFromRoot,
  type WorkspaceFileSortDir,
  type WorkspaceFileSortKey,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import {
  FILE_CATEGORIES,
  buildRootOutlineRows,
  canPreviewWorkspaceFileInline,
  collectMatchingFilesUnder,
  countDirsInNode,
  countFilesInNode,
  fileCategoryI18nKey,
  filesSourceTabSubtitleKey,
  filterWorkspaceFileTree,
  filterWorkspaceTreeBySourceTab,
  getFileCategory,
  relativeDisplayPath,
  usesLocalFileRenderer,
  type FileCategory,
  type OutlineRow,
} from "./workspace-files-model";

function fileCategoryLabel(category: FileCategory) {
  return t(fileCategoryI18nKey(category));
}

function FileKindIcon(props: { node: WorkspaceFileTreeNode; fileRoot: string }) {
  if (props.node.kind === "dir") {
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

type FileNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
};

type FilePreviewState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; content: string }
  | { status: "binary"; url: string }
  | {
      status: "local";
      filePath: string;
      revision: number;
    }
  | { status: "external" }
  | { status: "browser" }
  | { status: "error"; message: string };
function FilePreviewDrawer(props: {
  open: boolean;
  file: FileNode | null;
  target: OpenTarget | null;
  state: FilePreviewState;
  copied: boolean;
  onClose: () => void;
  onCopyPath: () => void;
  onEdit?: () => void;
  onOpenInFolder?: () => void;
  onOpenExternally?: () => void;
}) {
  const { open, file, target, state, copied, onClose, onCopyPath, onEdit, onOpenInFolder, onOpenExternally } = props;

  if (typeof document === "undefined") return null;

  const overlay = (
    <div
      aria-hidden={!open}
      className={cn(
        "pointer-events-none fixed inset-0 z-[300] transition-opacity duration-200",
        open && "pointer-events-auto",
      )}
    >
      <div
        onClick={onClose}
        className={cn(
          "absolute inset-0 bg-black/25 opacity-0 transition-opacity duration-200 supports-backdrop-filter:backdrop-blur-[2px]",
          open && "opacity-100",
        )}
      />
      <aside
        role="dialog"
        aria-modal="true"
        aria-hidden={!open}
        aria-label={file?.name ?? t("files.preview_empty")}
        className={cn(
          "absolute inset-y-0 right-0 flex w-full max-w-[560px] min-w-[360px] translate-x-full flex-col border-l border-dls-border bg-dls-surface transition-transform duration-200 ease-out",
          open && "translate-x-0",
        )}
      >
        {file && target ? (
          <>
            <header className="flex items-start gap-3 border-b border-dls-border px-5 py-4">
              <ArtifactIcon type={target.preview} name={file.name} className="mt-0.5 size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium text-dls-text" title={file.name}>
                  {file.name}
                </div>
                <div className="mt-1 flex items-center gap-2 text-xs text-dls-secondary">
                  <span>{formatWorkspaceFileSize(file.size)}</span>
                  <span aria-hidden="true">·</span>
                  <span>{formatWorkspaceFileTime(file.mtimeMs)}</span>
                </div>
                <div
                  className="mt-1 truncate font-mono text-xs text-dls-secondary/80"
                  title={file.path}
                >
                  {file.path}
                </div>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                onClick={onClose}
                aria-label={t("files.close_preview")}
                title={t("files.close_preview")}
              >
                <X className="size-4" />
              </Button>
            </header>

            <div className="flex shrink-0 items-center gap-1.5 border-b border-dls-border bg-dls-surface-muted/60 px-3 py-2">
              {onEdit ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onEdit}
                  className="text-dls-secondary hover:text-dls-text"
                >
                  <Pencil data-icon="inline-start" className="size-3.5" aria-hidden="true" />
                  {t("files.edit_file")}
                </Button>
              ) : null}
              {onOpenExternally ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onOpenExternally}
                  className="text-dls-secondary hover:text-dls-text"
                >
                  <ExternalLink data-icon="inline-start" className="size-3.5" />
                  {t("files.open_file")}
                </Button>
              ) : null}
              {onOpenInFolder ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={onOpenInFolder}
                  className="text-dls-secondary hover:text-dls-text"
                >
                  <Folder data-icon="inline-start" className="size-3.5" />
                  {t("files.open_in_folder")}
                </Button>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onCopyPath}
                className="text-dls-secondary hover:text-dls-text"
              >
                <Copy data-icon="inline-start" className="size-3.5" />
                {copied ? t("files.copied") : t("files.copy_path")}
              </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-hidden bg-dls-surface">
              {state.status === "loading" ? (
                <PreviewLoading />
              ) : state.status === "error" ? (
                <PreviewError message={state.message} />
              ) : state.status === "local" ? (
                <OfficeFilePreview
                  filePath={state.filePath}
                  name={file.name}
                  revision={state.revision}
                />
              ) : state.status === "ready" && target.preview === "markdown" ? (
                <MarkdownPreview content={state.content} />
              ) : state.status === "ready" && target.preview === "html" ? (
                <HTMLPreview type="text" title={file.name} content={state.content} />
              ) : state.status === "ready" &&
                target.preview === "sheet" &&
                /\.(csv|tsv)$/i.test(file.name) ? (
                <ArtifactSpreadsheetEditor
                  className="h-full min-h-0"
                  name={file.name}
                  content={{ kind: "text", data: state.content }}
                  readOnly
                  onSave={async () => {}}
                />
              ) : state.status === "ready" ? (
                <PlainText content={state.content} />
              ) : state.status === "binary" && target.preview === "image" ? (
                <ImagePreview src={state.url} alt={file.name} />
              ) : state.status === "browser" ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-dls-secondary">
                  {t("files.preview_opened_in_browser")}
                </div>
              ) : state.status === "external" ? (
                <PreviewUnavailable />
              ) : (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-dls-secondary">
                  {t("files.preview_empty")}
                </div>
              )}
            </div>
          </>
        ) : null}
      </aside>
    </div>
  );

  return createPortal(overlay, document.body);
}

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


function FileRowActionsMenu(props: {
  name: string;
  pathCopied: boolean;
  onOpenInFolder: () => void;
  onAddToTask: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
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
        {/* Hope-style order: cloud first, then add-to-task / open folder */}
        <DropdownMenuItem disabled className="opacity-60">
          <Cloud />
          {t("files.upload_to_cloud_soon")}
        </DropdownMenuItem>
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
}) {
  const sourceTab = props.sourceTab ?? "task";
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<OnMyAgentWorkspaceFileCatalogEntry[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
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
  const [currentDirectoryPath, setCurrentDirectoryPath] = useState("");
  /** Expanded project/task paths for root outline view (Hope-style tree). */
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => new Set());
  const outlineExpandSeededRef = useRef(false);
  const [pathCopiedFlash, setPathCopiedFlash] = useState<string | null>(null);
  /** Default: newest first so folders with recent activity rise to the top. */
  const [sortKey, setSortKey] = useState<WorkspaceFileSortKey>("updated");
  const [sortDir, setSortDir] = useState<WorkspaceFileSortDir>("desc");
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
  const breadcrumbRootLabel = useMemo(() => {
    if (!fileRoot.trim()) return t("files.task_results");
    if (!toolFolderScoped) return t("files.workspace");
    return workspaceNameFromRoot(fileRoot);
  }, [fileRoot, toolFolderScoped]);

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
        limit: 10_000,
        shallow: false,
        ...(hasScopedFileRoot ? { root: fileRoot } : {}),
      });
      return catalog.items;
    };

    void load()
      .then((items) => {
        if (cancelled) return;
        setEntries(items);
        finishRefreshFlash();
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
        manualRefreshRef.current = false;
        setRefreshDone(false);
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
    setCurrentDirectoryPath("");
    outlineExpandSeededRef.current = false;
    setExpandedPaths(new Set());
  }, [fileRoot, props.workspaceId, sourceTab]);

  useEffect(() => {
    setCurrentDirectoryPath("");
  }, [query, typeFilter]);

  useEffect(() => {
    if (!props.client || !props.workspaceId.trim() || !selectedTarget) {
      setPreviewState({ status: "idle" });
      return;
    }

    if (selectedTarget.preview === "browser") {
      setPreviewState({ status: "browser" });
      return;
    }

    if (!canPreviewWorkspaceFileInline(selectedTarget)) {
      setPreviewState({ status: "external" });
      return;
    }

    let cancelled = false;
    setPreviewState({ status: "loading" });

    if (selectedTarget.preview === "image") {
      let objectUrl: string | null = null;
      void props.client
        .downloadWorkspaceFile(props.workspaceId, selectedTarget.value)
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

    const previewRequest = usesLocalFileRenderer(selectedTarget)
      ? Promise.resolve({
          status: "local" as const,
          filePath: selectedFile?.path.startsWith("/")
            ? selectedFile.path
            : `${fileRoot.replace(/[/\\]+$/, "")}/${selectedFile?.path.replace(/^[/\\]+/, "") ?? ""}`,
          revision: selectedTarget.updatedAt ?? Date.now(),
        })
      : props.client
          .readWorkspaceFile(props.workspaceId, selectedTarget.value)
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
  }, [fileRoot, props.client, props.workspaceId, selectedFile, selectedTarget]);

  const visibleFileTree = useMemo(() => {
    const tree = filterHiddenFromTree(
      buildWorkspaceFileTree(entries.filter((entry) => !shouldHideEntry(entry.path))),
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

  const currentDirectory =
    findWorkspaceFileNode(visibleFileTree, currentDirectoryPath) ?? visibleFileTree;
  const breadcrumbs = workspaceFileBreadcrumbs(currentDirectoryPath);
  const deepListingActive = typeFilter !== "all" || Boolean(query.trim());
  /** One-level children for browse; flattened matching files when type/search is on. */
  const listedNodes = useMemo(() => {
    if (!deepListingActive) return currentDirectory.children;
    return collectMatchingFilesUnder(
      currentDirectory,
      query,
      typeFilter,
      sortKey,
      sortDir,
    );
  }, [currentDirectory, deepListingActive, query, sortDir, sortKey, typeFilter]);

  const toggleSort = useCallback((key: WorkspaceFileSortKey) => {
    if (sortKey === key) {
      setSortDir((dir) => (dir === "asc" ? "desc" : "asc"));
      return;
    }
    setSortKey(key);
    // Name defaults ascending; updated/size default newest/largest first.
    setSortDir(key === "name" ? "asc" : "desc");
  }, [sortKey]);

  const useOutlineRoot =
    !deepListingActive && !currentDirectoryPath.trim();

  const outlineRows = useMemo(() => {
    if (!useOutlineRoot) return [] as OutlineRow[];
    return buildRootOutlineRows(listedNodes, expandedPaths);
  }, [expandedPaths, listedNodes, useOutlineRoot]);

  // Hope-style default: expand workspace projects and their task folders once.
  useEffect(() => {
    if (!useOutlineRoot) return;
    if (outlineExpandSeededRef.current || listedNodes.length === 0) return;
    const next = new Set<string>();
    for (const child of listedNodes) {
      if (child.kind !== "dir") continue;
      next.add(child.path);
      for (const nested of child.children) {
        if (nested.kind === "dir") next.add(nested.path);
      }
    }
    if (next.size === 0) return;
    outlineExpandSeededRef.current = true;
    setExpandedPaths(next);
  }, [listedNodes, useOutlineRoot]);

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  /** All expandable folder paths in the current outline (project + nested tasks). */
  const outlineExpandablePaths = useMemo(() => {
    if (!useOutlineRoot) return [] as string[];
    const paths: string[] = [];
    for (const child of listedNodes) {
      if (child.kind !== "dir") continue;
      paths.push(child.path);
      for (const nested of child.children) {
        if (nested.kind === "dir") paths.push(nested.path);
        for (const deep of nested.children) {
          if (deep.kind === "dir") paths.push(deep.path);
        }
      }
    }
    return paths;
  }, [listedNodes, useOutlineRoot]);

  const outlineAllExpanded =
    outlineExpandablePaths.length > 0 &&
    outlineExpandablePaths.every((path) => expandedPaths.has(path));

  const expandAllFolders = useCallback(() => {
    setExpandedPaths(new Set(outlineExpandablePaths));
  }, [outlineExpandablePaths]);

  const collapseAllFolders = useCallback(() => {
    setExpandedPaths(new Set());
  }, []);

  const openArtifactTarget = useCallback(
    async (target: OpenTarget) => {
      try {
        await props.onOpenArtifact?.(target);
      } catch (openError) {
        setPreviewState({
          status: "error",
          message: openError instanceof Error ? openError.message : t("files.preview_failed"),
        });
      }
    },
    [props.onOpenArtifact],
  );

  const absoluteForPath = useCallback(
    (relativePath: string) =>
      relativePath.startsWith("/")
        ? relativePath
        : `${fileRoot.replace(/[/\\]+$/, "")}/${relativePath.replace(/^[/\\]+/, "")}`,
    [fileRoot],
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

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
          <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-xl">
              <h1 className={typeScale.pageTitle}>
                {t("files.title")}
              </h1>
              <p className={cn(typeScale.pageSubtitle, "mt-1 truncate")}>
                {t(filesSourceTabSubtitleKey(sourceTab))}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-2 sm:max-w-md">
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={
                  loading ||
                  refreshDone ||
                  !fileRoot.trim() ||
                  (
                    !isElectronRuntime()
                    && (!props.client || !props.workspaceId.trim())
                  )
                }
                onClick={() => {
                  manualRefreshRef.current = true;
                  setRefreshDone(false);
                  setRefreshKey((key) => key + 1);
                }}
                className={cn(
                  "size-9 shrink-0 transition-colors",
                  refreshDone &&
                    "border-dls-status-success-border bg-dls-status-success-soft text-dls-status-success-fg",
                )}
                title={refreshDone ? t("common.refreshed") : t("common.refresh")}
                aria-label={refreshDone ? t("common.refreshed") : t("common.refresh")}
                aria-busy={loading || undefined}
              >
                {loading ? (
                  <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                ) : refreshDone ? (
                  <Check className="size-3.5" strokeWidth={2.5} aria-hidden />
                ) : (
                  <RefreshCw className="size-3.5" aria-hidden />
                )}
              </Button>
              <div className="relative shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="default"
                  onClick={() => setTypeMenuOpen((prev) => !prev)}
                  className="h-9 gap-1.5 px-3 text-sm"
                >
                  <SlidersHorizontal data-icon="inline-start" className="size-3.5 text-dls-secondary" />
                  {fileCategoryLabel(typeFilter)}
                  <ChevronDown className={cn("size-3.5 transition-transform", typeMenuOpen && "rotate-180")} />
                </Button>
                {typeMenuOpen && (
                  <div
                    className="absolute right-0 top-full z-50 mt-1.5 flex min-w-[148px] flex-col rounded-lg border border-dls-border bg-dls-surface-solid py-1 shadow-md"
                    style={{
                      // Opaque on mac Electron glass — dls-surface alone is translucent.
                      backgroundColor: "var(--dls-surface-solid, var(--dls-surface))",
                    }}
                  >
                    {FILE_CATEGORIES.map((cat) => (
                      <MenuRowButton
                        key={cat}
                        align="center"
                        type="button"
                        onClick={() => { setTypeFilter(cat); setTypeMenuOpen(false); }}
                        active={typeFilter === cat}
                      >
                        {fileCategoryLabel(cat)}
                      </MenuRowButton>
                    ))}
                  </div>
                )}
              </div>
              <InputGroup controlSize="default" radius="lg" tone="surface" className="min-w-[200px] max-w-[280px] flex-1">
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
                  <div className="flex min-h-8 shrink-0 items-center gap-2">
                    <nav
                      data-workspace-file-breadcrumb="true"
                      aria-label={t("files.breadcrumb_label")}
                      className="flex min-w-0 flex-1 flex-wrap items-center gap-0.5 rounded-lg border border-dls-border/70 bg-dls-surface-muted/40 px-2 py-1 text-sm text-dls-secondary"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className={cn(
                          "h-7 px-2 hover:text-dls-text",
                          currentDirectoryPath
                            ? "text-dls-secondary"
                            : "font-medium text-dls-text",
                        )}
                        onClick={() => setCurrentDirectoryPath("")}
                      >
                        {breadcrumbRootLabel}
                      </Button>
                      {breadcrumbs.map((item, index) => {
                        const isLast = index === breadcrumbs.length - 1;
                        return (
                          <span key={item.path} className="flex min-w-0 items-center gap-0.5">
                            <ChevronRight className="size-3 shrink-0 opacity-60" />
                            <Button
                              type="button"
                              variant="ghost"
                              size="xs"
                              className={cn(
                                "max-w-48 min-w-0 h-7 px-2 hover:text-dls-text",
                                isLast
                                  ? "font-medium text-dls-text"
                                  : "text-dls-secondary",
                              )}
                              onClick={() => setCurrentDirectoryPath(item.path)}
                            >
                              <span className="truncate">{item.name}</span>
                            </Button>
                          </span>
                        );
                      })}
                    </nav>
                    {useOutlineRoot && outlineExpandablePaths.length > 0 ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        className="h-8 shrink-0 gap-1 px-2 text-dls-secondary hover:text-dls-text"
                        onClick={() => {
                          if (outlineAllExpanded) collapseAllFolders();
                          else expandAllFolders();
                        }}
                        aria-label={
                          outlineAllExpanded
                            ? t("files.collapse_all_folders")
                            : t("files.expand_all_folders")
                        }
                        title={
                          outlineAllExpanded
                            ? t("files.collapse_all_folders")
                            : t("files.expand_all_folders")
                        }
                      >
                        <span className="text-xs font-medium">
                          {outlineAllExpanded
                            ? t("files.collapse_all_folders")
                            : t("files.expand_all_folders")}
                        </span>
                        <ChevronDown
                          className={cn(
                            "size-3.5 shrink-0 transition-transform",
                            outlineAllExpanded && "rotate-180",
                          )}
                          aria-hidden
                        />
                      </Button>
                    ) : null}
                  </div>
                  {listedNodes.length > 0 ? (
                    /*
                      Scroll only file rows. Use a raw <table> (not Table wrapper)
                      so sticky thead is not trapped by Table's overflow-x-auto shell.
                      Sticky header + name column must use solid surfaces — glass
                      tokens (dls-surface*) are translucent and let row text bleed through.
                    */
                    <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-dls-border bg-dls-surface-solid">
                      <table className="w-full caption-bottom text-sm">
                        <TableHeader className="sticky top-0 z-10">
                          <TableRow className="hover:bg-transparent">
                            {(
                              [
                                {
                                  key: "name" as WorkspaceFileSortKey | null,
                                  label: t("files.column_name"),
                                  className: "",
                                  sortable: true,
                                },
                                {
                                  key: null,
                                  label: t("files.column_type"),
                                  className: "w-28",
                                  sortable: false,
                                },
                                {
                                  key: "updated" as WorkspaceFileSortKey | null,
                                  label: t("files.column_updated"),
                                  className: "w-40",
                                  sortable: true,
                                },
                                {
                                  key: "size" as WorkspaceFileSortKey | null,
                                  label: t("files.column_size"),
                                  className: "w-24",
                                  sortable: true,
                                },
                              ] as const
                            ).map((column) => {
                              const active =
                                column.sortable &&
                                column.key !== null &&
                                sortKey === column.key;
                              return (
                                <TableHead
                                  key={column.label}
                                  className={cn(
                                    "h-10 border-b border-dls-border bg-dls-surface-solid text-xs font-medium text-dls-secondary",
                                    column.className,
                                  )}
                                  style={{ backgroundColor: "var(--dls-surface-solid, #2c2c2c)" }}
                                  aria-sort={
                                    active
                                      ? sortDir === "asc"
                                        ? "ascending"
                                        : "descending"
                                      : column.sortable
                                        ? "none"
                                        : undefined
                                  }
                                >
                                  {column.sortable && column.key ? (
                                    <button
                                      type="button"
                                      className={cn(
                                        "inline-flex items-center gap-1 rounded-md px-1 py-0.5 transition-colors hover:bg-dls-hover hover:text-dls-text",
                                        active ? "font-semibold text-dls-text" : "text-dls-secondary",
                                      )}
                                      onClick={() => toggleSort(column.key!)}
                                      aria-label={
                                        active
                                          ? `${column.label} · ${sortDir === "asc" ? "asc" : "desc"}`
                                          : column.label
                                      }
                                    >
                                      <span>{column.label}</span>
                                      {active ? (
                                        sortDir === "asc" ? (
                                          <ArrowUp className="size-3.5 shrink-0" aria-hidden />
                                        ) : (
                                          <ArrowDown className="size-3.5 shrink-0" aria-hidden />
                                        )
                                      ) : (
                                        <ArrowUpDown
                                          className="size-3.5 shrink-0 opacity-45"
                                          aria-hidden
                                        />
                                      )}
                                    </button>
                                  ) : (
                                    column.label
                                  )}
                                </TableHead>
                              );
                            })}
                            <TableHead
                              className="h-10 w-12 border-b border-dls-border bg-dls-surface-solid"
                              style={{ backgroundColor: "var(--dls-surface-solid, #2c2c2c)" }}
                            >
                              <span className="sr-only">
                                {t("files.column_actions")}
                              </span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {useOutlineRoot
                            ? outlineRows.map((row) => {
                                if (row.type === "project") {
                                  const badge =
                                    row.taskCount > 0
                                      ? t("files.task_count", { count: row.taskCount })
                                      : t("files.file_count", { count: row.fileCount });
                                  return (
                                    <TableRow
                                      key={`project:${row.node.path}`}
                                      data-workspace-file-row="project"
                                      className="group h-11 cursor-pointer bg-dls-surface-muted/40 hover:bg-dls-hover/60"
                                      onClick={() => toggleExpanded(row.node.path)}
                                    >
                                      <TableCell className="py-2">
                                        <span className="flex min-w-0 items-center gap-2">
                                          {row.expanded ? (
                                            <ChevronDown className="size-3.5 shrink-0 text-dls-secondary" />
                                          ) : (
                                            <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
                                          )}
                                          <Folder
                                            className="size-4 shrink-0 text-dls-text"
                                            strokeWidth={1.75}
                                            aria-hidden
                                          />
                                          <span className="min-w-0 truncate text-sm font-semibold text-dls-text">
                                            {row.node.name}
                                          </span>
                                          <span className="inline-flex shrink-0 items-center rounded-full bg-dls-surface-muted px-2 py-0.5 text-[11px] font-medium text-dls-secondary ring-1 ring-dls-border/60">
                                            {badge}
                                          </span>
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-2 text-xs text-dls-secondary">
                                        {t("files.type_folder")}
                                      </TableCell>
                                      <TableCell className="py-2 text-xs text-dls-secondary tabular-nums">
                                        {row.node.mtimeMs > 0
                                          ? formatWorkspaceFileTime(row.node.mtimeMs)
                                          : "-"}
                                      </TableCell>
                                      <TableCell className="py-2 text-xs text-dls-secondary tabular-nums">
                                        {formatWorkspaceFileSize(row.node.size)}
                                      </TableCell>
                                      <TableCell className="py-2">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="text-dls-secondary opacity-0 group-hover:opacity-100"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setCurrentDirectoryPath(row.node.path);
                                          }}
                                          aria-label={t("files.open_folder")}
                                          title={t("files.open_folder")}
                                        >
                                          <FolderOpen className="size-3.5" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                }

                                if (row.type === "task") {
                                  return (
                                    <TableRow
                                      key={`task:${row.node.path}`}
                                      data-workspace-file-row="task"
                                      className="group h-10 cursor-pointer hover:bg-dls-hover/50"
                                      onClick={() => toggleExpanded(row.node.path)}
                                    >
                                      <TableCell className="py-1.5">
                                        <span
                                          className="flex min-w-0 items-center gap-2"
                                          style={{ paddingLeft: `${row.depth * 1.25}rem` }}
                                        >
                                          {row.expanded ? (
                                            <ChevronDown className="size-3.5 shrink-0 text-dls-secondary" />
                                          ) : (
                                            <ChevronRight className="size-3.5 shrink-0 text-dls-secondary" />
                                          )}
                                          <MessageSquare
                                            className="size-3.5 shrink-0 text-dls-secondary"
                                            strokeWidth={1.75}
                                            aria-hidden
                                          />
                                          <span className="min-w-0 truncate text-sm text-dls-text">
                                            {row.node.name}
                                          </span>
                                          {row.fileCount > 0 ? (
                                            <span className="shrink-0 text-[11px] text-dls-secondary">
                                              {t("files.file_count", { count: row.fileCount })}
                                            </span>
                                          ) : null}
                                        </span>
                                      </TableCell>
                                      <TableCell className="py-1.5 text-xs text-dls-secondary">
                                        {t("files.type_folder")}
                                      </TableCell>
                                      <TableCell className="py-1.5 text-xs text-dls-secondary tabular-nums">
                                        {row.node.mtimeMs > 0
                                          ? formatWorkspaceFileTime(row.node.mtimeMs)
                                          : "-"}
                                      </TableCell>
                                      <TableCell className="py-1.5 text-xs text-dls-secondary tabular-nums">
                                        {formatWorkspaceFileSize(row.node.size)}
                                      </TableCell>
                                      <TableCell className="py-1.5">
                                        <Button
                                          type="button"
                                          variant="ghost"
                                          size="icon-xs"
                                          className="text-dls-secondary opacity-0 group-hover:opacity-100"
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            setCurrentDirectoryPath(row.node.path);
                                          }}
                                          aria-label={t("files.open_folder")}
                                        >
                                          <FolderOpen className="size-3.5" />
                                        </Button>
                                      </TableCell>
                                    </TableRow>
                                  );
                                }

                                const fileNode = row.node;
                                const depth = row.type === "file" ? row.depth : 0;
                                return (
                                  <TableRow
                                    key={`file:${fileNode.path}`}
                                    data-workspace-file-row="file"
                                    role="button"
                                    tabIndex={0}
                                    className={cn(
                                      "group h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dls-accent/30",
                                      selectedFile?.path === fileNode.path && "bg-dls-surface-muted",
                                    )}
                                    onClick={() => void handleSelectFile(fileNode)}
                                    onKeyDown={(event) => {
                                      if (event.target !== event.currentTarget) return;
                                      if (event.key !== "Enter" && event.key !== " ") return;
                                      event.preventDefault();
                                      void handleSelectFile(fileNode);
                                    }}
                                  >
                                    <TableCell className="py-2">
                                      <span
                                        className="flex min-w-0 items-center gap-2.5"
                                        style={{ paddingLeft: `${depth * 1.25}rem` }}
                                      >
                                        <FileKindIcon node={fileNode} fileRoot={fileRoot} />
                                        <span
                                          className="min-w-0 truncate text-sm font-medium text-dls-text"
                                          title={fileNode.path}
                                        >
                                          {fileNode.name}
                                        </span>
                                        <button
                                          type="button"
                                          className="inline-flex shrink-0 rounded-md p-0.5 text-dls-secondary opacity-0 transition-opacity hover:bg-dls-hover hover:text-dls-text group-hover:opacity-100"
                                          title={t("files.add_to_task")}
                                          aria-label={t("files.add_to_task")}
                                          onClick={(event) => {
                                            event.stopPropagation();
                                            void handleAddToTask(fileNode.path);
                                          }}
                                        >
                                          <CirclePlus className="size-3.5" aria-hidden />
                                        </button>
                                      </span>
                                    </TableCell>
                                    <TableCell className="py-2 text-xs text-dls-secondary">
                                      {fileCategoryLabel(getFileCategory(fileNode.name))}
                                    </TableCell>
                                    <TableCell className="py-2 text-xs text-dls-secondary tabular-nums">
                                      {fileNode.mtimeMs > 0
                                        ? formatWorkspaceFileTime(fileNode.mtimeMs)
                                        : "-"}
                                    </TableCell>
                                    <TableCell className="py-2 text-xs text-dls-secondary tabular-nums">
                                      {formatWorkspaceFileSize(fileNode.size)}
                                    </TableCell>
                                    <TableCell className="relative py-2">
                                      <FileRowActionsMenu
                                        name={fileNode.name}
                                        pathCopied={pathCopiedFlash === fileNode.path}
                                        onOpenInFolder={() => void handleOpenFile(fileNode.path)}
                                        onAddToTask={() => void handleAddToTask(fileNode.path)}
                                        onCopyPath={() => void handleCopyFilePath(fileNode.path)}
                                        onDelete={() => handleDeleteFile(fileNode)}
                                      />
                                    </TableCell>
                                  </TableRow>
                                );
                              })
                            : listedNodes.map((node) => {
                            const nestedPathLabel =
                              deepListingActive && node.kind === "file"
                                ? relativeDisplayPath(node.path, currentDirectoryPath)
                                : node.name;
                            return (
                          <TableRow
                            key={node.path}
                            data-workspace-file-row={node.kind}
                            role="button"
                            tabIndex={0}
                            className={cn(
                              "group h-11 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-dls-accent/30",
                              selectedFile?.path === node.path && "bg-dls-surface-muted",
                            )}
                            onClick={() => {
                              if (node.kind === "dir") {
                                setCurrentDirectoryPath(node.path);
                                return;
                              }
                              void handleSelectFile(node);
                            }}
                            onKeyDown={(event) => {
                              if (event.target !== event.currentTarget) return;
                              if (event.key !== "Enter" && event.key !== " ") return;
                              event.preventDefault();
                              if (node.kind === "dir") {
                                setCurrentDirectoryPath(node.path);
                                return;
                              }
                              void handleSelectFile(node);
                            }}
                          >
                            <TableCell className="py-2">
                              <span className="flex min-w-0 items-center gap-2.5">
                                <FileKindIcon node={node} fileRoot={fileRoot} />
                                <span
                                  className="min-w-0 truncate text-sm font-medium"
                                  style={{
                                    color: "var(--dls-text-primary)",
                                    opacity: 1,
                                  }}
                                  title={node.path}
                                >
                                  {nestedPathLabel}
                                </span>
                                {node.kind === "dir" ? (
                                  <ChevronRight className="ml-auto size-3.5 shrink-0 text-dls-secondary opacity-0 transition-opacity group-hover:opacity-100" />
                                ) : null}
                              </span>
                            </TableCell>
                            <TableCell className="py-2 text-xs text-dls-secondary">
                              {node.kind === "dir"
                                ? t("files.type_folder")
                                : fileCategoryLabel(getFileCategory(node.name))}
                            </TableCell>
                            <TableCell className="py-2 text-xs text-dls-secondary tabular-nums">
                              {node.mtimeMs > 0 ? formatWorkspaceFileTime(node.mtimeMs) : "-"}
                            </TableCell>
                            <TableCell className="py-2 text-xs text-dls-secondary tabular-nums">
                              {formatWorkspaceFileSize(node.size)}
                            </TableCell>
                            <TableCell className="relative py-2">
                              {node.kind === "file" ? (
                                <FileRowActionsMenu
                                  name={node.name}
                                  pathCopied={pathCopiedFlash === node.path}
                                  onOpenInFolder={() => void handleOpenFile(node.path)}
                                  onAddToTask={() => void handleAddToTask(node.path)}
                                  onCopyPath={() => void handleCopyFilePath(node.path)}
                                  onDelete={() => handleDeleteFile(node)}
                                />
                              ) : null}
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
