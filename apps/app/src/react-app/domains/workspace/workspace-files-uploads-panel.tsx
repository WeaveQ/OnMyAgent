/** @jsxImportSource react */
/**
 * Files page — Mine uploads/: catalog list, import-by-copy, folder browse,
 * hierarchical expand/collapse, drag-move, and preview/open actions.
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
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  FileUp,
  Folder,
  FolderPlus,
  Loader2,
  Search,
  SlidersHorizontal,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { MenuRowButton } from "@/components/ui/action-row";
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
import { revealDesktopItemInDir } from "../../../app/lib/desktop";
import {
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
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";
import {
  FILE_PREVIEW_SELECTION_DEBOUNCE_MS,
  shouldForceExternalPreviewForSize,
} from "../../capabilities/artifacts/file-preview-policy";
import { FilesRefreshButton } from "./workspace-files-chrome";
import {
  buildTreeNodesFromUploadRows,
  buildTreeOutlineRows,
  buildUserUploadRelativePath,
  canPreviewWorkspaceFileInline,
  collectExpandableDirPaths,
  FILE_CATEGORIES,
  fileCategoryLabel,
  filterUploadRows,
  getFileCategory,
  isDirectChildOfPrefix,
  mapUploadsCatalogToRows,
  sortUploadRows,
  usesLocalFileRenderer,
  workspaceRelativeForUploadRow,
  workspaceRelativeInboxPath,
  WORKSPACE_FILES_CATALOG_LIMIT,
  WORKSPACE_UPLOADS_DIR,
  type FileCategory,
  type TreeOutlineRow,
  type UserUploadRow,
} from "./workspace-files-model";
import {
  resolveMineMoveDestination,
  resolveUploadFolderRelativePath,
} from "./workspace-files-create-folder";
import { planInboxToUploadsMigration } from "./workspace-files-mine-migrate";
import { MineMoveToDialog } from "./workspace-files-move-dialog";
import {
  FilePreviewDrawer,
  type WorkspaceFilePreviewState,
} from "./workspace-files-preview-drawer";
import {
  FilesSortableTableHeader,
  useFilesTableSort,
} from "./workspace-files-table-sort";
import {
  CLIENT_INBOX_MAX_BYTES_DEFAULT,
  formatUploadError,
  UploadRowActionsMenu,
} from "./workspace-files-uploads-row-menu";

/** Internal Mine drag payload (not OS file drops). */
const MINE_DRAG_MIME = "application/x-onmyagent-mine-file";

export type WorkspaceFilesToastInput = {
  tone: "success" | "error" | "warning" | "info";
  title: string;
  description?: string | null;
  dismissLabel?: string;
  /** Optional action (e.g. Hope-style View after move). */
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
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
  const [catalogTruncated, setCatalogTruncated] = useState(false);
  const [query, setQuery] = useState("");
  const [typeFilter, setTypeFilter] = useState<FileCategory>("all");
  const [typeMenuOpen, setTypeMenuOpen] = useState(false);
  const { sortKey, sortDir, toggleSort } = useFilesTableSort();
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
  /** Folder row id currently highlighted as drag-move target. */
  const [dropTargetId, setDropTargetId] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);
  /**
   * false = one-level browse under currentFolderPath (click folder to enter);
   * true = hierarchical expand/collapse tree under current folder.
   */
  const [treeMode, setTreeMode] = useState(false);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(
    () => new Set(),
  );
  const [moveTarget, setMoveTarget] = useState<UserUploadRow | null>(null);
  const migrateOnceRef = useRef(false);
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
        if (!migrateOnceRef.current) {
          migrateOnceRef.current = true;
          try {
            const inboxList = await client.listInbox(workspaceId);
            const plan = planInboxToUploadsMigration(
              (inboxList.items ?? []).map(
                (item: { path?: string; name?: string }) =>
                  item.path || item.name || "",
              ),
            );
            for (const item of plan) {
              try {
                await client.renameWorkspaceFile(
                  workspaceId,
                  item.from,
                  item.to,
                );
              } catch {
              }
            }
          } catch {
          }
        }

        const catalog = await client.listWorkspaceFiles(workspaceId, {
          includeDirs: true,
          prefix: WORKSPACE_UPLOADS_DIR,
          limit: WORKSPACE_FILES_CATALOG_LIMIT,
        });
        if (cancelled) return;
        const items = catalog.items ?? [];
        setCatalogTruncated(items.length >= WORKSPACE_FILES_CATALOG_LIMIT);
        const catalogRows = mapUploadsCatalogToRows(items, {
          parentPrefix: currentFolderPath,
          shallow: false,
        });
        setRows(catalogRows);
        if (manualRefreshRef.current) {
          manualRefreshRef.current = false;
          setRefreshDone(true);
          window.setTimeout(() => setRefreshDone(false), 1000);
        }
      } catch (loadError) {
        if (cancelled) return;
        setRows([]);
        setCatalogTruncated(false);
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

  const filterActive = typeFilter !== "all" || Boolean(query.trim());

  // Full subtree under current folder (always available for expand-all).
  const treeRoots = useMemo(
    () =>
      buildTreeNodesFromUploadRows(rows, currentFolderPath, {
        sortKey,
        sortDir,
      }),
    [currentFolderPath, rows, sortDir, sortKey],
  );

  const expandableDirPaths = useMemo(
    () => collectExpandableDirPaths(treeRoots),
    [treeRoots],
  );

  const treeRows = useMemo((): TreeOutlineRow[] => {
    if (!treeMode || filterActive) return [];
    return buildTreeOutlineRows(treeRoots, expandedPaths);
  }, [expandedPaths, filterActive, treeMode, treeRoots]);

  const treeAllExpanded =
    treeMode &&
    expandableDirPaths.length > 0 &&
    expandableDirPaths.every((path) => expandedPaths.has(path));

  /**
   * One-level browse rows (default) or full filter matches.
   * When treeMode is on without filter, the table uses treeRows instead.
   */
  const visibleRows = useMemo(() => {
    const scoped =
      filterActive || treeMode
        ? rows
        : rows.filter((row) =>
            isDirectChildOfPrefix(row.path, currentFolderPath),
          );
    return sortUploadRows(
      filterUploadRows(scoped, query, typeFilter),
      sortKey,
      sortDir,
    );
  }, [
    currentFolderPath,
    filterActive,
    query,
    rows,
    sortDir,
    sortKey,
    treeMode,
    typeFilter,
  ]);

  /** Map path → row for tree row actions / preview. */
  const rowByPath = useMemo(() => {
    const map = new Map<string, UserUploadRow>();
    for (const row of rows) {
      map.set(row.path.replace(/\\/g, "/"), row);
    }
    return map;
  }, [rows]);

  const enterFolder = useCallback((path: string) => {
    setTreeMode(false);
    setExpandedPaths(new Set());
    setCurrentFolderPath(path.replace(/\\/g, "/"));
    setSelectedId(null);
  }, []);

  const toggleTreeExpanded = useCallback((path: string) => {
    setExpandedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const expandAllTree = useCallback(() => {
    setTreeMode(true);
    setExpandedPaths(new Set(expandableDirPaths));
  }, [expandableDirPaths]);

  const collapseAllTree = useCallback(() => {
    setTreeMode(false);
    setExpandedPaths(new Set());
  }, []);

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

    const workspaceRel = workspaceRelativeForUploadRow(activeRow);
    const abs = (() => {
      const root = workspaceRoot.replace(/[/\\]+$/, "");
      if (!root) return workspaceRel;
      if (/^[A-Za-z]:[\\/]/.test(root) || root.includes("\\")) {
        return `${root}\\${workspaceRel.replace(/\//g, "\\")}`;
      }
      return `${root}/${workspaceRel}`;
    })();

    // Office/PDF overlay reads from disk on Electron — never block pptx/docx by size.
    const localOfficeOverlay =
      usesLocalFileRenderer(activeTarget) &&
      isElectronRuntime() &&
      Boolean(workspaceRoot.trim());

    if (
      !localOfficeOverlay &&
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
          // Product layout: write under workspace uploads/ (not inbox).
          const basePath =
            currentFolderPath === WORKSPACE_UPLOADS_DIR
              ? buildUserUploadRelativePath(file.name)
              : `${currentFolderPath}/${
                  file.name.trim().replace(/\\/g, "/").split("/").pop() || "file"
                }`.replace(/\/+/g, "/");
          const data = await file.arrayBuffer();
          await props.client.writeWorkspaceBinaryFile(workspaceId, {
            path: basePath,
            data,
            force: true,
          });
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
    [currentFolderPath, props.client, props.onToast, workspaceId],
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
      const { openWorkspaceFileExternally } = await import(
        "./workspace-files-open-external"
      );
      await openWorkspaceFileExternally({
        absolutePath: absoluteForRow(row),
        fileName: row.name,
      });
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

  const handleMineDragStart = useCallback(
    (event: DragEvent, row: UserUploadRow) => {
      if (row.kind === "dir" || moveBusy) {
        event.preventDefault();
        return;
      }
      const payload = {
        id: row.id,
        name: row.name,
        path: row.path,
        source: row.source ?? "inbox",
        workspaceRelative: workspaceRelativeForUploadRow(row),
      };
      event.dataTransfer.setData(MINE_DRAG_MIME, JSON.stringify(payload));
      event.dataTransfer.setData("text/plain", row.name);
      event.dataTransfer.effectAllowed = "move";
    },
    [moveBusy],
  );

  const handleFolderDragOver = useCallback(
    (event: DragEvent, folder: UserUploadRow) => {
      if (folder.kind !== "dir") return;
      const types = Array.from(event.dataTransfer.types ?? []);
      if (!types.includes(MINE_DRAG_MIME)) return;
      event.preventDefault();
      event.stopPropagation();
      event.dataTransfer.dropEffect = "move";
      setDropTargetId(folder.id);
    },
    [],
  );

  const handleFolderDragLeave = useCallback(
    (event: DragEvent, folder: UserUploadRow) => {
      if (folder.kind !== "dir") return;
      const related = event.relatedTarget as Node | null;
      if (related && event.currentTarget.contains(related)) return;
      setDropTargetId((current) => (current === folder.id ? null : current));
    },
    [],
  );

  const handleFolderDrop = useCallback(
    async (event: DragEvent, folder: UserUploadRow) => {
      if (folder.kind !== "dir" || !props.client || !workspaceId) return;
      const raw = event.dataTransfer.getData(MINE_DRAG_MIME);
      // OS file drops still bubble to the panel importer.
      if (!raw) return;
      event.preventDefault();
      event.stopPropagation();
      setDropTargetId(null);
      setDragActive(false);
      let payload: {
        name?: string;
        workspaceRelative?: string;
      };
      try {
        payload = JSON.parse(raw) as {
          name?: string;
          workspaceRelative?: string;
        };
      } catch {
        return;
      }
      const from = String(payload.workspaceRelative ?? "").trim();
      const dest = resolveMineMoveDestination({
        sourceWorkspaceRelativePath: from,
        targetFolderWorkspaceRelativePath: workspaceRelativeForUploadRow(folder),
      });
      if (!dest) {
        props.onToast?.({
          tone: "warning",
          title: t("files.move_invalid"),
          dismissLabel: t("common.dismiss"),
        });
        return;
      }
      setMoveBusy(true);
      const targetFolderPath = workspaceRelativeForUploadRow(folder);
      const folderLabel =
        folder.name.trim()
        || targetFolderPath.split("/").filter(Boolean).pop()
        || targetFolderPath;
      try {
        await props.client.renameWorkspaceFile(
          workspaceId,
          dest.from,
          dest.to,
        );
        // Hope-style: moved into folder + View action opens that folder.
        props.onToast?.({
          tone: "success",
          title: t("files.move_to_success", { folder: folderLabel }),
          actionLabel: t("files.move_view"),
          onAction: () => {
            setCurrentFolderPath(targetFolderPath);
            setSelectedId(null);
            setPreviewState({ status: "idle" });
          },
          dismissLabel: t("common.dismiss"),
        });
        if (selectedId) {
          setSelectedId(null);
          setPreviewState({ status: "idle" });
        }
        setRefreshKey((key) => key + 1);
      } catch (moveError) {
        const message =
          moveError instanceof Error
            ? moveError.message
            : t("files.move_failed");
        setError(message);
        props.onToast?.({
          tone: "error",
          title: t("files.move_failed"),
          description: message,
          dismissLabel: t("common.dismiss"),
        });
      } finally {
        setMoveBusy(false);
      }
    },
    [props, selectedId, workspaceId],
  );

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

  const showEmpty =
    !loading &&
    !error &&
    (treeMode && !filterActive
      ? treeRows.length === 0
      : visibleRows.length === 0);
  const showTable =
    !loading &&
    (treeMode && !filterActive
      ? treeRows.length > 0
      : visibleRows.length > 0);

  /** Hope-style breadcrumb: My files / folder / … (clickable segments). */
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

  /** Root is already the page title — show path only when nested. */
  const showBreadcrumb = currentFolderPath !== WORKSPACE_UPLOADS_DIR;

  // Same gutters as marketplace pluginsLayoutClass.pageContainer
  // Title/subtitle left · tools right (align task/expert); breadcrumb only when nested.
  return (
    <div className="flex h-full min-h-0 w-full flex-col px-6 pb-10 pt-5">
      <div className="mb-3 flex w-full min-w-0 shrink-0 flex-col gap-2">
        <div className="flex w-full min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 flex-1 text-left">
            <div className="flex min-w-0 items-center gap-1">
              <h1 className={cn(typeScale.pageTitle, "min-w-0 truncate text-left")}>
                {t("files.source_uploads_title")}
              </h1>
              <FilesRefreshButton
                appearance="title"
                source="mine"
                loading={loading}
                refreshDone={refreshDone}
                disabled={!canLoad || uploading}
                onClick={() => {
                  manualRefreshRef.current = true;
                  setRefreshDone(false);
                  setRefreshKey((key) => key + 1);
                }}
              />
            </div>
            <p className={cn(typeScale.pageSubtitle, "mt-1 max-w-2xl text-left")}>
              {t("files.source_uploads_desc")}
            </p>
          </div>

          {/* create · upload · expand · type · search — right of title */}
          <div
            className="mt-1.5 flex min-w-0 shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2"
            data-files-mine-toolbar="true"
          >
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!canLoad || uploading || loading || createFolderBusy}
            onClick={() => {
              setCreateFolderName("");
              setCreateFolderOpen(true);
            }}
            className="size-9 shrink-0 rounded-full"
            data-files-create-folder="true"
            title={t("files.create_folder")}
            aria-label={t("files.create_folder")}
          >
            <FolderPlus className="size-3.5" aria-hidden />
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
            size="icon"
            disabled={!canLoad || uploading || loading}
            onClick={onPickClick}
            className="size-9 shrink-0 rounded-full"
            data-files-upload="true"
            title={uploading ? t("files.uploading") : t("files.upload_files")}
            aria-label={
              uploading ? t("files.uploading") : t("files.upload_files")
            }
            aria-busy={uploading || undefined}
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!canLoad || loading || uploading || filterActive}
            aria-pressed={treeMode && treeAllExpanded}
            onClick={() => {
              if (treeMode && treeAllExpanded) collapseAllTree();
              else if (treeMode) {
                setExpandedPaths(new Set(expandableDirPaths));
              } else {
                expandAllTree();
              }
            }}
            className={cn(
              "size-9 shrink-0 rounded-full",
              treeMode &&
                "border-dls-accent/40 bg-dls-accent/10 text-dls-text",
            )}
            data-files-expand-collapse="true"
            data-files-tree-mode={treeMode ? "true" : "false"}
            data-files-tree-expanded={treeAllExpanded ? "true" : "false"}
            title={
              treeMode && treeAllExpanded
                ? t("files.collapse_all_folders")
                : t("files.expand_all_folders")
            }
            aria-label={
              treeMode && treeAllExpanded
                ? t("files.collapse_all_folders")
                : t("files.expand_all_folders")
            }
          >
            {treeMode && treeAllExpanded ? (
              <ChevronsDownUp className="size-3.5 shrink-0" aria-hidden />
            ) : (
              <ChevronsUpDown className="size-3.5 shrink-0" aria-hidden />
            )}
          </Button>
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
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("files.search_uploads_placeholder")}
              disabled={loading || uploading}
              className="h-9 text-sm placeholder:text-dls-secondary"
            />
          </InputGroup>
        </div>
        </div>

        {/* Nested path only — root already named by the page title. */}
        {showBreadcrumb ? (
          <div
            className="flex w-full min-w-0 items-center"
            data-files-mine-pathbar="true"
          >
            <nav
              className="flex min-w-0 flex-wrap items-center gap-1 text-sm text-dls-secondary"
              aria-label={t("files.breadcrumb_label")}
              data-files-mine-breadcrumb="true"
            >
              {breadcrumbSegments.map((segment, index) => {
                const isLast = index === breadcrumbSegments.length - 1;
                return (
                  <span
                    key={segment.path}
                    className="inline-flex min-w-0 max-w-full items-center gap-1"
                  >
                    {index > 0 ? (
                      <span
                        className="shrink-0 text-dls-secondary/60"
                        aria-hidden
                      >
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
                        className="truncate rounded-md px-0.5 text-dls-secondary transition-colors hover:bg-dls-hover hover:text-dls-text"
                        onClick={() => enterFolder(segment.path)}
                      >
                        {segment.label}
                      </button>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
        ) : null}
      </div>

      {error ? (
        <p className="mb-3 shrink-0 text-sm text-dls-status-danger-fg">{error}</p>
      ) : null}
      {catalogTruncated ? (
        <p
          className="mb-3 shrink-0 text-sm text-dls-secondary"
          data-files-catalog-truncated="true"
        >
          {t("files.catalog_truncated", {
            limit: String(WORKSPACE_FILES_CATALOG_LIMIT),
          })}
        </p>
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
                <FilesSortableTableHeader
                  sortKey={sortKey}
                  sortDir={sortDir}
                  onToggleSort={toggleSort}
                  actionsLabel={t("files.file_actions", { name: "" })}
                  withSortDataAttrs
                />
                <TableBody>
                  {treeMode && !filterActive
                    ? treeRows.map((outlineRow) => {
                        if (outlineRow.type === "dir") {
                          const node = outlineRow.node;
                          const row = rowByPath.get(node.path);
                          const hasChildren = node.children.length > 0;
                          const isDropTarget =
                            Boolean(row) && dropTargetId === row?.id;
                          return (
                            <TableRow
                              key={`tree-dir:${node.path}`}
                              data-workspace-upload-row="dir"
                              data-files-tree-depth={String(outlineRow.depth)}
                              data-mine-drop-target={
                                isDropTarget ? "true" : undefined
                              }
                              className={cn(
                                "group h-11 cursor-pointer hover:bg-dls-hover/50",
                                isDropTarget &&
                                  "bg-dls-accent/10 ring-1 ring-inset ring-dls-accent/40",
                              )}
                              onDragOver={
                                row
                                  ? (event) => handleFolderDragOver(event, row)
                                  : undefined
                              }
                              onDragLeave={
                                row
                                  ? (event) => handleFolderDragLeave(event, row)
                                  : undefined
                              }
                              onDrop={
                                row
                                  ? (event) => void handleFolderDrop(event, row)
                                  : undefined
                              }
                            >
                              <TableCell className="text-left">
                                <div
                                  className="flex min-w-0 items-center gap-2"
                                  style={{
                                    paddingLeft: `${outlineRow.depth * 1.25}rem`,
                                  }}
                                >
                                  {hasChildren ? (
                                    <button
                                      type="button"
                                      className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
                                      aria-expanded={outlineRow.expanded}
                                      onClick={(event) => {
                                        event.stopPropagation();
                                        toggleTreeExpanded(node.path);
                                      }}
                                    >
                                      {outlineRow.expanded ? (
                                        <ChevronDown className="size-3.5" />
                                      ) : (
                                        <ChevronRight className="size-3.5" />
                                      )}
                                    </button>
                                  ) : (
                                    <span className="size-6 shrink-0" />
                                  )}
                                  <Folder
                                    className="size-4 shrink-0 text-dls-text"
                                    strokeWidth={1.75}
                                    aria-hidden
                                  />
                                  <button
                                    type="button"
                                    className="min-w-0 truncate text-left text-sm font-medium text-dls-text hover:text-dls-accent"
                                    title={node.path}
                                    onClick={() => enterFolder(node.path)}
                                  >
                                    {node.name}
                                  </button>
                                  {outlineRow.fileCount > 0 ? (
                                    <span className="inline-flex shrink-0 items-center rounded-full bg-dls-surface-muted px-2 py-0.5 text-[11px] font-medium text-dls-secondary ring-1 ring-dls-border/60">
                                      {t("files.file_count", {
                                        count: outlineRow.fileCount,
                                      })}
                                    </span>
                                  ) : null}
                                </div>
                              </TableCell>
                              <TableCell className="text-left text-dls-secondary">
                                {t("files.type_folder")}
                              </TableCell>
                              <TableCell className="text-left text-dls-secondary tabular-nums">
                                {node.mtimeMs > 0
                                  ? formatWorkspaceFileTime(node.mtimeMs)
                                  : "—"}
                              </TableCell>
                              <TableCell className="text-left text-dls-secondary tabular-nums">
                                —
                              </TableCell>
                              <TableCell className="relative py-2 text-left" />
                            </TableRow>
                          );
                        }

                        const fileNode = outlineRow.node;
                        const row = rowByPath.get(fileNode.path);
                        if (!row) return null;
                        const selected = row.id === selectedId;
                        return (
                          <TableRow
                            key={`tree-file:${fileNode.path}`}
                            data-state={selected ? "selected" : undefined}
                            data-workspace-upload-row="file"
                            data-files-tree-depth={String(outlineRow.depth)}
                            draggable={!moveBusy}
                            className={cn(
                              "group h-11 cursor-pointer cursor-grab active:cursor-grabbing",
                              selected && "bg-dls-surface-muted/80",
                            )}
                            onDragStart={(event) =>
                              handleMineDragStart(event, row)
                            }
                            onDragEnd={() => setDropTargetId(null)}
                            onClick={() => setSelectedId(row.id)}
                            onDoubleClick={() => void handleOpenExternally(row)}
                          >
                            <TableCell className="text-left">
                              <div
                                className="flex min-w-0 items-center gap-2"
                                style={{
                                  paddingLeft: `${outlineRow.depth * 1.25}rem`,
                                }}
                              >
                                <span className="size-6 shrink-0" />
                                <ArtifactIcon
                                  name={row.name}
                                  className="size-4 shrink-0"
                                />
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
                                  onOpenFile={() =>
                                    void handleOpenExternally(row)
                                  }
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
                              </div>
                            </TableCell>
                            <TableCell className="text-left text-dls-secondary">
                              {fileCategoryLabel(getFileCategory(row.name))}
                            </TableCell>
                            <TableCell className="text-left text-dls-secondary tabular-nums">
                              {row.updatedAt
                                ? formatWorkspaceFileTime(row.updatedAt)
                                : "—"}
                            </TableCell>
                            <TableCell className="text-left text-dls-secondary tabular-nums">
                              {formatWorkspaceFileSize(row.size)}
                            </TableCell>
                            <TableCell className="relative py-2 text-left">
                              <UploadRowActionsMenu
                                name={row.name}
                                pathCopied={pathCopiedFlash === row.id}
                                showMoveTo
                                onPreview={() => setSelectedId(row.id)}
                                onOpenExternally={() =>
                                  void handleOpenExternally(row)
                                }
                                onOpenInFolder={() =>
                                  void handleOpenInFolder(row)
                                }
                                onMoveTo={() => setMoveTarget(row)}
                                onCopyPath={() => void handleCopyPath(row)}
                                onDelete={() => handleDeleteFile(row)}
                              />
                            </TableCell>
                          </TableRow>
                        );
                      })
                    : visibleRows.map((row) => {
                    const selected = row.id === selectedId;
                    const isDir = row.kind === "dir";
                    const isDropTarget = isDir && dropTargetId === row.id;
                    return (
                      <TableRow
                        key={row.id}
                        data-state={selected ? "selected" : undefined}
                        data-workspace-upload-row={isDir ? "dir" : "file"}
                        data-mine-drop-target={isDropTarget ? "true" : undefined}
                        draggable={!isDir && !moveBusy}
                        className={cn(
                          "group cursor-pointer",
                          selected && "bg-dls-surface-muted/80",
                          isDropTarget &&
                            "bg-dls-accent/10 ring-1 ring-inset ring-dls-accent/40",
                          !isDir && "cursor-grab active:cursor-grabbing",
                        )}
                        onDragStart={(event) => handleMineDragStart(event, row)}
                        onDragEnd={() => setDropTargetId(null)}
                        onDragOver={(event) => handleFolderDragOver(event, row)}
                        onDragLeave={(event) => handleFolderDragLeave(event, row)}
                        onDrop={(event) => void handleFolderDrop(event, row)}
                        onClick={() => {
                          if (isDir) {
                            enterFolder(row.path);
                            return;
                          }
                          setSelectedId(row.id);
                        }}
                        onDoubleClick={() => {
                          if (isDir) {
                            enterFolder(row.path);
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
                            showMoveTo={!isDir}
                            onPreview={() => setSelectedId(row.id)}
                            onOpenExternally={() => void handleOpenExternally(row)}
                            onOpenInFolder={() => void handleOpenInFolder(row)}
                            onMoveTo={() => setMoveTarget(row)}
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

      <MineMoveToDialog
        open={moveTarget != null}
        client={props.client}
        workspaceId={workspaceId}
        sourcePath={
          moveTarget ? workspaceRelativeForUploadRow(moveTarget) : ""
        }
        sourceName={moveTarget?.name ?? ""}
        onClose={() => setMoveTarget(null)}
        onMoved={(targetFolderPath) => {
          const folderLabel =
            targetFolderPath === WORKSPACE_UPLOADS_DIR
              ? t("files.move_to_root")
              : targetFolderPath.split("/").pop() || targetFolderPath;
          props.onToast?.({
            tone: "success",
            title: t("files.move_to_success", { folder: folderLabel }),
            actionLabel: t("files.move_view"),
            onAction: () => {
              enterFolder(targetFolderPath);
              setPreviewState({ status: "idle" });
            },
            dismissLabel: t("common.dismiss"),
          });
          setMoveTarget(null);
          setRefreshKey((key) => key + 1);
        }}
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
