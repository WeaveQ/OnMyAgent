/** @jsxImportSource react */
/**
 * Hope-style "Move to" dialog: browse folders under uploads/, pick target, confirm.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { Folder, FolderPlus, Loader2, Search } from "lucide-react";

import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { cn } from "@/lib/utils";
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import {
  WORKSPACE_UPLOADS_DIR,
  mapUploadsCatalogToRows,
  type UserUploadRow,
} from "./workspace-files-model";
import {
  resolveMineMoveDestination,
  resolveUploadFolderRelativePath,
  sanitizeUploadFolderName,
} from "./workspace-files-create-folder";

export type MineMoveDialogProps = {
  open: boolean;
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  /** Workspace-relative source path of the file being moved. */
  sourcePath: string;
  sourceName: string;
  onClose: () => void;
  onMoved: (targetFolderPath: string) => void;
};

export function MineMoveToDialog(props: MineMoveDialogProps) {
  const [pickerPath, setPickerPath] = useState(WORKSPACE_UPLOADS_DIR);
  const [folders, setFolders] = useState<UserUploadRow[]>([]);
  const [selectedPath, setSelectedPath] = useState(WORKSPACE_UPLOADS_DIR);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");

  const loadFolders = useCallback(async () => {
    if (!props.client || !props.workspaceId.trim() || !props.open) return;
    setLoading(true);
    setError(null);
    try {
      const catalog = await props.client.listWorkspaceFiles(props.workspaceId, {
        includeDirs: true,
        prefix: WORKSPACE_UPLOADS_DIR,
        limit: 5000,
      });
      const rows = mapUploadsCatalogToRows(catalog.items ?? [], {
        parentPrefix: pickerPath,
        shallow: true,
      }).filter((row) => row.kind === "dir");
      setFolders(rows);
    } catch (loadError) {
      setFolders([]);
      setError(loadError instanceof Error ? loadError.message : t("files.load_failed"));
    } finally {
      setLoading(false);
    }
  }, [pickerPath, props.client, props.open, props.workspaceId]);

  useEffect(() => {
    if (!props.open) return;
    setPickerPath(WORKSPACE_UPLOADS_DIR);
    setSelectedPath(WORKSPACE_UPLOADS_DIR);
    setQuery("");
    setCreateOpen(false);
    setCreateName("");
    setError(null);
  }, [props.open, props.sourcePath]);

  useEffect(() => {
    if (!props.open) return;
    void loadFolders();
  }, [loadFolders, props.open]);

  const breadcrumb = useMemo(() => {
    const parts = pickerPath.replace(/\\/g, "/").split("/").filter(Boolean);
    return parts.map((part, index) => {
      const path = parts.slice(0, index + 1).join("/");
      const label = index === 0 && part === WORKSPACE_UPLOADS_DIR ? t("files.move_to_root") : part;
      return { path, label };
    });
  }, [pickerPath]);

  const visibleFolders = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return folders;
    return folders.filter((f) => f.name.toLowerCase().includes(q));
  }, [folders, query]);

  const canConfirm = useMemo(() => {
    const dest = resolveMineMoveDestination({
      sourceWorkspaceRelativePath: props.sourcePath,
      targetFolderWorkspaceRelativePath: selectedPath,
    });
    return dest != null && !busy;
  }, [busy, props.sourcePath, selectedPath]);

  const handleConfirm = useCallback(async () => {
    if (!props.client || !props.workspaceId.trim()) return;
    const dest = resolveMineMoveDestination({
      sourceWorkspaceRelativePath: props.sourcePath,
      targetFolderWorkspaceRelativePath: selectedPath,
    });
    if (!dest) {
      setError(t("files.move_invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.client.renameWorkspaceFile(props.workspaceId, dest.from, dest.to);
      props.onMoved(selectedPath);
      props.onClose();
    } catch (moveError) {
      setError(moveError instanceof Error ? moveError.message : t("files.move_failed"));
    } finally {
      setBusy(false);
    }
  }, [props, selectedPath]);

  const handleCreateFolder = useCallback(async () => {
    if (!props.client || !props.workspaceId.trim()) return;
    const name = sanitizeUploadFolderName(createName);
    if (!name) {
      setError(t("files.create_folder_invalid"));
      return;
    }
    const path = resolveUploadFolderRelativePath(name, pickerPath);
    if (!path) {
      setError(t("files.create_folder_invalid"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await props.client.mkdirWorkspaceDirectory(props.workspaceId, path);
      setCreateOpen(false);
      setCreateName("");
      setSelectedPath(path);
      await loadFolders();
    } catch (createError) {
      setError(
        createError instanceof Error ? createError.message : t("files.create_folder_failed"),
      );
    } finally {
      setBusy(false);
    }
  }, [createName, loadFolders, pickerPath, props.client, props.workspaceId]);

  if (!props.open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("files.move_to_title")}
      data-files-move-dialog="true"
      onClick={() => {
        if (!busy) props.onClose();
      }}
    >
      <div
        className="flex max-h-[min(36rem,90vh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-dls-border bg-dls-surface "
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-dls-border px-4 py-3">
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-dls-text">{t("files.move_to_title")}</h2>
            <p className="mt-0.5 text-xs text-dls-secondary">{t("files.move_to_hint")}</p>
          </div>
          <InputGroup
            controlSize="default"
            radius="lg"
            tone="surface"
            className="h-9 w-full max-w-[12rem] sm:w-44"
          >
            <InputGroupAddon align="inline-start">
              <Search className="size-3.5" />
            </InputGroupAddon>
            <InputGroupInput
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={t("files.move_to_search")}
              disabled={busy}
              className="h-9 text-sm"
            />
          </InputGroup>
        </div>

        <nav className="flex shrink-0 flex-wrap items-center gap-1 border-b border-dls-border px-4 py-2 text-xs text-dls-secondary">
          {breadcrumb.map((segment, index) => {
            const isLast = index === breadcrumb.length - 1;
            return (
              <span key={segment.path} className="inline-flex items-center gap-1">
                {index > 0 ? <span aria-hidden>/</span> : null}
                {isLast ? (
                  <span className="font-medium text-dls-text">{segment.label}</span>
                ) : (
                  <button
                    type="button"
                    className="hover:text-dls-text hover:underline"
                    disabled={busy}
                    onClick={() => {
                      setPickerPath(segment.path);
                      setSelectedPath(segment.path);
                    }}
                  >
                    {segment.label}
                  </button>
                )}
              </span>
            );
          })}
        </nav>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-2">
          {/* Always allow selecting current layer as destination */}
          <button
            type="button"
            disabled={busy}
            onClick={() => setSelectedPath(pickerPath)}
            className={cn(
              "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm transition-colors",
              selectedPath === pickerPath
                ? "bg-dls-accent/15 ring-1 ring-dls-accent/35"
                : "hover:bg-dls-hover",
            )}
          >
            <span
              className={cn(
                "flex size-4 shrink-0 items-center justify-center rounded-full border",
                selectedPath === pickerPath
                  ? "border-dls-accent bg-dls-accent"
                  : "border-dls-border",
              )}
              aria-hidden
            >
              {selectedPath === pickerPath ? (
                <span className="size-1.5 rounded-full bg-dls-accent-fg" />
              ) : null}
            </span>
            <Folder className="size-4 shrink-0 text-dls-accent" aria-hidden />
            <span className="min-w-0 flex-1 truncate font-medium text-dls-text">
              {pickerPath === WORKSPACE_UPLOADS_DIR
                ? t("files.move_to_root")
                : pickerPath.split("/").pop()}
            </span>
            <span className="shrink-0 text-2xs text-dls-secondary">
              {t("files.move_to_current")}
            </span>
          </button>

          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-dls-secondary">
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {t("files.loading")}
            </div>
          ) : visibleFolders.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-dls-secondary">
              {t("files.move_to_empty")}
            </p>
          ) : (
            visibleFolders.map((folder) => {
              const selected = selectedPath === folder.path;
              return (
                <div
                  key={folder.id}
                  className={cn(
                    "flex w-full items-center gap-1 rounded-xl pr-1 transition-colors",
                    selected && "bg-dls-accent/15 ring-1 ring-dls-accent/35",
                  )}
                >
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => setSelectedPath(folder.path)}
                    className="flex min-w-0 flex-1 items-center gap-3 px-3 py-2.5 text-left text-sm"
                  >
                    <span
                      className={cn(
                        "flex size-4 shrink-0 items-center justify-center rounded-full border",
                        selected ? "border-dls-accent bg-dls-accent" : "border-dls-border",
                      )}
                      aria-hidden
                    >
                      {selected ? (
                        <span className="size-1.5 rounded-full bg-dls-accent-fg" />
                      ) : null}
                    </span>
                    <Folder className="size-4 shrink-0 text-dls-accent" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-dls-text">{folder.name}</span>
                  </button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    className="h-8 shrink-0 px-2 text-xs text-dls-secondary"
                    onClick={() => {
                      setPickerPath(folder.path);
                      setSelectedPath(folder.path);
                    }}
                  >
                    {t("files.move_to_open")}
                  </Button>
                </div>
              );
            })
          )}
        </div>

        {error ? (
          <p className="shrink-0 px-4 pb-2 text-xs text-dls-status-danger-fg">{error}</p>
        ) : null}

        {createOpen ? (
          <div className="flex shrink-0 flex-wrap items-center gap-2 border-t border-dls-border px-4 py-2">
            <input
              autoFocus
              value={createName}
              onChange={(event) => setCreateName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void handleCreateFolder();
                }
              }}
              placeholder={t("files.create_folder_placeholder")}
              disabled={busy}
              className="h-9 min-w-0 flex-1 rounded-lg border border-dls-border bg-dls-background px-3 text-sm"
            />
            <Button
              type="button"
              size="sm"
              disabled={busy || !createName.trim()}
              onClick={() => void handleCreateFolder()}
            >
              {t("files.create_folder_confirm")}
            </Button>
          </div>
        ) : null}

        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-dls-border px-4 py-3">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={busy}
            className="gap-1.5"
            onClick={() => {
              setCreateOpen(true);
              setCreateName("");
            }}
          >
            <FolderPlus className="size-3.5" aria-hidden />
            {t("files.create_folder")}
          </Button>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={props.onClose}
            >
              {t("common.cancel")}
            </Button>
            <Button
              type="button"
              size="sm"
              disabled={!canConfirm}
              onClick={() => void handleConfirm()}
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : null}
              {t("files.move_to_confirm")}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
