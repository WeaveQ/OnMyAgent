/** @jsxImportSource react */
/**
 * Files page — 用户上传 tab: list inbox (workspace copies) + import-by-copy.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileUp, Loader2, Upload } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import type { OnMyAgentServerClient } from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import { formatWorkspaceFileSize, formatWorkspaceFileTime } from "../../capabilities/artifacts/workspace-file-tree";
import {
  buildUserUploadRelativePath,
  filterUploadRows,
  mapInboxItemsToUploadRows,
  type UserUploadRow,
} from "./workspace-files-model";

export function WorkspaceFilesUploadsPanel(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
}) {
  const [rows, setRows] = useState<UserUploadRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadNotice, setUploadNotice] = useState<string | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const workspaceId = props.workspaceId.trim();
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

  const importFiles = useCallback(
    async (fileList: FileList | File[]) => {
      if (!props.client || !workspaceId) return;
      const files = Array.from(fileList);
      if (files.length === 0) return;
      setUploading(true);
      setUploadNotice(null);
      setError(null);
      try {
        for (const file of files) {
          const path = buildUserUploadRelativePath(file.name);
          await props.client.uploadInbox(workspaceId, file, { path });
        }
        setUploadNotice(t("files.upload_copy_success"));
        setRefreshKey((key) => key + 1);
      } catch (uploadError) {
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : t("files.upload_failed"),
        );
      } finally {
        setUploading(false);
      }
    },
    [props.client, workspaceId],
  );

  const onPickClick = () => {
    fileInputRef.current?.click();
  };

  const showEmpty = !loading && !error && visibleRows.length === 0;
  const showTable = !loading && visibleRows.length > 0;

  return (
    <div className="mx-auto flex h-full min-h-0 w-full max-w-6xl flex-col">
      <div className="mb-4 flex shrink-0 flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 max-w-xl">
          <h1 className={typeScale.pageTitle}>{t("files.title")}</h1>
          <p className={cn(typeScale.pageSubtitle, "mt-1")}>
            {t("files.source_uploads_desc")}
          </p>
        </div>
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-end gap-2 sm:max-w-lg">
          <InputGroup controlSize="sm" radius="md" tone="surface" className="min-w-[12rem] max-w-xs flex-1">
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

      {uploadNotice ? (
        <p className="mb-3 shrink-0 text-sm text-dls-status-success-fg">
          {uploadNotice}
        </p>
      ) : null}
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
        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-dls-border">
          <table className="w-full caption-bottom text-sm">
            <TableHeader className="sticky top-0 z-10 bg-dls-background">
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-[50%]">{t("files.column_name")}</TableHead>
                <TableHead>{t("files.column_size")}</TableHead>
                <TableHead>{t("files.column_updated")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visibleRows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell>
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
                  <TableCell className="text-dls-secondary">
                    {formatWorkspaceFileSize(row.size)}
                  </TableCell>
                  <TableCell className="text-dls-secondary">
                    {row.updatedAt
                      ? formatWorkspaceFileTime(row.updatedAt)
                      : "—"}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
