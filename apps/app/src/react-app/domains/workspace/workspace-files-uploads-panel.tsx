/** @jsxImportSource react */
/**
 * Files page — 我的文件 (uploads): inbox list + import-by-copy + preview/open actions
 * (parity with Task files drawer chrome where applicable).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Copy,
  ExternalLink,
  FileUp,
  FolderOpen,
  Loader2,
  MoreHorizontal,
  Upload,
} from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { revealDesktopItemInDir } from "../../../app/lib/desktop";
import {
  OnMyAgentServerError,
  type OnMyAgentServerClient,
} from "../../../app/lib/onmyagent-server";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
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
  absoluteInboxFilePath,
  buildUserUploadRelativePath,
  canPreviewWorkspaceFileInline,
  filterUploadRows,
  mapInboxItemsToUploadRows,
  usesLocalFileRenderer,
  workspaceRelativeInboxPath,
  type UserUploadRow,
} from "./workspace-files-model";
import {
  FilePreviewDrawer,
  type WorkspaceFilePreviewState,
} from "./workspace-files-preview-drawer";

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
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

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
}) {
  const [rows, setRows] = useState<UserUploadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [previewState, setPreviewState] = useState<WorkspaceFilePreviewState>({
    status: "idle",
  });
  const [copiedPath, setCopiedPath] = useState(false);
  const [pathCopiedFlash, setPathCopiedFlash] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewObjectUrlRef = useRef<string | null>(null);

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
    void props.client
      .listInbox(workspaceId)
      .then((list) => {
        if (cancelled) return;
        setRows(mapInboxItemsToUploadRows(list.items ?? []));
      })
      .catch((loadError) => {
        if (cancelled) return;
        setRows([]);
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
  }, [canLoad, props.client, refreshKey, workspaceId]);

  const visibleRows = useMemo(
    () => filterUploadRows(rows, query),
    [query, rows],
  );

  const selectedRow = useMemo(
    () => visibleRows.find((row) => row.id === selectedId) ?? null,
    [selectedId, visibleRows],
  );

  const selectedTarget = useMemo(() => {
    if (!selectedRow) return null;
    const root = workspaceRoot || "/";
    const workspaceRel = workspaceRelativeInboxPath(selectedRow.path);
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
      path: workspaceRelativeInboxPath(selectedRow.path),
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
    const workspaceRel = workspaceRelativeInboxPath(activeRow.path);
    const abs = absoluteInboxFilePath(workspaceRoot, activeRow.path);

    if (activeTarget.preview === "image") {
      void props.client
        .downloadWorkspaceFile(workspaceId, workspaceRel)
        .then((result) => {
          if (cancelled) return;
          const objectUrl = URL.createObjectURL(
            new Blob([result.data], {
              type: result.contentType ?? "application/octet-stream",
            }),
          );
          previewObjectUrlRef.current = objectUrl;
          setPreviewState({ status: "binary", url: objectUrl });
        })
        .catch((previewError: unknown) => {
          if (cancelled) return;
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
      const files = Array.from(fileList);
      if (files.length === 0) return;
      setUploading(true);
      setUploadNotice(null);
      setError(null);
      let currentFile: File | undefined;
      try {
        for (const file of files) {
          currentFile = file;
          if (file.size > CLIENT_INBOX_MAX_BYTES_DEFAULT) {
            setError(
              t("files.upload_too_large", {
                name: file.name.trim() || "file",
                size: formatWorkspaceFileSize(file.size),
                max: formatWorkspaceFileSize(CLIENT_INBOX_MAX_BYTES_DEFAULT),
              }),
            );
            return;
          }
          const path = buildUserUploadRelativePath(file.name);
          await props.client.uploadInbox(workspaceId, file, { path });
        }
        // Keep source_uploads_desc as the only policy line; success is brief.
        setUploadNotice(
          files.length === 1
            ? t("files.upload_copy_success_one")
            : t("files.upload_copy_success", { count: String(files.length) }),
        );
        setRefreshKey((key) => key + 1);
        window.setTimeout(() => setUploadNotice(null), 4000);
      } catch (uploadError) {
        setError(formatUploadError(uploadError, currentFile));
      } finally {
        setUploading(false);
      }
    },
    [props.client, workspaceId],
  );

  const onPickClick = () => {
    fileInputRef.current?.click();
  };

  const absoluteForRow = useCallback(
    (row: UserUploadRow) => absoluteInboxFilePath(workspaceRoot, row.path),
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
        : workspaceRelativeInboxPath(row.path);
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

  const closePreview = useCallback(() => {
    setSelectedId(null);
    setPreviewState({ status: "idle" });
  }, []);

  const showEmpty = !loading && !error && visibleRows.length === 0;
  const showTable = !loading && visibleRows.length > 0;

  return (
    {/* Same gutters as 市场 pluginsLayoutClass.pageContainer */}
    <div className="flex h-full min-h-0 w-full flex-col px-6 pb-10 pt-5">
      <div className="mb-4 flex w-full shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1 text-left sm:max-w-none">
          <h1 className={cn(typeScale.pageTitle, "text-left")}>
            {t("files.source_uploads_title")}
          </h1>
          {/* Single subtitle slot: success notice replaces desc (never both). */}
          <p
            className={cn(
              typeScale.pageSubtitle,
              "mt-1 text-left",
              uploadNotice ? "text-dls-status-success-fg" : null,
            )}
          >
            {uploadNotice ?? t("files.source_uploads_desc")}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center justify-end gap-2">
          <InputGroup controlSize="sm" radius="md" tone="surface" className="min-w-[12rem] w-56 sm:w-64">
            <InputGroupAddon align="inline-start">
              <span className="sr-only">{t("files.search_uploads_placeholder")}</span>
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("files.search_uploads_placeholder")}
              disabled={loading || uploading}
            />
          </InputGroup>
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
            size="default"
            disabled={!canLoad || uploading || loading}
            onClick={onPickClick}
            className="h-9 gap-1.5"
          >
            {uploading ? (
              <Loader2 className="size-3.5 animate-spin" aria-hidden />
            ) : (
              <Upload className="size-3.5" aria-hidden />
            )}
            {uploading ? t("files.uploading") : t("files.import_to_workspace")}
          </Button>
        </div>
      </div>

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
      ) : loading ? (
        <div
          className="flex min-h-[280px] flex-col items-center justify-center gap-2 text-sm text-dls-secondary"
          role="status"
          aria-busy="true"
        >
          <Loader2 className="size-5 animate-spin" aria-hidden />
          <span>{t("files.loading")}</span>
        </div>
      ) : showEmpty ? (
        <Empty className="min-h-[280px] border border-dashed border-dls-border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <FileUp className="size-5" aria-hidden />
            </EmptyMedia>
            <EmptyTitle>{t("files.uploads_empty_title")}</EmptyTitle>
            <EmptyDescription>{t("files.uploads_empty_hint")}</EmptyDescription>
          </EmptyHeader>
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
        </Empty>
      ) : showTable ? (
        <div className="min-h-0 w-full min-w-0 flex-1 overflow-auto rounded-xl border border-dls-border">
          <table className="w-full table-fixed caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-dls-background">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-auto text-left">
                  {t("files.column_name")}
                </TableHead>
                <TableHead className="w-28 text-left">
                  {t("files.column_size")}
                </TableHead>
                <TableHead className="w-40 text-left">
                  {t("files.column_updated")}
                </TableHead>
                <TableHead className="w-12 text-left">
                  <span className="sr-only">{t("files.file_actions", { name: "" })}</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => {
                const selected = row.id === selectedId;
                return (
                  <TableRow
                    key={row.id}
                    data-state={selected ? "selected" : undefined}
                    className={cn(
                      "group cursor-pointer",
                      selected && "bg-dls-surface-muted/80",
                    )}
                    onClick={() => setSelectedId(row.id)}
                    onDoubleClick={() => void handleOpenExternally(row)}
                  >
                    <TableCell className="text-left">
                      <div className="flex min-w-0 items-center gap-2">
                        <ArtifactIcon
                          name={row.name}
                          className="size-4 shrink-0"
                        />
                        <span className="truncate font-medium text-dls-text">
                          {row.name}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="text-left text-dls-secondary">
                      {formatWorkspaceFileSize(row.size)}
                    </TableCell>
                    <TableCell className="text-left text-dls-secondary">
                      {row.updatedAt
                        ? formatWorkspaceFileTime(row.updatedAt)
                        : "—"}
                    </TableCell>
                    <TableCell className="relative py-2 text-left">
                      <UploadRowActionsMenu
                        name={row.name}
                        pathCopied={pathCopiedFlash === row.id}
                        onPreview={() => setSelectedId(row.id)}
                        onOpenExternally={() => void handleOpenExternally(row)}
                        onOpenInFolder={() => void handleOpenInFolder(row)}
                        onCopyPath={() => void handleCopyPath(row)}
                      />
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </table>
        </div>
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
                  path: workspaceRelativeInboxPath(selectedRow.path),
                  name: selectedRow.name,
                  preview: selectedTarget.preview,
                })
            : selectedRow && props.onAddToTask
              ? () =>
                  props.onAddToTask?.(
                    workspaceRelativeInboxPath(selectedRow.path),
                  )
              : undefined
        }
      />
    </div>
  );
}
