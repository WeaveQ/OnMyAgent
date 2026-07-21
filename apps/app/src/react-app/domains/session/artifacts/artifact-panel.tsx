/** @jsxImportSource react */
import { lazy, Suspense, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderOpen, MoreHorizontal, Trash2, X } from "lucide-react";

import type { OnMyAgentServerClient } from "@/app/lib/onmyagent-server";
import { revealDesktopItemInDir } from "@/app/lib/desktop";
import { PanelTab, PanelTabAction, PanelTabItem, PanelTabList } from "@/components/panel-tabs";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { formatFileSize } from "@/lib/utils";
import { ConfirmModal } from "@/react-app/design-system/modals/confirm-modal";
import { ArtifactIcon } from "./artifact-icon";
import type { BinaryData, Data, OpenTarget, TextData } from "./open-target";
import { resolveArtifactAbsolutePath } from "./open-target";
import { HTMLPreview, ImagePreview, MarkdownPreview, PlainText, PreviewError, PreviewLoading, PreviewUnavailable } from "./preview";

import { t } from "../../../../i18n";
const ArtifactTextEditor = lazy(() =>
  import("./artifact-text-editor").then((module) => ({ default: module.ArtifactTextEditor })),
);
const ArtifactSpreadsheetEditor = lazy(() =>
  import("./artifact-spreadsheet-editor").then((module) => ({ default: module.ArtifactSpreadsheetEditor })),
);

type ArtifactPanelProps = {
  client: OnMyAgentServerClient;
  workspaceId: string;
  workspaceRoot: string;
  isRemoteWorkspace?: boolean;
  target: OpenTarget;
  targets?: OpenTarget[];
  onSelectTarget?: (target: OpenTarget) => void;
  onDeleteTarget?: (target: OpenTarget) => void;
  onClose: () => void;
};

type ArtifactQueryState =
  | (TextData & { updatedAt: number | null })
  | (BinaryData & { contentType: string | null; updatedAt: number | null });

type SaveArtifactInput = Data & { baseUpdatedAt: number | null };

function absoluteWorkspacePath(root: string, path: string) {
  return resolveArtifactAbsolutePath(path, root) ?? path.trim();
}

function isTextContent(target: OpenTarget): boolean {
  return ["markdown", "text", "sheet", "html"].includes(target.preview) && !/\.(xlsx|xls|ods)$/i.test(target.value);
}

function inferContentType(target: OpenTarget): string | undefined {
  if (target.preview === "pdf") return "application/pdf";
  if (target.preview === "image") {
    const ext = target.value.toLowerCase().split(".").pop() ?? "";
    if (ext === "png") return "image/png";
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "gif") return "image/gif";
    if (ext === "webp") return "image/webp";
    if (ext === "svg") return "image/svg+xml";
  }
  return undefined;
}

export function ArtifactPanel({ client, workspaceId, workspaceRoot, isRemoteWorkspace = false, target, targets = [], onSelectTarget, onDeleteTarget, onClose }: ArtifactPanelProps) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [pendingDeleteTarget, setPendingDeleteTarget] = useState<OpenTarget | null>(null);
  const isDirectTextEdit = isTextContent(target) && target.preview === "markdown";
  const externalPath = useMemo(() => target.kind === "file" ? absoluteWorkspacePath(workspaceRoot, target.value) : target.value, [target.kind, target.value, workspaceRoot]);

  const { data, error, isError, isLoading } = useQuery<ArtifactQueryState>({
    queryKey: ["artifact-panel", workspaceId, target.id] as const,
    queryFn: async () => {
      if (target.kind === "url") {
        throw new Error("URLs open in browser tabs.");
      }
      else if (target.exists === false) {
        throw new Error("File not found in this workspace.");
      }

      if (isTextContent(target)) {
        const result = await client.readWorkspaceFile(workspaceId, target.value);
        
        return { kind: "text", data: result.content, updatedAt: result.updatedAt ?? null };
      }

      const result = await client.downloadWorkspaceFile(workspaceId, target.value);

      return { kind: "binary", data: result.data, contentType: result.contentType, updatedAt: target.updatedAt ?? null };
    },
    refetchOnReconnect: false,
    refetchOnWindowFocus: false,
    staleTime: Infinity,
  });

  const [binaryObjectUrl, setBinaryObjectUrl] = useState<string | null>(null);

  useEffect(() => {
    if (!data || data.kind !== "binary") {
      setBinaryObjectUrl(null);

      return;
    }

    const inferredContentType = inferContentType(target);
    const blobType = data.contentType && data.contentType !== "application/octet-stream"
      ? data.contentType
      : inferredContentType ?? "application/octet-stream";
    const url = URL.createObjectURL(new Blob([data.data], { type: blobType }));

    setBinaryObjectUrl(url);

    return () => URL.revokeObjectURL(url);
  }, [data]);

  useEffect(() => {
    setEditing(false);
    setDraft("");
  }, [target.id, workspaceId]);

  useEffect(() => {
    if (data?.kind === "text") {
      setDraft(data.data);
    }
  }, [data]);

  const { mutate, mutateAsync, isPending: isSaving } = useMutation({
    mutationFn: async (input: SaveArtifactInput) => {
      if (target.kind !== "file") {
        throw new Error("Cannot save non-file artifact.");
      }

      if (input.kind === "text") {
        return client.writeWorkspaceFile(workspaceId, { path: target.value, content: input.data, baseUpdatedAt: input.baseUpdatedAt });
      }

      return client.writeWorkspaceBinaryFile(workspaceId, { path: target.value, data: input.data, baseUpdatedAt: input.baseUpdatedAt });
    },
    onSuccess: (result, input) => {
      queryClient.setQueryData<ArtifactQueryState>(
        ["artifact-panel", workspaceId, target.id] as const,
        input.kind === "text"
          ? { kind: "text", data: input.data, updatedAt: result.updatedAt ?? null }
          : { kind: "binary", data: input.data, contentType: data?.kind === "binary" ? data.contentType : null, updatedAt: result.updatedAt ?? null },
      );

      if (input.kind === "text") {
        setDraft(input.data);
      }
    },
  });

  const download = async () => {
    if (target.kind === "url") {
      return;
    }
    
    const result = await client.downloadWorkspaceFile(workspaceId, target.value);
    const url = URL.createObjectURL(new Blob([result.data], { type: result.contentType ?? "application/octet-stream" }));
    const anchor = document.createElement("a");

    anchor.href = url;
    anchor.download = target.name;
    anchor.click();

    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const openExternal = async () => {
    if (target.kind === "url") {
      window.open(target.value, "_blank", "noopener,noreferrer");

      return;
    }
    else if (!isRemoteWorkspace) {
      try {
        await revealDesktopItemInDir(externalPath);
      } catch (error) {
        console.error("Failed to reveal item in folder:", error);
      }

      return;
    }

    await download();
  };

  const revealTarget = async (item: OpenTarget) => {
    if (item.kind !== "file") return;
    await revealDesktopItemInDir(absoluteWorkspacePath(workspaceRoot, item.value));
  };

  const confirmDeleteTarget = async () => {
    const item = pendingDeleteTarget;
    if (!item || item.kind !== "file") return;

    try {
      await client.deleteWorkspaceFile(workspaceId, item.value);
      queryClient.removeQueries({ queryKey: ["artifact-panel", workspaceId, item.id] });
      setPendingDeleteTarget(null);
      onDeleteTarget?.(item);

      const nextTarget = targets.find((candidate) => candidate.id !== item.id);
      if (nextTarget) {
        onSelectTarget?.(nextTarget);
      } else {
        onClose();
      }
    } catch (deleteError) {
      console.error("Failed to delete artifact:", deleteError);
    }
  };

  const save = () => {
    if (target.kind !== "file" || !isTextContent(target) || data?.kind !== "text") {
      return;
    }

    mutate(
      {
        kind: "text",
        data: draft,
        baseUpdatedAt: data.updatedAt,
      },
      { onSuccess: () => setEditing(false) },
    );
  };

  const saveSpreadsheetContent = async (payload: Data) => {
    if (target.kind !== "file") {
      return;
    }

    await mutateAsync({
      ...payload,
      baseUpdatedAt: data?.kind === payload.kind ? data.updatedAt : target.updatedAt ?? null,
    });
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background">
      <div
        data-panel-titlebar="true"
        className="shrink-0 border-b border-dls-border bg-dls-background mac:bg-dls-background/80 mac:titlebar-drag mac:backdrop-blur-2xl mac:backdrop-saturate-150"
      >
        {targets.length > 0 ? (
          <div className="flex h-10 items-center gap-1 border-b border-dls-border/60 px-2">
            <div className="min-w-0 flex-1 overflow-x-auto mac:titlebar-no-drag">
              <PanelTabList values={targets.map((item) => item.id)} onReorder={() => {}}>
                {targets.map((item) => (
                  <PanelTabItem
                    key={item.id}
                    value={item.id}
                  >
                    <PanelTab
                      active={item.id === target.id}
                      title={`${item.value}${item.exists === false ? " (missing)" : ""}`}
                      onClick={() => onSelectTarget?.(item)}
                    >
                      <ArtifactIcon type={item.preview} />
                      <span className="truncate">{item.name}{item.exists === false ? " · missing" : ""}</span>
                    </PanelTab>
                    {item.kind === "file" ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger
                          render={(
                            <PanelTabAction
                              aria-label={t("files.file_actions", { name: item.name })}
                              title={t("files.file_actions", { name: item.name })}
                            >
                              <MoreHorizontal />
                            </PanelTabAction>
                          )}
                        />
                        <DropdownMenuContent align="end" className="min-w-40">
                          {!isRemoteWorkspace ? (
                            <DropdownMenuItem onClick={() => void revealTarget(item)}>
                              <FolderOpen />
                              {t("files.open_in_folder")}
                            </DropdownMenuItem>
                          ) : null}
                          <DropdownMenuItem
                            variant="destructive"
                            onClick={() => setPendingDeleteTarget(item)}
                          >
                            <Trash2 />
                            {t("common.delete")}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </PanelTabItem>
                ))}
              </PanelTabList>
            </div>
          </div>
        ) : null}
        <div className="flex h-10 items-center gap-2 pe-2 ps-4">
          <div className="min-w-0 flex-1 flex items-center gap-1.5">
            <h3 className="text-sm font-medium text-dls-text">
              <span className="truncate">{target.name}</span>
            </h3>
            <span className="truncate text-xs text-dls-secondary">
              {target.exists === false ? "missing" : target.size !== undefined ? `${formatFileSize(target.size)}` : ""}
            </span>
          </div>
          {isTextContent(target) && data?.kind === "text" ? (
            editing || isDirectTextEdit ? (
              <>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          if (data?.kind === "text") {
                            setDraft(data.data);
                          }
                          setEditing(false);
                        }}
                        disabled={isSaving}
                      >
                        Discard
                      </Button>
                    )}
                  />
                  <TooltipContent>{t("session.artifact_discard_changes")}</TooltipContent>
                </Tooltip>
                <Tooltip>
                  <TooltipTrigger
                    render={(
                      <Button variant="default" size="sm" onClick={() => void save()} disabled={isSaving || draft === data.data}>{isSaving ? "Saving" : "Save"}</Button>
                    )}
                  />
                  <TooltipContent>{t("session.artifact_save_changes")}</TooltipContent>
                </Tooltip>
              </>
            ) : (
              <Tooltip>
                <TooltipTrigger
                  render={(
                    <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button>
                  )}
                />
                <TooltipContent>{t("session.artifact_edit")}</TooltipContent>
              </Tooltip>
            )
          ) : null}
          {target.kind === "file" ? (
            <Tooltip>
              <TooltipTrigger
                render={(
                  <Button variant="ghost" size="icon-sm" onClick={() => void download()} aria-label={t("session.artifact_download")}>
                    <Download />
                  </Button>
                )}
              />
              <TooltipContent>{t("session.artifact_download")}</TooltipContent>
            </Tooltip>
          ) : null}
          <Tooltip>
            <TooltipTrigger
              render={(
                  <Button variant="ghost" size="icon-sm" onClick={() => void openExternal()} aria-label={isRemoteWorkspace ? t("session.artifact_download") : t("files.open_in_folder")}>
                  {isRemoteWorkspace ? <Download /> : <FolderOpen />}
                </Button>
              )}
            />
            <TooltipContent>{isRemoteWorkspace ? t("session.artifact_download") : t("files.open_in_folder")}</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger
              render={(
                <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={t("session.artifact_close")}>
                  <X />
                </Button>
              )}
            />
            <TooltipContent>{t("session.artifact_close")}</TooltipContent>
          </Tooltip>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {isLoading || (data?.kind === "binary" && !binaryObjectUrl) ? (
          <PreviewLoading />
        ) : isError ? (
          <PreviewError message={error instanceof Error ? error.message : "Failed to load artifact" } />
        ) : data?.kind === "text" && (editing || isDirectTextEdit) ? (
          <TextEditor value={draft} language={target.preview === "markdown" ? "markdown" : "text"} onChange={setDraft} />
        ) : target.preview === "markdown" && data?.kind === "text" ? (
          <MarkdownPreview content={data.data} />
        ) : target.preview === "sheet" && /\.(xlsx|xls|ods)$/i.test(target.value) ? (
          <UnsupportedBinaryNotice
            onReveal={isRemoteWorkspace ? undefined : () => void revealDesktopItemInDir(externalPath)}
            onDownload={() => void download()}
          />
        ) : target.preview === "sheet" ? (
          <SheetEditor
            name={target.name}
            content={data ?? { kind: "binary", data: new ArrayBuffer(0) }}
            saving={isSaving}
            onSave={saveSpreadsheetContent}
          />
        ) : target.preview === "html" && data?.kind === "text" ? (
          <HTMLPreview type="text" title={target.name} content={data.data} />
        ) : target.preview === "image" && data?.kind === "binary" && binaryObjectUrl ? (
          <ImagePreview src={binaryObjectUrl} alt={target.name} />
        ) : data?.kind === "binary" && binaryObjectUrl && (target.preview === "pdf" || target.preview === "html") ? (
          <HTMLPreview type="binary" title={target.name} url={binaryObjectUrl} />
        ) : data?.kind === "text" ? (
          <PlainText content={data.data} />
        ) : (
          <PreviewUnavailable />
        )}
      </div>
      <ConfirmModal
        open={pendingDeleteTarget !== null}
        title={t("files.delete_confirm_title")}
        message={t("files.delete_confirm_desc", { name: pendingDeleteTarget?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => void confirmDeleteTarget()}
        onCancel={() => setPendingDeleteTarget(null)}
      />
    </div>
  );
}

interface TextEditorProps extends React.ComponentProps<typeof ArtifactTextEditor> {
  value: string;
  language: "markdown" | "text";
  onChange: (value: string) => void;
}

function TextEditor({ value, language, onChange, ...props }: TextEditorProps) {
  return (
    <Suspense fallback={<PreviewLoading />}>
      <ArtifactTextEditor value={value} language={language} onChange={onChange} {...props} />
    </Suspense>
  );
}

interface SheetEditorProps extends React.ComponentProps<typeof ArtifactSpreadsheetEditor> {
  
}

function SheetEditor({ className, ...props }: SheetEditorProps) {
  return (
    <Suspense fallback={<PreviewLoading />}>
      <ArtifactSpreadsheetEditor
        className={className}
        {...props}
      />
    </Suspense>
  );
}

interface UnsupportedBinaryNoticeProps {
  onReveal?: () => void;
  onDownload?: () => void;
}

function UnsupportedBinaryNotice({ onReveal, onDownload }: UnsupportedBinaryNoticeProps) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
      <p className="max-w-sm text-sm text-dls-secondary">{t("session.artifact_binary_preview_unsupported")}</p>
      <div className="flex items-center gap-2">
        {onReveal ? (
          <Button variant="default" size="sm" onClick={onReveal}>
            <FolderOpen data-icon="inline-start" className="size-3.5" />
            {t("files.open_in_folder")}
          </Button>
        ) : null}
        {onDownload ? (
          <Button variant="outline" size="sm" onClick={onDownload}>
            <Download data-icon="inline-start" className="size-3.5" />
            {t("session.artifact_download")}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
