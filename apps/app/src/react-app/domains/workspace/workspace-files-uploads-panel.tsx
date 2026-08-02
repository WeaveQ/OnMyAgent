/** @jsxImportSource react */
/**
 * Files page — 我的文件 (uploads): inbox list + import-by-copy + preview/open actions
 * (parity with Task files drawer chrome where applicable).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import {
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  FileUp,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  MoreHorizontal,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
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
import { revealDesktopItemInDir } from "../../../app/lib/desktop";
import {
  OnMyAgentServerError,
  type OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import { FileHoverPopup } from "../../capabilities/artifacts/file-hover-popup";
import {
  canEditArtifactTarget,
  openArtifactForEditing,
} from "../../capabilities/artifacts/open-artifact-for-editing";
import {
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
} from "../../capabilities/artifacts/workspace-file-tree";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";
import {
  FILE_PREVIEW_SELECTION_DEBOUNCE_MS,
  shouldForceExternalPreviewForSize,
} from "../../capabilities/artifacts/file-preview-policy";
import {
  buildUserUploadRelativePath,
  canPreviewWorkspaceFileInline,
  FILE_CATEGORIES,
  fileCategoryI18nKey,
  filterUploadRows,
  getFileCategory,
  mapInboxItemsToUploadRows,
  mapUploadsCatalogToRows,
  mergeMineUploadRows,
  usesLocalFileRenderer,
  workspaceRelativeForUploadRow,
  workspaceRelativeInboxPath,
  WORKSPACE_UPLOADS_DIR,
  type FileCategory,
  type UserUploadRow,
} from "./workspace-files-model";
import { resolveUploadFolderRelativePath } from "./workspace-files-create-folder";
import {
  FilePreviewDrawer,
  type WorkspaceFilePreviewState,
} from "./workspace-files-preview-drawer";

function fileCategoryLabel(category: FileCategory) {
  return t(fileCategoryI18nKey(category));
}

/** Matches server DEFAULT_INBOX_MAX_BYTES (local precheck before upload). */
const CLIENT_INBOX_MAX_BYTES_DEFAULT = 200_000_000;

function readUploadLimitDetails(error: unknown): {
  maxBytes?: number;
  size?: number;
} {
  if (!(error instanceof OnMyAgentServerError) || !error.details || typeof error.details !== "object") {
    return {};
  }
  const details = error.details as { maxBytes?: unknown; size?: unknown };
  return {
    maxBytes:
      typeof details.maxBytes === "number" && Number.isFinite(details.maxBytes)
        ? details.maxBytes
        : undefined,
    size:
      typeof details.size === "number" && Number.isFinite(details.size)
        ? details.size
        : undefined,
  };
}

function formatUploadError(error: unknown, file?: File): string {
  if (error instanceof OnMyAgentServerError && error.code === "file_too_large") {
    const details = readUploadLimitDetails(error);
    const maxBytes = details.maxBytes ?? CLIENT_INBOX_MAX_BYTES_DEFAULT;
    const size = details.size ?? file?.size ?? 0;
    return t("files.upload_too_large", {
      name: file?.name?.trim() || "file",
      size: formatWorkspaceFileSize(size),
      max: formatWorkspaceFileSize(maxBytes),
    });
  }
  if (error instanceof Error && /exceeds upload limit|file_too_large|too large/i.test(error.message)) {
    return t("files.upload_too_large", {
      name: file?.name?.trim() || "file",
      size: formatWorkspaceFileSize(file?.size ?? 0),
      max: formatWorkspaceFileSize(CLIENT_INBOX_MAX_BYTES_DEFAULT),
    });
  }
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }
  return t("files.upload_failed");
}

function UploadRowActionsMenu(props: {
  name: string;
  pathCopied: boolean;
  onPreview: () => void;
  onOpenExternally: () => void;
  onOpenInFolder: () => void;
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
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onPreview();
          }}
        >
          <FileUp />
          {t("files.view_in_panel")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenExternally();
          }}
        >
          <ExternalLink />
          {t("files.open_file")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenInFolder();
          }}
        >
          <FolderOpen />
          {t("files.open_in_folder")}
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

export type WorkspaceFilesToastInput = {
  tone: "success" | "error" | "warning" | "info";
  title: string;
  description?: string | null;
  dismissLabel?: string;
};

export function WorkspaceFilesUploadsPanel(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  /** Catalog workspace root — required for local Office preview / reveal. */
  workspaceRoot?: string;
  onAddToTask?: (relativePath: string) => void;
  onAskAgentAboutFile?: (input: {
    path: string;
    name: string;
    preview: string;
  }) => void;
  /** Optional toast host from shell/session (workspace must not import shell-feedback). */
  onToast?: (input: WorkspaceFilesToastInput) => void;
}) {
  const [rows, setRows] = useState<UserUploadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileCategory>("all");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [refreshDone, setRefreshDone] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<WorkspaceFilePreviewState>({
    status: "idle",
  });
  const [copiedPath, setCopiedPath] = useState(false);
  const [pathCopiedFlash, setPathCopiedFlash] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<UserUploadRow | null>(null);
  const [createFolderOpen, setCreateFolderOpen] = useState(false);
  const [createFolderName, setCreateFolderName] = useState("");
  const [createFolderBusy, setCreateFolderBusy] = useState(false);
  const [currentFolderPath, setCurrentFolderPath] = useState(WORKSPACE_UPLOADS_DIR);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const manualRefreshRef = useRef(false);
  const dragDepthRef = useRef(0);

  const workspaceId = props.workspaceId.trim();
  const workspaceRoot = String(props.workspaceRoot ?? "").trim();
  const canLoad = Boolean(props.client && workspaceId);

  useEffect(() => {
    if (!canLoad || !props.client) {
      setRows([]);
      setLoading(false);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void (async () => {
      try {
        const client = props.client!;
        const [inboxList, catalog] = await Promise.all([
          client.listInbox(workspaceId).catch(() => ({ items: [] as never[] })),
          client
            .listWorkspaceFiles(workspaceId, {
              includeDirs: true,
              prefix: WORKSPACE_UPLOADS_DIR,
              limit: 2000,
            })
            .catch(() => ({ items: [] as never[] })),
        ]);
        if (cancelled) return;
        const inboxRows = mapInboxItemsToUploadRows(inboxList.items ?? []);
        const catalogRows = mapUploadsCatalogToRows(catalog.items ?? [], {
          parentPrefix: currentFolderPath,
          shallow: true,
        });
        // At uploads root, also show inbox files that are not under a subfolder.
        const inboxAtRoot =
          currentFolderPath === WORKSPACE_UPLOADS_DIR
            ? inboxRows
            : inboxRows.filter((row) =>
                row.path.replace(/\\/g, "/").startsWith(`${currentFolderPath}/`),
              );
        setRows(mergeMineUploadRows(inboxAtRoot, catalogRows));
        if (manualRefreshRef.current) {
          manualRefreshRef.current = false;
          setRefreshDone(true);
          window.setTimeout(() => setRefreshDone(false), 1200);
        }
      } catch (loadError) {
        if (cancelled) return;
        setRows([]);
        setError(
          loadError instanceof Error ? loadError.message : t("files.load_failed"),
        );
        manualRefreshRef.current = false;
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canLoad, currentFolderPath, props.client, refreshKey, workspaceId]);

  const visibleRows = useMemo(
    () => filterUploadRows(rows, query, typeFilter),
    [query, rows, typeFilter],
  );
  const filterActive = typeFilter !== "all" || Boolean(query.trim());

  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.id === selectedId) ?? null,
    [selectedId, visibleRows],
  );

  const selectedTarget = useMemo(() => {
    if (!selectedRow) return null;
    const root = workspaceRoot || "/";
    const workspaceRel = workspaceRelativeForUploadRow(selectedRow);
    return workspaceFileOpenTarget({
      fileRoot: root,
      path: workspaceRel,
      name: selectedRow.name,
      size: selectedRow.size,
      mtimeMs: selectedRow.updatedAt,
    });
  }, [selectedRow, workspaceRoot]);

  const selectedPreviewNode = useMemo(() => {
    if (!selectedRow) return null;
    return {
      name: selectedRow.name,
      path: workspaceRelativeForUploadRow(selectedRow),
      kind: "file" as const,
      size: selectedRow.size,
      mtimeMs: selectedRow.updatedAt,
    };
  }, [selectedRow]);

  // WP4: debounce selection before loading preview content.
  const [previewSelection, setPreviewSelection] = useState<{
    row: UserUploadRow | null;
    target: ReturnType<typeof workspaceFileOpenTarget> | null;
  }>({ row: null, target: null });
  useEffect(() => {
    const handle = window.setTimeout(() => {
      setPreviewSelection({ row: selectedRow, target: selectedTarget });
    }, FILE_PREVIEW_SELECTION_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [selectedRow, selectedTarget]);

  // Load preview for selected inbox file (same modes as Task browser).
  useEffect(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    const activeRow = previewSelection.row;
    const activeTarget = previewSelection.target;
    if (!activeRow || !activeTarget || !props.client || !workspaceId) {
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

    if (
      shouldForceExternalPreviewForSize({
        sizeBytes: activeRow.size,
        preview: activeTarget.preview,
      })
    ) {
      setPreviewState({ status: "too_large" });
      return;
    }

    let cancelled = false;
    setPreviewState({ status: "loading" });
    const workspaceRel = workspaceRelativeForUploadRow(activeRow);
    const abs = (() => {
      const root = workspaceRoot.replace(/[/\\]+$/, "");
      if (!root) return workspaceRel;
      if (/^[A-Za-z]:[\\/]/.test(root) || root.includes("\\")) {
        return `${root}\\${workspaceRel.replace(/\//g, "\\")}`;
      }
      return `${root}/${workspaceRel}`;
    })();

    if (activeTarget.preview === "image") {
      void (async () => {
        const candidates = Array.from(
          new Set(
            [
              workspaceRel,
              `${WORKSPACE_UPLOADS_DIR}/${activeRow.name}`,
              workspaceRelativeInboxPath(activeRow.path),
              workspaceRelativeInboxPath(activeRow.name),
              workspaceRelativeInboxPath(`uploads/${activeRow.name}`),
            ].filter(Boolean),
          ),
        );
        let lastError: unknown = null;
        for (const candidate of candidates) {
          try {
            const result = await props.client!.downloadWorkspaceFile(
              workspaceId,
              candidate,
            );
            if (cancelled) return;
            const lower = activeRow.name.toLowerCase();
            const fallbackType = lower.endsWith(".png")
              ? "image/png"
              : lower.endsWith(".jpg") || lower.endsWith(".jpeg")
                ? "image/jpeg"
                : lower.endsWith(".gif")
                  ? "image/gif"
                  : lower.endsWith(".webp")
                    ? "image/webp"
                    : "application/octet-stream";
            const objectUrl = URL.createObjectURL(
              new Blob([result.data], {
                type: result.contentType || fallbackType,
              }),
            );
            previewObjectUrlRef.current = objectUrl;
            setPreviewState({ status: "binary", url: objectUrl });
            return;
          } catch (error) {
            lastError = error;
          }
        }
        if (cancelled) return;
        setPreviewState({
          status: "error",
          message:
            lastError instanceof Error
              ? lastError.message
              : t("files.preview_failed"),
        });
      })();
      return () => {
        cancelled = true;
      };
    }

    const previewRequest =
      usesLocalFileRenderer(activeTarget) && isElectronRuntime() && workspaceRoot
        ? Promise.resolve({
            status: "local" as const,
            filePath: abs,
            revision: activeRow.updatedAt || Date.now(),
          })
        : props.client
            .readWorkspaceFile(workspaceId, workspaceRel)
            .then((result) => ({
              status: "ready" as const,
              content: result.content,
            }));

    void previewRequest
      .then((state) => {
        if (!cancelled) setPreviewState(state);
      })
      .catch((previewError: unknown) => {
        if (cancelled) return;
        if (usesLocalFileRenderer(activeTarget) && isElectronRuntime() && abs) {
          setPreviewState({
            status: "local",
            filePath: abs,
            revision: activeRow.updatedAt || Date.now(),
          });
          return;
        }
        setPreviewState({
          status: "error",
          message:
            previewError instanceof Error
              ? previewError.message
              : t("files.preview_failed"),
        });
      });

    return () => {
      cancelled = true;
    };
  }, [previewSelection, props.client, workspaceId, workspaceRoot]);

  const importFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (!props.client || !workspaceId) return;
      const files = Array.from(fileList).filter((file) => file.size >= 0 && file.name);
      if (files.length === 0) return;
      setUploading(true);
      setError(null);
      let currentFile: File | undefined;
      try {
        for (const file of files) {
          currentFile = file;
          if (file.size > CLIENT_INBOX_MAX_BYTES_DEFAULT) {
            const message = t("files.upload_too_large", {
              name: file.name.trim() || "file",
              size: formatWorkspaceFileSize(file.size),
              max: formatWorkspaceFileSize(CLIENT_INBOX_MAX_BYTES_DEFAULT),
            });
            setError(message);
            props.onToast?.({
              tone: "error",
              title: t("files.upload_failed"),
              description: message,
              dismissLabel: t("common.dismiss"),
            });
            return;
          }
          const path = buildUserUploadRelativePath(file.name);
          await props.client.uploadInbox(workspaceId, file, { path });
        }
        const description =
          files.length === 1
            ? t("files.upload_copy_success_one")
            : t("files.upload_copy_success", { count: String(files.length) });
        props.onToast?.({
          tone: "success",
          title: t("files.upload_copy_success_title"),
          description,
          dismissLabel: t("common.dismiss"),
        });
        setRefreshKey((key) => key + 1);
      } catch (uploadError) {
        const message = formatUploadError(uploadError, currentFile);
        setError(message);
        props.onToast?.({
          tone: "error",
          title: t("files.upload_failed"),
          description: message,
          dismissLabel: t("common.dismiss"),
        });
      } finally {
        setUploading(false);
      }
    },
    [props.client, props.onToast, workspaceId],
  );

  const onPickClick = () => {
    fileInputRef.current?.click();
  };

  const onDragEnter = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (!canLoad || uploading) return;
    dragDepthRef.current += 1;
    if (event.dataTransfer?.types?.includes("Files")) {
      setDragActive(true);
    }
  }, [canLoad, uploading]);

  const onDragLeave = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) setDragActive(false);
  }, []);

  const onDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = canLoad && !uploading ? "copy" : "none";
    }
  }, [canLoad, uploading]);

  const onDrop = useCallback(
    (event: DragEvent) => {
      event.preventDefault();
      event.stopPropagation();
      dragDepthRef.current = 0;
      setDragActive(false);
      if (!canLoad || uploading) return;
      const list = event.dataTransfer?.files;
      if (list?.length) void importFiles(list);
    },
    [canLoad, importFiles, uploading],
  );

  const workspaceRelativeForRow = useCallback(
    (row: UserUploadRow) => workspaceRelativeForUploadRow(row),
    [],
  );

  const absoluteForRow = useCallback(
    (row: UserUploadRow) => {
      const rel = workspaceRelativeForUploadRow(row);
      const root = workspaceRoot.replace(/[/\\]+$/, "");
      if (!root) return rel;
      if (/^[A-Za-z]:[\\/]/.test(root) || root.includes("\\")) {
        return `${root}\\${rel.replace(/\//g, "\\")}`;
      }
      return `${root}/${rel}`;
    },
    [workspaceRoot],
  );

  const handleOpenInFolder = useCallback(
    async (row: UserUploadRow) => {
      if (!workspaceRoot || !isElectronRuntime()) return;
      try {
        await revealDesktopItemInDir(absoluteForRow(row));
      } catch {
        // best-effort
      }
    },
    [absoluteForRow, workspaceRoot],
  );

  const handleOpenExternally = useCallback(
    async (row: UserUploadRow) => {
      if (!workspaceRoot || !isElectronRuntime()) return;
      const abs = absoluteForRow(row);
      try {
        if (canEditArtifactTarget({ preview: "", name: row.name })) {
          await openArtifactForEditing(abs);
        } else {
          await revealDesktopItemInDir(abs);
        }
      } catch {
        // best-effort
      }
    },
    [absoluteForRow, workspaceRoot],
  );

  const handleCopyPath = useCallback(
    async (row: UserUploadRow) => {
      const text = workspaceRoot
        ? absoluteForRow(row)
        : workspaceRelativeForUploadRow(row);
      try {
        await navigator.clipboard.writeText(text);
        setPathCopiedFlash(row.id);
        setCopiedPath(true);
        window.setTimeout(() => {
          setPathCopiedFlash(null);
          setCopiedPath(false);
        }, 1500);
      } catch {
        // ignore
      }
    },
    [absoluteForRow, workspaceRoot],
  );

  const handleDeleteFile = useCallback((row: UserUploadRow) => {
    setPendingDelete(row);
  }, []);

  const confirmDelete = useCallback(async () => {
    const row = pendingDelete;
    if (!row || !props.client || !workspaceId) {
      setPendingDelete(null);
      return;
    }
    try {
      await props.client.deleteWorkspaceFile(
        workspaceId,
        workspaceRelativeForRow(row),
        row.kind === "dir" ? { recursive: true } : undefined,
      );
      setRefreshKey((key) => key + 1);
      if (selectedId === row.id) {
        setSelectedId(null);
        setPreviewState({ status: "idle" });
      }
      setError(null);
    } catch (deleteError) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : t("files.load_failed"),
      );
    }
    setPendingDelete(null);
  }, [
    pendingDelete,
    props.client,
    selectedId,
    workspaceId,
    workspaceRelativeForRow,
  ]);

  const confirmCreateFolder = useCallback(async () => {
    if (!props.client || !workspaceId) return;
    const path = resolveUploadFolderRelativePath(
      createFolderName,
      currentFolderPath,
    );
    if (!path) {
      setError(t("files.create_folder_invalid"));
      return;
    }
    setCreateFolderBusy(true);
    setError(null);
    try {
      await props.client.mkdirWorkspaceDirectory(workspaceId, path);
      props.onToast?.({
        tone: "success",
        title: t("files.create_folder_success", {
          name: path.split("/").pop() ?? path,
        }),
        dismissLabel: t("common.dismiss"),
      });
      setCreateFolderOpen(false);
      setCreateFolderName("");
      setRefreshKey((key) => key + 1);
    } catch (createError) {
      const message =
        createError instanceof Error
          ? createError.message
          : t("files.create_folder_failed");
      setError(message);
      props.onToast?.({
        tone: "error",
        title: t("files.create_folder_failed"),
        description: message,
        dismissLabel: t("common.dismiss"),
      });
    } finally {
      setCreateFolderBusy(false);
    }
  }, [
    createFolderName,
    currentFolderPath,
    props,
    workspaceId,
  ]);

  const closePreview = useCallback(() => {
    setSelectedId(null);
    setPreviewState({ status: "idle" });
  }, []);

  const showEmpty = !loading && !error && visibleRows.length === 0;
  const showTable = !loading && visibleRows.length > 0;

  /** Hope-style breadcrumb: 我的文件 / folder / … (clickable segments). */
  const breadcrumbSegments = useMemo(() => {
    const parts = currentFolderPath
      .replace(/\\/g, "/")
      .split("/")
      .filter(Boolean);
    if (parts.length === 0) {
      return [{ path: WORKSPACE_UPLOADS_DIR, label: t("files.breadcrumb_mine") }];
    }
    return parts.map((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const label =
        index === 0 && part === WORKSPACE_UPLOADS_DIR
          ? t("files.breadcrumb_mine")
          : part;
      return { path, label };
    });
  }, [currentFolderPath]);

  // Same gutters as 市场 pluginsLayoutClass.pageContainer
  return (
    <div className="flex h-full min-h-0 w-full flex-col px-6 pb-10 pt-5">
      {/* Title + subtitle */}
      <div className="mb-3 min-w-0 shrink-0 text-left">
        <h1 className={cn(typeScale.pageTitle, "text-left")}>
          {t("files.source_uploads_title")}
        </h1>
        <p className={cn(typeScale.pageSubtitle, "mt-1 text-left")}>
          {t("files.source_uploads_desc")}
        </p>
      </div>

      {/* Hope toolbar: primary actions left, type + search right. No capacity bar (A7). */}
      <div
        className="mb-3 flex w-full shrink-0 flex-wrap items-center justify-between gap-2"
        data-files-mine-toolbar="true"
      >
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={!canLoad || uploading || loading || createFolderBusy}
            onClick={() => {
              setCreateFolderName("");
              setCreateFolderOpen(true);
            }}
            className="h-9 gap-1.5"
            data-files-create-folder="true"
          >
            <FolderPlus className="size-3.5" aria-hidden />
            {t("files.create_folder")}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              const list = event.target.files;
              if (list?.length) void importFiles(list);
              event.target.value = "";
            }}
          />
          <Button
            type="button"
            variant="outline"
            size="default"
            disabled={!canLoad || uploading || loading}
            onClick={onPickClick}
            className="h-9 gap-1.5"
            data-files-upload="true"
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
            {uploading ? t("files.uploading") : t("files.upload_files")}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={loading || refreshDone || !canLoad || uploading}
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
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <div className="relative shrink-0">
            <Button
              type="button"
              variant="outline"
              size="default"
              onClick={() => setTypeMenuOpen((prev) => !prev)}
              className="h-9 gap-1.5 px-3 text-sm"
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
                className="absolute right-0 top-full z-50 mt-1.5 flex min-w-[148px] flex-col rounded-lg border border-dls-border bg-dls-surface-solid py-1 shadow-md"
                style={{
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
            className="min-w-[200px] w-56 sm:w-64"
          >
            <InputGroupAddon align="inline-start">
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("files.search_uploads_placeholder")}
              disabled={loading || uploading}
              className="h-9 text-sm placeholder:text-dls-secondary"
            />
          </InputGroup>
        </div>
      </div>

      {/* Always-on breadcrumb (Hope: drive / folder / …) */}
      <nav
        className="mb-3 flex min-w-0 shrink-0 flex-wrap items-center gap-1 text-xs text-dls-secondary"
        aria-label={t("files.breadcrumb_label")}
        data-files-mine-breadcrumb="true"
      >
        {breadcrumbSegments.map((segment, index) => {
          const isLast = index === breadcrumbSegments.length - 1;
          return (
            <span key={segment.path} className="inline-flex min-w-0 items-center gap-1">
              {index > 0 ? (
                <span className="shrink-0 text-dls-secondary/70" aria-hidden>
                  /
                </span>
              ) : null}
              {isLast ? (
                <span className="truncate font-medium text-dls-text">
                  {segment.label}
                </span>
              ) : (
                <button
                  type="button"
                  className="truncate rounded-sm text-dls-secondary transition-colors hover:text-dls-text hover:underline"
                  onClick={() => setCurrentFolderPath(segment.path)}
                >
                  {segment.label}
                </button>
              )}
            </span>
          );
        })}
      </nav>

      {error ? (
        <p className="mb-3 shrink-0 text-sm text-dls-status-danger-fg">{error}</p>
      ) : null}

      {!canLoad ? (
        <Empty className="min-h-[280px] border border-dashed border-dls-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileUp className="size-5" aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("files.no_tool_folder")}</EmptyTitle>
            <EmptyDescription>{t("files.no_tool_folder_hint")}</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : loading && rows.length === 0 ? (
        <div
          className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-sm text-dls-secondary"
          role="status"
          aria-busy="true"
        >
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <span>{t("files.loading")}</span>
        </div>
      ) : (
        <div
          className={cn(
            "relative flex min-h-0 w-full min-w-0 flex-1 flex-col rounded-xl border border-dls-border",
            dragActive && "border-dls-accent border-dashed bg-dls-accent/5",
          )}
          onDragEnter={onDragEnter}
          onDragLeave={onDragLeave}
          onDragOver={onDragOver}
          onDrop={onDrop}
        >
          {dragActive ? (
            <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 rounded-xl bg-dls-background/80 backdrop-blur-[1px]">
              <Upload className="size-8 text-dls-accent" aria-hidden />
              <p className="text-sm font-medium text-dls-text">
                {t("files.drop_to_upload")}
              </p>
              <p className="text-xs text-dls-secondary">
                {t("files.drop_to_upload_hint")}
              </p>
            </div>
          ) : null}

          {showEmpty ? (
            <Empty className="min-h-[280px] border-0">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <FileUp className="size-5" aria-hidden />
                </EmptyMedia>
                <EmptyTitle>
                  {filterActive
                    ? t("files.no_matching_files")
                    : t("files.uploads_empty_title")}
                </EmptyTitle>
                <EmptyDescription>
                  {filterActive
                    ? t("files.no_matching_files_hint")
                    : t("files.uploads_empty_hint")}
                </EmptyDescription>
              </EmptyHeader>
              {!filterActive ? (
                <Button
                  type="button"
                  size="default"
                  disabled={uploading}
                  onClick={onPickClick}
                  className="mt-4 gap-1.5"
                >
                  <Upload className="size-3.5" aria-hidden />
                  {t("files.import_to_workspace")}
                </Button>
              ) : null}
            </Empty>
          ) : showTable ? (
            <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto">
              <table className="w-full table-fixed caption-bottom text-sm">
                <TableHeader className="sticky top-0 z-10 bg-dls-background">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="w-auto text-left">
                      {t("files.column_name")}
                    </TableHead>
                    <TableHead className="w-24 text-left">
                      {t("files.column_type")}
                    </TableHead>
                    <TableHead className="w-36 text-left">
                      {t("files.column_updated")}
                    </TableHead>
                    <TableHead className="w-24 text-left">
                      {t("files.column_size")}
                    </TableHead>
                    <TableHead className="w-12 text-left">
                      <span className="sr-only">
                        {t("files.file_actions", { name: "" })}
                      </span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleRows.map((row) => {
                    const selected = row.id === selectedId;
                    const isDir = row.kind === "dir";
                    return (
                      <TableRow
                        key={row.id}
                        data-state={selected ? "selected" : undefined}
                        data-workspace-upload-row={isDir ? "dir" : "file"}
                        className={cn(
                          "group cursor-pointer",
                          selected && "bg-dls-surface-muted/80",
                        )}
                        onClick={() => {
                          if (isDir) {
                            setCurrentFolderPath(row.path.replace(/\\/g, "/"));
                            setSelectedId(null);
                            return;
                          }
                          setSelectedId(row.id);
                        }}
                        onDoubleClick={() => {
                          if (isDir) {
                            setCurrentFolderPath(row.path.replace(/\\/g, "/"));
                            return;
                          }
                          void handleOpenExternally(row);
                        }}
                      >
                        <TableCell className="text-left">
                          <div className="flex min-w-0 items-center gap-2">
                            {isDir ? (
                              <Folder
                                className="size-4 shrink-0 text-dls-text"
                                strokeWidth={1.75}
                                aria-hidden
                              />
                            ) : (
                              <ArtifactIcon
                                name={row.name}
                                className="size-4 shrink-0"
                              />
                            )}
                            {isDir ? (
                              <span className="truncate font-medium text-dls-text">
                                {row.name}
                              </span>
                            ) : (
                              <FileHoverPopup
                                name={row.name}
                                pathLabel={
                                  workspaceRoot
                                    ? absoluteForRow(row)
                                    : workspaceRelativeForRow(row)
                                }
                                sizeLabel={formatWorkspaceFileSize(row.size)}
                                updatedLabel={
                                  row.updatedAt
                                    ? formatWorkspaceFileTime(row.updatedAt)
                                    : undefined
                                }
                                onView={() => setSelectedId(row.id)}
                                onOpenFile={() => void handleOpenExternally(row)}
                                onOpenInFolder={
                                  workspaceRoot && isElectronRuntime()
                                    ? () => void handleOpenInFolder(row)
                                    : undefined
                                }
                                onCopyPath={() => void handleCopyPath(row)}
                              >
                                <span className="truncate font-medium text-dls-text underline-offset-2 group-hover:underline">
                                  {row.name}
                                </span>
                              </FileHoverPopup>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary">
                          {isDir
                            ? t("files.type_folder")
                            : fileCategoryLabel(getFileCategory(row.name))}
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary tabular-nums">
                          {row.updatedAt
                            ? formatWorkspaceFileTime(row.updatedAt)
                            : "—"}
                        </TableCell>
                        <TableCell className="text-left text-dls-secondary tabular-nums">
                          {isDir ? "—" : formatWorkspaceFileSize(row.size)}
                        </TableCell>
                        <TableCell className="relative py-2 text-left">
                          <UploadRowActionsMenu
                            name={row.name}
                            pathCopied={pathCopiedFlash === row.id}
                            onPreview={() => setSelectedId(row.id)}
                            onOpenExternally={() => void handleOpenExternally(row)}
                            onOpenInFolder={() => void handleOpenInFolder(row)}
                            onCopyPath={() => void handleCopyPath(row)}
                            onDelete={() => handleDeleteFile(row)}
                          />
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </table>
            </div>
          ) : null}
        </div>
      )}

      {typeMenuOpen ? (
        <div
          className="fixed inset-0 z-10"
          onClick={() => setTypeMenuOpen(false)}
          onContextMenu={() => setTypeMenuOpen(false)}
        />
      ) : null}

      <FilePreviewDrawer
        open={Boolean(selectedRow && selectedTarget)}
        file={selectedPreviewNode}
        target={selectedTarget}
        state={previewState}
        copied={copiedPath}
        onClose={closePreview}
        onCopyPath={() => {
          if (selectedRow) void handleCopyPath(selectedRow);
        }}
        onEdit={
          selectedRow &&
          previewState.status === "local" &&
          selectedTarget &&
          canEditArtifactTarget(selectedTarget)
            ? () => void openArtifactForEditing(previewState.filePath)
            : undefined
        }
        onOpenInFolder={
          selectedRow ? () => void handleOpenInFolder(selectedRow) : undefined
        }
        onOpenExternally={
          selectedRow ? () => void handleOpenExternally(selectedRow) : undefined
        }
        onAskAgent={
          selectedRow && selectedTarget && props.onAskAgentAboutFile
            ? () =>
                props.onAskAgentAboutFile?.({
                  path: workspaceRelativeForUploadRow(selectedRow),
                  name: selectedRow.name,
                  preview: selectedTarget.preview,
                })
            : selectedRow && props.onAddToTask
              ? () =>
                  props.onAddToTask?.(
                    workspaceRelativeForUploadRow(selectedRow),
                  )
              : undefined
        }
      />

      <ConfirmModal
        open={pendingDelete !== null}
        title={t("files.delete_confirm_title")}
        message={t("files.delete_confirm_desc", {
          name: pendingDelete?.name ?? "",
        })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void confirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />

      {createFolderOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-label={t("files.create_folder_title")}
          data-files-create-folder-dialog="true"
          onClick={() => {
            if (!createFolderBusy) setCreateFolderOpen(false);
          }}
        >
          <div
            className="w-full max-w-sm rounded-xl border border-dls-border bg-dls-surface p-4 shadow-lg"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 className="text-sm font-semibold text-dls-text">
              {t("files.create_folder_title")}
            </h2>
            <input
              autoFocus
              value={createFolderName}
              onChange={(event) => setCreateFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void confirmCreateFolder();
                }
                if (event.key === "Escape" && !createFolderBusy) {
                  setCreateFolderOpen(false);
                }
              }}
              placeholder={t("files.create_folder_placeholder")}
              disabled={createFolderBusy}
              className="mt-3 h-9 w-full rounded-lg border border-dls-border bg-dls-background px-3 text-sm text-dls-text outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30"
            />
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={createFolderBusy}
                onClick={() => setCreateFolderOpen(false)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                size="sm"
                disabled={createFolderBusy || !createFolderName.trim()}
                onClick={() => void confirmCreateFolder()}
              >
                {createFolderBusy ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                {t("files.create_folder_confirm")}
              </Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
