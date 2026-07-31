/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  Cloud,
  Copy,
  ExternalLink,
  FileSearch,
  FileStack,
  FileUp,
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
import { MenuRowButton, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
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
import { shellChrome, typeScale } from "@/react-app/design-system/type-scale";
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
  DEFAULT_FILES_SOURCE_TAB,
  FILE_CATEGORIES,
  FILES_SOURCE_TABS,
  buildRootOutlineRows,
  canPreviewWorkspaceFileInline,
  collectMatchingFilesUnder,
  countDirsInNode,
  countFilesInNode,
  fileCategoryI18nKey,
  filesSourceEmptyHintKey,
  filesSourceEmptyTitleKey,
  filesSourceTabLabelKey,
  filesSourceTabSubtitleKey,
  filterWorkspaceFileTree,
  getFileCategory,
  isFilesSourceListReady,
  relativeDisplayPath,
  resolveToolWorkspaceFileRoot,
  usesLocalFileRenderer,
  type FileCategory,
  type FilesSourceTab,
  type OutlineRow,
} from "./workspace-files-model";
import { WorkspaceFilesUploadsPanel } from "./workspace-files-uploads-panel";

function fileCategoryLabel(category: FileCategory) {
  return t(fileCategoryI18nKey(category));
}

// Re-export pure root resolver for existing callers/tests.
export { resolveToolWorkspaceFileRoot } from "./workspace-files-model";

function FileKindIcon(props: { node: WorkspaceFileTreeNode; fileRoot: string }) {
  if (props.node.kind === "dir") {
    // Solid primary stroke — name column must not look washed / translucent.
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

/** Honest empty for tabs without write-time provenance (P0). */
function FilesSourcePendingEmpty(props: { tab: FilesSourceTab }) {
  const Icon = props.tab === "expert" ? Bot : FileStack;
  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
      <div className="mb-4 shrink-0">
        <h1 className={typeScale.pageTitle}>{t("files.title")}</h1>
        <p className={cn(typeScale.pageSubtitle, "mt-1")}>
          {t(filesSourceTabSubtitleKey(props.tab))}
        </p>
      </div>
      <Empty className="min-h-[320px] flex-1 border border-dashed border-dls-border">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Icon className="size-5" aria-hidden />
          </EmptyMedia>
          <EmptyTitle>{t(filesSourceEmptyTitleKey(props.tab))}</EmptyTitle>
          <EmptyDescription>
            {t(filesSourceEmptyHintKey(props.tab))}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

function filesSourceTabIcon(tab: FilesSourceTab) {
  switch (tab) {
    case "uploads":
      return FileUp;
    case "task":
      return FileStack;
    case "expert":
      return Bot;
  }
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

export function WorkspaceFilesPage(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  /**
   * Directory to list. Callers should pass the OnMyAgent-selected workspace
   * folder (`workspaceRoot`) so the list does not follow session/tool context.
   * When omitted, falls back to `workspaceRoot`.
   */
  fileRoot?: string | null;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onEditError?: () => void;
  /** Optional: attach file into a new/current task (composer). */
  onAddToTask?: (relativePath: string) => void;
}) {
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
  const [activeTab, setActiveTab] = useState<FilesSourceTab>(
    DEFAULT_FILES_SOURCE_TAB,
  );
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
    if (!fileRoot.trim()) return t("files.source_task");
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
    // P0: catalog tree is not shown (task/expert wait for provenance; uploads use inbox).
    // Skip heavy recursive listing until a source tab is list-ready beyond uploads.
    if (activeTab === "uploads" || !isFilesSourceListReady(activeTab)) {
      setEntries([]);
      setLoading(false);
      setError(null);
      manualRefreshRef.current = false;
      return;
    }
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
  }, [activeTab, fileRoot, hasScopedFileRoot, props.client, props.workspaceId, refreshKey]);

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
  }, [fileRoot, props.workspaceId]);

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
    const filtered = filterWorkspaceFileTree(tree, query, typeFilter) ?? {
      ...tree,
      children: [],
    };
    return sortWorkspaceFileTreeCopy(filtered, sortKey, sortDir);
  }, [entries, query, sortDir, sortKey, typeFilter]);

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
    <div className="flex h-full min-h-0 flex-col bg-dls-background text-dls-text">
      <div className={cn(shellChrome.pageHeaderSimple, "border-b-0")}>
        {/* Free-float source pills — NavTab active fill only (no raw bg-white). */}
        <SegmentedTabGroup density="bare" role="tablist">
          {FILES_SOURCE_TABS.map((tab) => {
            const Icon = filesSourceTabIcon(tab);
            const active = activeTab === tab;
            return (
              <NavTabButton
                key={tab}
                active={active}
                type="button"
                role="tab"
                onClick={() => setActiveTab(tab)}
                size="tab"
                shape="tab"
                aria-selected={active}
                aria-current={active ? "page" : undefined}
              >
                <Icon aria-hidden />
                <span>{t(filesSourceTabLabelKey(tab))}</span>
              </NavTabButton>
            );
          })}
        </SegmentedTabGroup>
      </div>

      {/*
        Fixed chrome (title / breadcrumb / table header); only the file rows scroll.
        Outer must be overflow-hidden so the whole page does not scroll as one unit.
      */}
      <div className="min-h-0 flex-1 overflow-hidden px-6 py-5">
        {activeTab === "uploads" ? (
          <WorkspaceFilesUploadsPanel
            client={props.client}
            workspaceId={props.workspaceId}
          />
        ) : (
          <FilesSourcePendingEmpty tab={activeTab} />
        )}
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
