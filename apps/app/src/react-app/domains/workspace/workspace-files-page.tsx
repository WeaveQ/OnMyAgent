/** @jsxImportSource react */
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy,
  ExternalLink,
  FileText,
  Folder,
  MoreHorizontal,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton, NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import { cn } from "@/lib/utils";
import { revealDesktopItemInDir } from "../../../app/lib/desktop";
import type {
  OnMyAgentServerClient,
  OnMyAgentWorkspaceFileCatalogEntry,
} from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import type { OpenTarget } from "../../capabilities/artifacts/open-target";
import { MarkdownPreview, PlainText, PreviewError, PreviewLoading, PreviewUnavailable } from "../../capabilities/artifacts/preview";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";

const workspaceFilesTextClass = {
  pageTitle: "text-lg font-medium text-dls-text",
};

const CLOUD_DRIVE_PLACEHOLDER_ASSET = "/empty-states/cloud-drive-placeholder.png";

function formatWorkspaceFileSize(size: number) {
  if (!Number.isFinite(size) || size <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  let value = size;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

function formatWorkspaceFileTime(value: number) {
  if (!Number.isFinite(value) || value <= 0) return t("common.unknown");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return t("common.unknown");
  return date.toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

type WorkspaceFileTreeNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
  children: WorkspaceFileTreeNode[];
};

function shouldHideEntry(path: string): boolean {
  const parts = path.split("/").filter(Boolean);
  for (const part of parts) {
    if (part.startsWith(".")) return true;
  }
  if (path === "opencode.jsonc" || path.endsWith("/opencode.jsonc"))
    return true;
  return false;
}

function shouldHideNode(node: WorkspaceFileTreeNode): boolean {
  if (node.name.startsWith(".")) return true;
  if (node.name === "opencode.jsonc") return true;
  return false;
}

function filterHiddenFromTree(
  node: WorkspaceFileTreeNode,
): WorkspaceFileTreeNode {
  const filteredChildren = node.children
    .filter((c) => !shouldHideNode(c))
    .map((c) => filterHiddenFromTree(c));
  return { ...node, children: filteredChildren };
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

function CloudDriveEmptyState() {
  return (
    <div className="flex h-full min-h-[420px] items-center justify-center px-6 py-12 text-center">
      <div className="flex w-full max-w-xl flex-col items-center">
        <img
          src={resolvePublicAssetUrl(CLOUD_DRIVE_PLACEHOLDER_ASSET)}
          alt=""
          loading="lazy"
          className="h-auto w-full max-w-[360px]"
        />
        <h1 className="mt-7 text-lg font-medium text-dls-text">
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
  | { status: "external" }
  | { status: "browser" }
  | { status: "error"; message: string };

function canPreviewWorkspaceFileInline(target: OpenTarget) {
  if (target.preview === "markdown" || target.preview === "text") return true;
  return target.preview === "sheet" && /\.(csv|tsv)$/i.test(target.value);
}

function addWorkspaceFileTreeEntry(
  root: WorkspaceFileTreeNode,
  entry: OnMyAgentWorkspaceFileCatalogEntry,
) {
  const parts = entry.path.split("/").filter(Boolean);
  let parent = root;
  let currentPath = "";
  for (const name of parts) {
    const isLeaf =
      currentPath + (currentPath ? "/" : "") + name === parts.join("/");
    currentPath = currentPath ? `${currentPath}/${name}` : name;
    let child = parent.children.find((item) => item.path === currentPath);
    if (!child) {
      child = {
        name,
        path: currentPath,
        kind: isLeaf ? entry.kind : "dir",
        size: isLeaf ? entry.size : 0,
        mtimeMs: isLeaf ? entry.mtimeMs : 0,
        children: [],
      };
      parent.children.push(child);
    }
    if (currentPath === entry.path.split("/").filter(Boolean).join("/")) {
      child.kind = entry.kind;
      child.size = entry.size;
      child.mtimeMs = entry.mtimeMs;
    }
    parent = child;
  }
}

function sortWorkspaceFileTree(node: WorkspaceFileTreeNode) {
  node.children.sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === "dir" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
  for (const child of node.children) sortWorkspaceFileTree(child);
}

function buildWorkspaceFileTree(
  entries: OnMyAgentWorkspaceFileCatalogEntry[],
): WorkspaceFileTreeNode {
  const root: WorkspaceFileTreeNode = {
    name: t("files.workspace"),
    path: "",
    kind: "dir",
    size: 0,
    mtimeMs: 0,
    children: [],
  };
  for (const entry of entries) addWorkspaceFileTreeEntry(root, entry);
  sortWorkspaceFileTree(root);
  return root;
}

function findWorkspaceFileNode(
  node: WorkspaceFileTreeNode,
  path: string,
): WorkspaceFileTreeNode | null {
  if (node.path === path) return node;
  for (const child of node.children) {
    const match = findWorkspaceFileNode(child, path);
    if (match) return match;
  }
  return null;
}

function workspaceFileBreadcrumbs(path: string) {
  const parts = path.split("/").filter(Boolean);
  return parts.map((name, index) => ({
    name,
    path: parts.slice(0, index + 1).join("/"),
  }));
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
  onOpenInFolder?: () => void;
  onOpenExternally?: () => void;
}) {
  const { open, file, target, state, copied, onClose, onCopyPath, onOpenInFolder, onOpenExternally } = props;

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

export function WorkspaceFilesPage(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  workspaceRoot: string;
  fileRoot?: string | null;
  onOpenArtifact?: (target: OpenTarget) => Promise<void> | void;
}) {
  const [query, setQuery] = useState("");
  const [entries, setEntries] = useState<OnMyAgentWorkspaceFileCatalogEntry[]>(
    [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [activeTab, setActiveTab] = useState<"task" | "cloud">("task");
  const [menuPath, setMenuPath] = useState<string | null>(null);
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
    if (!props.client || !props.workspaceId.trim() || !fileRoot.trim()) {
      setEntries([]);
      setError(null);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void props.client
      .listWorkspaceFiles(props.workspaceId, {
        includeDirs: true,
        limit: 5000,
        ...(hasScopedFileRoot ? { root: fileRoot } : {}),
      })
      .then((catalog) => {
        if (cancelled) return;
        setEntries(catalog.items);
      })
      .catch((loadError: unknown) => {
        if (cancelled) return;
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
    void props.client
      .readWorkspaceFile(props.workspaceId, selectedTarget.value)
      .then((result) => {
        if (!cancelled) setPreviewState({ status: "ready", content: result.content });
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
  }, [props.client, props.workspaceId, selectedTarget]);

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
      setMenuPath(null);
    },
    [fileRoot],
  );

  const handleDeleteFile = useCallback(async (_filePath: string) => {
    setMenuPath(null);
  }, []);

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
      <div className="flex h-14 shrink-0 items-center border-b border-dls-border bg-dls-surface px-6">
        <SegmentedTabGroup>
          <NavTabButton
            active={activeTab === "task"}
            type="button"
            onClick={() => setActiveTab("task")}
            size="tab"
            shape="tab"
          >
            <Folder className="size-4" />
            {t("files.task_results")}
          </NavTabButton>
          <NavTabButton
            active={activeTab === "cloud"}
            type="button"
            onClick={() => setActiveTab("cloud")}
            size="tab"
            shape="tab"
          >
            <Cloud className="size-4" />
            {t("files.cloud_drive")}
          </NavTabButton>
        </SegmentedTabGroup>
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-6 py-8">
        <div className="flex h-full w-full flex-col">
          {activeTab === "cloud" ? (
            <CloudDriveEmptyState />
          ) : (
            <>
          <div className="mb-6 flex shrink-0 items-end justify-between gap-6">
            <div className="min-w-0">
              <h1 className={workspaceFilesTextClass.pageTitle}>
                {t("files.title")}
              </h1>
              <p className="mt-2 text-sm text-dls-secondary">
                {t("files.description")}
              </p>
            </div>
            <div className="flex min-w-0 flex-1 items-center justify-end gap-3">
              <div className="relative shrink-0">
                <Button
                  type="button"
                  variant="outline"
                  size="lg"
                  onClick={() => setTypeMenuOpen((prev) => !prev)}
                >
                  <SlidersHorizontal data-icon="inline-start" className="size-4 text-dls-secondary" />
                  {fileCategoryLabel(typeFilter)}
                  <ChevronDown className={cn("size-3.5 transition-transform", typeMenuOpen && "rotate-180")} />
                </Button>
                {typeMenuOpen && (
                  <div className="absolute left-0 top-full z-20 mt-2 flex min-w-[136px] flex-col rounded-lg border border-dls-border bg-dls-surface py-1">
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
              <InputGroup controlSize="lg" radius="xl" tone="surface" className="min-w-[280px] max-w-[360px] flex-1">
                <InputGroupAddon align="inline-start">
                  <Search className="size-4" />
                </InputGroupAddon>
                <InputGroupInput
                  value={query}
                  onChange={(e) => setQuery(e.currentTarget.value)}
                  placeholder={t("files.search_placeholder")}
                  className="h-10 text-sm placeholder:text-dls-secondary"
                />
              </InputGroup>
            </div>
          </div>

          <div className="relative min-h-0 flex-1">
            <div className="h-full min-h-0 overflow-auto pr-1">
              {loading && entries.length === 0 ? (
                <div className="flex h-full items-center justify-center text-sm text-dls-secondary">
                  {t("files.loading")}
                </div>
              ) : error ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-sm text-dls-secondary">
                  {error}
                </div>
              ) : (
                <div className="py-3">
                  <nav
                    data-workspace-file-breadcrumb="true"
                    aria-label={t("files.breadcrumb_label")}
                    className="mb-3 flex min-h-8 items-center gap-1 text-sm text-dls-secondary"
                  >
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="px-2 text-dls-secondary hover:text-dls-text"
                      onClick={() => setCurrentDirectoryPath("")}
                    >
                      {t("files.task_results")}
                    </Button>
                    {breadcrumbs.map((item) => (
                      <span key={item.path} className="flex min-w-0 items-center gap-1">
                        <ChevronRight className="size-3 shrink-0" />
                        <Button
                          type="button"
                          variant="ghost"
                          size="xs"
                          className="max-w-48 min-w-0 px-2 text-dls-secondary hover:text-dls-text"
                          onClick={() => setCurrentDirectoryPath(item.path)}
                        >
                          <span className="truncate">{item.name}</span>
                        </Button>
                      </span>
                    ))}
                  </nav>
                  {currentDirectory.children.length > 0 ? (
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>{t("files.column_name")}</TableHead>
                          <TableHead className="w-32">
                            {t("files.column_type")}
                          </TableHead>
                          <TableHead className="w-44">
                            {t("files.column_updated")}
                          </TableHead>
                          <TableHead className="w-28">
                            {t("files.column_size")}
                          </TableHead>
                          <TableHead className="w-12">
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
                            "group cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
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
                          <TableCell>
                            <span className="flex min-w-0 items-center gap-2">
                              {node.kind === "dir" ? (
                                <Folder className="size-4 shrink-0 text-dls-status-warning-fg" />
                              ) : (
                                <FileText className="size-4 shrink-0 text-dls-secondary" />
                              )}
                              <span className="truncate text-dls-text">{node.name}</span>
                            </span>
                          </TableCell>
                          <TableCell className="text-dls-secondary">
                            {node.kind === "dir" ? t("files.type_folder") : t("files.type_file")}
                          </TableCell>
                          <TableCell className="text-dls-secondary">
                            {node.mtimeMs > 0 ? formatWorkspaceFileTime(node.mtimeMs) : "-"}
                          </TableCell>
                          <TableCell className="text-dls-secondary">
                            {node.kind === "dir" ? "-" : formatWorkspaceFileSize(node.size)}
                          </TableCell>
                          <TableCell className="relative">
                            {node.kind === "file" ? (
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon-xs"
                                onClick={(event) => {
                                  event.stopPropagation();
                                  setMenuPath(node.path);
                                }}
                                className="text-dls-secondary opacity-0 group-hover:opacity-100 focus-visible:opacity-100"
                                aria-label={t("files.file_actions", { name: node.name })}
                              >
                                <MoreHorizontal className="size-4" />
                              </Button>
                            ) : null}
                            {menuPath === node.path ? (
                              <div className="absolute right-3 top-10 z-20 flex min-w-32 flex-col rounded-lg border border-dls-border bg-dls-surface py-1">
                                <MenuRowButton
                                  align="center"
                                  type="button"
                                  onClick={() => handleOpenFile(node.path)}
                                >
                                  {t("files.open_in_folder")}
                                </MenuRowButton>
                                <MenuRowButton
                                  align="center"
                                  type="button"
                                  onClick={() => handleDeleteFile(node.path)}
                                  className="text-dls-status-danger-fg hover:bg-dls-status-danger-soft"
                                >
                                  {t("common.remove")}
                                </MenuRowButton>
                              </div>
                            ) : null}
                          </TableCell>
                        </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  ) : (
                    <div className="flex min-h-48 items-center justify-center text-sm text-dls-secondary">
                      {typeFilter !== "all" || query.trim()
                        ? t("files.no_matching_files")
                        : requiresSessionFileRoot
                          ? t("files.no_session_files")
                          : t("files.no_files")}
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

      {(menuPath || typeMenuOpen) && (
        <div
          className="fixed inset-0 z-10"
          onClick={() => { setMenuPath(null); setTypeMenuOpen(false); }}
          onContextMenu={() => { setMenuPath(null); setTypeMenuOpen(false); }}
        />
      )}
    </div>
  );
}
