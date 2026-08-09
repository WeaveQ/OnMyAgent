/** @jsxImportSource react */
/**
 * State, effects, and handlers for the Mine uploads Files panel.
 * Extracted from workspace-files-uploads-panel (P1-5 file-size split).
 */
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
} from "react";
import { revealDesktopItemInDir } from "../../../app/lib/desktop";
import { type OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import { formatWorkspaceFileSize } from "../../capabilities/artifacts/workspace-file-tree";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";
import {
  FILE_PREVIEW_SELECTION_DEBOUNCE_MS,
  shouldForceExternalPreviewForSize,
} from "../../capabilities/artifacts/file-preview-policy";
import {
  buildTreeNodesFromUploadRows,
  buildTreeOutlineRows,
  buildUserUploadRelativePath,
  canPreviewWorkspaceFileInline,
  collectExpandableDirPaths,
  filterUploadRows,
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
import { type WorkspaceFilePreviewState } from "./workspace-files-preview-drawer";
import { useFilesTableSort } from "./workspace-files-table-sort";
import {
  CLIENT_INBOX_MAX_BYTES_DEFAULT,
  formatUploadError,
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

export type UseWorkspaceFilesUploadsPanelArgs = {
  /** Hidden keep-alive rails retain data but must not start I/O. */
  active?: boolean;
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
};

export function useWorkspaceFilesUploadsPanel(props: UseWorkspaceFilesUploadsPanelArgs) {
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
  const migratedWorkspaceIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);
  const manualRefreshRef = useRef(false);
  const dragDepthRef = useRef(0);

  const workspaceId = props.workspaceId.trim();
  const workspaceRoot = String(props.workspaceRoot ?? "").trim();
  const canLoad = Boolean(props.client && workspaceId);

  useEffect(() => {
    if (props.active === false) return;
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
        if (migratedWorkspaceIdRef.current !== workspaceId) {
          try {
            const inboxList = await client.listInbox(workspaceId);
            if (cancelled) return;
            const plan = planInboxToUploadsMigration(
              (inboxList.items ?? []).map(
                (item: { path?: string; name?: string }) =>
                  item.path || item.name || "",
              ),
            );
            for (const item of plan) {
              if (cancelled) return;
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
          if (cancelled) return;
          migratedWorkspaceIdRef.current = workspaceId;
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
  }, [canLoad, currentFolderPath, props.active, props.client, refreshKey, workspaceId]);

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
    if (props.active === false) return;
    const handle = window.setTimeout(() => {
      setPreviewSelection({ row: selectedRow, target: selectedTarget });
    }, FILE_PREVIEW_SELECTION_DEBOUNCE_MS);
    return () => window.clearTimeout(handle);
  }, [props.active, selectedRow, selectedTarget]);

  // Load preview for selected inbox file (same modes as Task browser).
  useEffect(() => {
    if (previewObjectUrlRef.current) {
      URL.revokeObjectURL(previewObjectUrlRef.current);
      previewObjectUrlRef.current = null;
    }
    const activeRow = previewSelection.row;
    const activeTarget = previewSelection.target;
    if (
      props.active === false ||
      !activeRow ||
      !activeTarget ||
      !props.client ||
      !workspaceId
    ) {
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
  }, [previewSelection, props.active, props.client, workspaceId, workspaceRoot]);

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

  return {
    canLoad,
    workspaceId,
    workspaceRoot,
    fileInputRef,
    rows,
    loading,
    error,
    catalogTruncated,
    query,
    setQuery,
    typeFilter,
    setTypeFilter,
    typeMenuOpen,
    setTypeMenuOpen,
    sortKey,
    sortDir,
    toggleSort,
    uploading,
    refreshDone,
    setRefreshDone,
    dragActive,
    selectedId,
    setSelectedId,
    previewState,
    setPreviewState,
    copiedPath,
    pathCopiedFlash,
    pendingDelete,
    setPendingDelete,
    createFolderOpen,
    setCreateFolderOpen,
    createFolderName,
    setCreateFolderName,
    createFolderBusy,
    dropTargetId,
    setDropTargetId,
    moveBusy,
    treeMode,
    setExpandedPaths,
    moveTarget,
    setMoveTarget,
    filterActive,
    treeRows,
    treeAllExpanded,
    expandableDirPaths,
    visibleRows,
    rowByPath,
    enterFolder,
    toggleTreeExpanded,
    expandAllTree,
    collapseAllTree,
    selectedRow,
    selectedTarget,
    selectedPreviewNode,
    importFiles,
    onPickClick,
    onDragEnter,
    onDragLeave,
    onDragOver,
    onDrop,
    workspaceRelativeForRow,
    absoluteForRow,
    handleOpenInFolder,
    handleOpenExternally,
    handleCopyPath,
    handleDeleteFile,
    handleMineDragStart,
    handleFolderDragOver,
    handleFolderDragLeave,
    handleFolderDrop,
    confirmDelete,
    confirmCreateFolder,
    closePreview,
    showEmpty,
    showTable,
    breadcrumbSegments,
    showBreadcrumb,
    setRefreshKey,
    manualRefreshRef,
  };
}
