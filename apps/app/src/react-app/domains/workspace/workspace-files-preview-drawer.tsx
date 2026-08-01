/** @jsxImportSource react */
/**
 * Shared file preview drawer used by Task/Expert browser and My files (uploads).
 */
import { createPortal } from "react-dom";
import { Copy, ExternalLink, Folder, Pencil, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import { OfficeFilePreview } from "../../capabilities/artifacts/office-file-preview";
import { ArtifactSpreadsheetEditor } from "../../capabilities/artifacts/artifact-spreadsheet-editor";
import type { OpenTarget } from "../../capabilities/artifacts/open-target";
import {
  HTMLPreview,
  ImagePreview,
  MarkdownPreview,
  PlainText,
  PreviewError,
  PreviewLoading,
  PreviewUnavailable,
} from "../../capabilities/artifacts/preview";
import {
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
} from "../../capabilities/artifacts/workspace-file-tree";

export type WorkspaceFilePreviewNode = {
  name: string;
  path: string;
  kind: "file" | "dir";
  size: number;
  mtimeMs: number;
};

export type WorkspaceFilePreviewState =
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

export function FilePreviewDrawer(props: {
  open: boolean;
  file: WorkspaceFilePreviewNode | null;
  target: OpenTarget | null;
  state: WorkspaceFilePreviewState;
  copied: boolean;
  onClose: () => void;
  onCopyPath: () => void;
  onEdit?: () => void;
  onOpenInFolder?: () => void;
  onOpenExternally?: () => void;
}) {
  const {
    open,
    file,
    target,
    state,
    copied,
    onClose,
    onCopyPath,
    onEdit,
    onOpenInFolder,
    onOpenExternally,
  } = props;

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
          // 60% of viewport — room for spreadsheet/office preview chrome
          "absolute inset-y-0 right-0 flex w-[60vw] min-w-[360px] max-w-none translate-x-full flex-col border-l border-dls-border bg-dls-surface transition-transform duration-200 ease-out",
          open && "translate-x-0",
        )}
      >
        {file && target ? (
          <>
            <header className="flex items-start gap-3 border-b border-dls-border px-5 py-4">
              <ArtifactIcon
                type={target.preview}
                name={file.name}
                className="mt-0.5 size-5 shrink-0"
              />
              <div className="min-w-0 flex-1">
                <div
                  className="truncate text-sm font-medium text-dls-text"
                  title={file.name}
                >
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
                  <Pencil
                    data-icon="inline-start"
                    className="size-3.5"
                    aria-hidden="true"
                  />
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
                <HTMLPreview
                  type="text"
                  title={file.name}
                  content={state.content}
                />
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
