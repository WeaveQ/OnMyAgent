/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  ExternalLink,
  FileSearch,
  FileStack,
  Folder,
  FolderOpen,
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
  Table,
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
import {
  canPreviewOpenTargetInline,
  type OpenTarget,
} from "../../capabilities/artifacts/open-target";
import { MarkdownPreview, PlainText, PreviewError, PreviewLoading, PreviewUnavailable } from "../../capabilities/artifacts/preview";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";
import {
  buildWorkspaceFileTree,
  filterHiddenFromTree,
  findWorkspaceFileNode,
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
  shouldHideEntry,
  workspaceFileBreadcrumbs,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";

function FileKindIcon(props: { node: WorkspaceFileTreeNode; fileRoot: string }) {
  if (props.node.kind === "dir") {
    // Folders stay neutral; use primary text at partial opacity so dark mode
    // does not wash them out like pure secondary strokes on muted panels.
    return (
      <Folder
        className="size-4 shrink-0 text-dls-text/75"
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

type FileCategory = "all" | "document" | "spreadsheet" | "presentation" | "pdf" | "image" | "video" | "audio" | "website" | "markdown" | "code" | "other";

const FILE_CATEGORIES: FileCategory[] = [
  "all", "document", "spreadsheet", "presentation", "pdf", "image", "video", "audio", "website", "markdown", "code", "other",
];

function getFileCategory(name: string): FileCategory {
  const ext = name.lastIndexOf(".") > 0 ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
  const categoryMap: Record<string, FileCategory> = {
    md: "markdown", markdown: "markdown",
    txt: "document", doc: "document", docx: "document", rtf: "document",
    xls: "spreadsheet", xlsx: "spreadsheet", csv: "spreadsheet", tsv: "spreadsheet",
    ppt: "presentation", pptx: "presentation", key: "presentation",
    pdf: "pdf",
    png: "image", jpg: "image", jpeg: "image", gif: "image", webp: "image", svg: "image", bmp: "image", ico: "image", tiff: "image", tif: "image", avif: "image",
    mp4: "video", avi: "video", mov: "video", mkv: "video", wmv: "video", flv: "video", webm: "video",
    mp3: "audio", wav: "audio", flac: "audio", aac: "audio", ogg: "audio", m4a: "audio", wma: "audio",
    html: "website", css: "website", htm: "website",
    js: "code", ts: "code", jsx: "code", tsx: "code", py: "code", rs: "code", go: "code", java: "code",
    c: "code", cpp: "code", h: "code", hpp: "code", rb: "code", php: "code", swift: "code", kt: "code",
    sh: "code", bash: "code", zsh: "code", sql: "code", r: "code",
    json: "code", yaml: "code", yml: "code", toml: "code", xml: "code", ini: "code", env: "code",
    scss: "code", sass: "code", less: "code",
  };
  return categoryMap[ext] || "other";
}

function fileCategoryLabel(category: FileCategory) {
  switch (category) {
    case "all":
      return t("files.category_all");
    case "document":
      return t("files.category_document");
    case "spreadsheet":
      return t("files.category_spreadsheet");
    case "presentation":
      return t("files.category_presentation");
    case "pdf":
      return t("files.category_pdf");
    case "image":
      return t("files.category_image");
    case "video":
      return t("files.category_video");
    case "audio":
      return t("files.category_audio");
    case "website":
      return t("files.category_website");
    case "markdown":
      return t("files.category_markdown");
    case "code":
      return t("files.category_code");
    case "other":
      return t("files.category_other");
  }
}

/** Cloud + docs — monochrome line icon, same language as devices empty state. */
function CloudDriveIllustration() {
  return (
    <div className="flex h-36 w-full max-w-[240px] items-center justify-center">
      <svg
        viewBox="0 0 96 80"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="h-24 w-28 text-dls-secondary"
      >
        {/* Cloud outline */}
        <path
          d="M28 52h42c7.2 0 13-5.8 13-13 0-6.4-4.7-11.8-10.9-12.8A16 16 0 0 0 48 12c-7.5 0-13.8 5.1-15.6 12A12 12 0 0 0 16 36c0 8.8 7.2 16 16 16Z"
          fill="currentColor"
          fillOpacity="0.1"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinejoin="round"
        />
        {/* Back sheet */}
        <rect
          x="52"
          y="36"
          width="22"
          height="28"
          rx="3"
          fill="currentColor"
          fillOpacity="0.08"
          stroke="currentColor"
          strokeWidth="1.5"
          transform="rotate(6 63 50)"
        />
        {/* Front sheet */}
        <rect
          x="38"
          y="38"
          width="24"
          height="30"
          rx="3"
          fill="var(--dls-background, #fff)"
          stroke="currentColor"
          strokeWidth="1.75"
        />
        <path
          d="M44 48h12M44 54h12M44 60h8"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          opacity="0.5"
        />
      </svg>
    </div>
  );
}

function CloudDriveEmptyState() {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center px-6 py-12 text-center">
      <div className="flex w-full max-w-xl flex-col items-center">
        <CloudDriveIllustration />
        <h1 className="mt-6 text-lg font-medium text-dls-text">
          {t("files.cloud_empty_title")}
        </h1>
        <p className="mt-2 max-w-md text-sm leading-6 text-dls-secondary">
          {t("files.cloud_empty_description")}
        </p>
      </div>
    </div>
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
  | {
      status: "office";
      filePath: string;
      revision: number;
    }
  | { status: "external" }
  | { status: "browser" }
  | { status: "error"; message: string };

function canPreviewWorkspaceFileInline(target: OpenTarget) {
  return canPreviewOpenTargetInline(target);
}

function usesOfficeRenderer(target: OpenTarget) {
  return canEditArtifactTarget(target);
}

function filterWorkspaceFileTree(
  node: WorkspaceFileTreeNode,
  query: string,
  typeFilter: FileCategory,
): WorkspaceFileTreeNode | null {
  const normalizedQuery = query.trim().toLowerCase();
  const filteredChildren = node.children
    .map((child) => filterWorkspaceFileTree(child, normalizedQuery, typeFilter))
    .filter((child): child is WorkspaceFileTreeNode => child !== null);
  if (!node.path) return { ...node, children: filteredChildren };

  const matchesQuery =
    !normalizedQuery ||
    node.name.toLowerCase().includes(normalizedQuery) ||
    node.path.toLowerCase().includes(normalizedQuery);
  if (node.kind === "dir") {
    if (!matchesQuery && filteredChildren.length === 0) return null;
    return { ...node, children: filteredChildren };
  }
  if (!matchesQuery) return null;
  if (typeFilter !== "all" && getFileCategory(node.name) !== typeFilter) return null;
  return { ...node, children: [] };
}

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
              <ArtifactIcon type={target.preview} className="mt-0.5 size-5 shrink-0 text-dls-secondary" />
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
              ) : state.status === "office" ? (
                <OfficeFilePreview
                  filePath={state.filePath}
                  name={file.name}
                  revision={state.revision}
                />
              ) : state.status === "ready" && target.preview === "markdown" ? (
                <MarkdownPreview content={state.content} />
              ) : state.status === "ready" ? (
                <PlainText content={state.content} />
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

export function WorkspaceFilesPage(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  fileRoot?: string | null;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
  onEditError?: () => void;
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
  const [activeTab, setActiveTab] = useState<"task" | "cloud">("task");
  const [pendingDelete, setPendingDelete] = useState<FileNode | null>(null);
  const [typeFilter, setTypeFilter] = useState<FileCategory>("all");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [selectedFile, setSelectedFile] = useState<FileNode | null>(null);
  const [copiedPath, setCopiedPath] = useState(false);
  const [previewState, setPreviewState] = useState<FilePreviewState>({ status: "idle" });
  const [currentDirectoryPath, setCurrentDirectoryPath] = useState("");
  const fileRoot =
    props.fileRoot === undefined ? props.workspaceRoot : props.fileRoot?.trim() ?? "";
  const hasScopedFileRoot = props.fileRoot !== undefined && Boolean(fileRoot);
  const requiresSessionFileRoot = props.fileRoot !== undefined;

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

    const directoryPrefix = currentDirectoryPath.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

    const load = async (): Promise<OnMyAgentWorkspaceFileCatalogEntry[]> => {
      if (isElectronRuntime()) {
        const result = await listCodeWorkspaceFiles({
          workspacePath: fileRoot,
          ...(directoryPrefix ? { relativePath: directoryPrefix } : {}),
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
        shallow: true,
        ...(directoryPrefix ? { prefix: directoryPrefix } : {}),
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
  }, [
    currentDirectoryPath,
    fileRoot,
    hasScopedFileRoot,
    props.client,
    props.workspaceId,
    refreshKey,
  ]);

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
    const previewRequest = usesOfficeRenderer(selectedTarget)
      ? Promise.resolve({
          status: "office" as const,
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
    return filterWorkspaceFileTree(tree, query, typeFilter) ?? {
      ...tree,
      children: [],
    };
  }, [entries, query, typeFilter]);

  const currentDirectory =
    findWorkspaceFileNode(visibleFileTree, currentDirectoryPath) ?? visibleFileTree;
  const breadcrumbs = workspaceFileBreadcrumbs(currentDirectoryPath);

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

  const handleOpenFile = useCallback(
    async (filePath: string) => {
      const absolutePath = filePath.startsWith("/")
        ? filePath
        : `${fileRoot}/${filePath}`;
      try {
        await revealDesktopItemInDir(absolutePath);
      } catch (openError) {
        console.error("Failed to open directory:", openError);
      }
    },
    [fileRoot],
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
        <SegmentedTabGroup density="bare">
          <NavTabButton
            active={activeTab === "task"}
            type="button"
            onClick={() => setActiveTab("task")}
            size="tab"
            shape="tab"
            aria-current={activeTab === "task" ? "page" : undefined}
          >
            <FileStack aria-hidden />
            <span>{t("files.task_results")}</span>
          </NavTabButton>
          <NavTabButton
            active={activeTab === "cloud"}
            type="button"
            onClick={() => setActiveTab("cloud")}
            size="tab"
            shape="tab"
            aria-current={activeTab === "cloud" ? "page" : undefined}
          >
            <Cloud aria-hidden />
            <span>{t("files.cloud_drive")}</span>
          </NavTabButton>
        </SegmentedTabGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
        <div className="mx-auto flex h-full w-full max-w-6xl flex-col">
          {activeTab === "cloud" ? (
            <CloudDriveEmptyState />
          ) : (
            <>
          <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
            <div className="min-w-0 max-w-xl">
              <h1 className={typeScale.pageTitle}>
                {t("files.title")}
              </h1>
              <p className={cn(typeScale.pageSubtitle, "mt-1")}>
                {t("files.description")}
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

          <div className="relative min-h-0 flex-1">
            <div className="h-full min-h-0 overflow-auto">
              {loading && entries.length === 0 ? (
                <div className="flex h-full min-h-48 items-center justify-center text-sm text-dls-secondary">
                  {t("files.loading")}
                </div>
              ) : error ? (
                <div className="flex h-full min-h-48 items-center justify-center px-6 text-center text-sm text-dls-secondary">
                  {error}
                </div>
              ) : (
                <div className="flex min-h-0 flex-col gap-3 pb-4">
                  <nav
                    data-workspace-file-breadcrumb="true"
                    aria-label={t("files.breadcrumb_label")}
                    className="flex min-h-8 flex-wrap items-center gap-0.5 rounded-lg border border-dls-border/70 bg-dls-surface-muted/40 px-2 py-1 text-sm text-dls-secondary"
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
                      {t("files.task_results")}
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
                  {currentDirectory.children.length > 0 ? (
                    <div className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface">
                      <Table>
                        <TableHeader>
                          <TableRow className="hover:bg-transparent">
                            <TableHead className="h-10 bg-dls-surface-muted/50 text-xs font-medium text-dls-secondary">
                              {t("files.column_name")}
                            </TableHead>
                            <TableHead className="h-10 w-28 bg-dls-surface-muted/50 text-xs font-medium text-dls-secondary">
                              {t("files.column_type")}
                            </TableHead>
                            <TableHead className="h-10 w-40 bg-dls-surface-muted/50 text-xs font-medium text-dls-secondary">
                              {t("files.column_updated")}
                            </TableHead>
                            <TableHead className="h-10 w-24 bg-dls-surface-muted/50 text-xs font-medium text-dls-secondary">
                              {t("files.column_size")}
                            </TableHead>
                            <TableHead className="h-10 w-12 bg-dls-surface-muted/50">
                              <span className="sr-only">
                                {t("files.column_actions")}
                              </span>
                            </TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {currentDirectory.children.map((node) => (
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
                                <span className="truncate text-sm text-dls-text">
                                  {node.name}
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
                              {node.kind === "dir" ? "-" : formatWorkspaceFileSize(node.size)}
                            </TableCell>
                            <TableCell className="relative py-2">
                              {node.kind === "file" ? (
                                <DropdownMenu>
                                  <DropdownMenuTrigger
                                    render={
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon-xs"
                                        onClick={(event) => event.stopPropagation()}
                                        className="text-dls-secondary opacity-0 group-hover:opacity-100 focus-visible:opacity-100 data-popup-open:opacity-100"
                                        aria-label={t("files.file_actions", { name: node.name })}
                                      >
                                        <MoreHorizontal className="size-4" />
                                      </Button>
                                    }
                                  />
                                  <DropdownMenuContent align="end" className="min-w-40">
                                    <DropdownMenuItem onClick={() => handleOpenFile(node.path)}>
                                      <FolderOpen />
                                      {t("files.open_in_folder")}
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      variant="destructive"
                                      onClick={() => handleDeleteFile(node)}
                                    >
                                      <Trash2 />
                                      {t("common.delete")}
                                    </DropdownMenuItem>
                                  </DropdownMenuContent>
                                </DropdownMenu>
                              ) : null}
                            </TableCell>
                          </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  ) : (
                    <div className="rounded-xl border border-dashed border-dls-border bg-dls-surface/50">
                      <FilesListEmptyState
                        filtered={typeFilter !== "all" || Boolean(query.trim())}
                        sessionScoped={requiresSessionFileRoot}
                      />
                    </div>
                  )}
                </div>
              )}
            </div>
            <FilePreviewDrawer
              open={Boolean(selectedFile && selectedTarget)}
              file={selectedFile}
              target={selectedTarget}
              state={previewState}
              copied={copiedPath}
              onClose={closePreview}
              onCopyPath={handleCopyPath}
              onEdit={
                selectedTarget && previewState.status === "office" && canEditArtifactTarget(selectedTarget)
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
            </>
          )}
        </div>
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
