/** @jsxImportSource react */
import { useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  FileText,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Sparkles,
  Upload,
  X,
} from "lucide-react";
import { t } from "@/i18n";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { NoticeBox } from "@/components/ui/notice-box";
import { ConfirmModal } from "../../design-system/modals/confirm-modal";
import { revealDesktopItemInDir } from "../../../app/lib/desktop";
import type {
  ExpertKnowledgeEntry,
  ExpertKnowledgeNode,
} from "./expert-creation-types";
import { IconCircle } from "./expert-creation-view-primitives";

export function joinKnowledgePath(parent: string, child: string): string {
  return parent ? `${parent}/${child}` : child;
}
export function listKnowledgeChildren(
  entries: ExpertKnowledgeEntry[],
  currentPath: string,
): ExpertKnowledgeNode[] {
  const prefix = currentPath ? `${currentPath}/` : "";
  const nodes = new Map<string, ExpertKnowledgeNode>();
  for (const entry of entries) {
    if (!entry.relativePath.startsWith(prefix)) continue;
    const remainder = entry.relativePath.slice(prefix.length);
    if (!remainder) continue;
    const [name, ...rest] = remainder.split("/");
    const relativePath = joinKnowledgePath(currentPath, name);
    const kind = rest.length > 0 ? "directory" : entry.kind;
    const previous = nodes.get(relativePath);
    if (!previous || kind === "directory") {
      nodes.set(relativePath, {
        kind,
        relativePath,
        name,
        ...(kind === "file" && entry.file ? { file: entry.file } : {}),
        ...(entry.stagedPath ? { stagedPath: entry.stagedPath } : {}),
      });
    }
  }
  return Array.from(nodes.values()).sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === "directory" ? -1 : 1;
    return left.name.localeCompare(right.name);
  });
}

export function removeKnowledgeNode(
  entries: ExpertKnowledgeEntry[],
  nodePath: string,
): ExpertKnowledgeEntry[] {
  return entries.filter((entry) => (
    entry.relativePath !== nodePath &&
    !entry.relativePath.startsWith(`${nodePath}/`)
  ));
}

function sourcePathForKnowledgeEntry(
  entries: ExpertKnowledgeEntry[],
  node: ExpertKnowledgeNode,
): string | null {
  const source = node.file ?? entries.find(
    (entry) => entry.file && (
      entry.relativePath === node.relativePath ||
      entry.relativePath.startsWith(`${node.relativePath}/`)
    ),
  )?.file;
  const stagedPath = node.stagedPath ?? entries.find(
    (entry) => entry.stagedPath && (
      entry.relativePath === node.relativePath ||
      entry.relativePath.startsWith(`${node.relativePath}/`)
    ),
  )?.stagedPath;
  return stagedPath ?? (
    source
      ? window.__ONMYAGENT_ELECTRON__?.files?.getPathForFile?.(source) ?? null
      : null
  );
}

export function KnowledgePanel(props: {
  entries: ExpertKnowledgeEntry[];
  staging: boolean;
  onEntriesChange: (entries: ExpertKnowledgeEntry[]) => Promise<void>;
}) {
  const documentInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const [folderDialogError, setFolderDialogError] = useState<"invalid" | "duplicate" | null>(null);
  const [knowledgeError, setKnowledgeError] = useState(false);
  const [folderDialogOpen, setFolderDialogOpen] = useState(false);
  const [folderName, setFolderName] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [pendingDelete, setPendingDelete] = useState<ExpertKnowledgeNode | null>(null);
  const children = useMemo(
    () => listKnowledgeChildren(props.entries, currentPath),
    [currentPath, props.entries],
  );
  const breadcrumbs = currentPath ? currentPath.split("/") : [];

  const addFiles = (files: File[]) => {
    const validFiles = files.filter((file) => {
      const relativePath = file.webkitRelativePath || file.name;
      const directorySegments = relativePath.split("/").slice(0, -1);
      return directorySegments.every((segment) => /^[A-Za-z0-9_-]+$/.test(segment));
    });
    setKnowledgeError(validFiles.length !== files.length);
    if (validFiles.length === 0) return;
    const next = new Map(props.entries.map((entry) => [entry.relativePath, entry]));
    for (const file of validFiles) {
      const relativePath = joinKnowledgePath(
        currentPath,
        file.webkitRelativePath || file.name,
      );
      next.set(relativePath, { kind: "file", relativePath, file });
    }
    void props.onEntriesChange(Array.from(next.values()));
  };

  const createFolder = () => {
    const name = folderName.trim();
    if (!/^[A-Za-z0-9_-]+$/.test(name.trim())) {
      setFolderDialogError("invalid");
      return;
    }
    const relativePath = joinKnowledgePath(currentPath, name);
    if (props.entries.some((entry) => entry.relativePath === relativePath)) {
      setFolderDialogError("duplicate");
      return;
    }
    setFolderDialogError(null);
    setFolderDialogOpen(false);
    setFolderName("");
    void props.onEntriesChange([
      ...props.entries,
      { kind: "directory", relativePath },
    ]);
  };

  const deleteNode = (node: ExpertKnowledgeNode) => {
    void props.onEntriesChange(removeKnowledgeNode(props.entries, node.relativePath));
    setPendingDelete(null);
  };

  const openFolderUpload = () => {
    folderInputRef.current?.setAttribute("webkitdirectory", "");
    folderInputRef.current?.click();
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="mt-1 text-sm text-dls-secondary">{t("agents.expert_creation_knowledge_desc")}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" disabled={props.staging} onClick={() => {
            setFolderDialogError(null);
            setFolderName("");
            setFolderDialogOpen(true);
          }}>
            <FolderPlus data-icon="inline-start" className="size-3.5" />
            {t("agents.expert_creation_create_folder")}
          </Button>
          <input
            ref={documentInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(event) => {
              addFiles(Array.from(event.currentTarget.files ?? []));
              event.currentTarget.value = "";
            }}
          />
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger
              render={
                <Button type="button" size="sm" variant="outline" disabled={props.staging}>
                  <Upload data-icon="inline-start" className="size-3.5" />
                  {t("agents.expert_creation_upload")}
                  <ChevronDown className="size-3.5" aria-hidden />
                </Button>
              }
            />
            <DropdownMenuContent
              align="end"
              sideOffset={6}
              className="min-w-40 border border-dls-border bg-dls-surface-solid p-1.5 text-dls-text"
            >
              <DropdownMenuItem
                onClick={() => documentInputRef.current?.click()}
                className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
              >
                <Upload className="size-4 text-dls-secondary" aria-hidden />
                {t("agents.expert_creation_upload_document")}
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={openFolderUpload}
                className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
              >
                <FolderPlus className="size-4 text-dls-secondary" aria-hidden />
                {t("agents.expert_creation_upload_folder")}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {knowledgeError ? (
        <NoticeBox role="alert" tone="error" size="content">
          {t("agents.expert_creation_knowledge_path_error")}
        </NoticeBox>
      ) : null}
      {props.entries.length > 0 || currentPath ? (
        <div className="space-y-2">
          <nav className="flex min-w-0 items-center gap-1 text-sm text-dls-secondary" aria-label={t("files.breadcrumb_label")}>
            <Button type="button" size="sm" variant="ghost" onClick={() => setCurrentPath("")}>
              {t("agents.expert_creation_knowledge")}
            </Button>
            {breadcrumbs.map((segment, index) => {
              const path = breadcrumbs.slice(0, index + 1).join("/");
              return (
                <span key={path} className="flex min-w-0 items-center gap-1">
                  <ChevronRight className="size-3.5 shrink-0" aria-hidden />
                  <Button type="button" size="sm" variant="ghost" className="min-w-0" onClick={() => setCurrentPath(path)}>
                    <span className="truncate">{segment}</span>
                  </Button>
                </span>
              );
            })}
          </nav>
          {children.length > 0 ? children.map((node) => {
            const sourcePath = sourcePathForKnowledgeEntry(props.entries, node);
            return (
              <div key={node.relativePath} className="flex items-center gap-3 rounded-lg bg-dls-surface px-3 py-2.5">
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left"
                  onClick={() => {
                    if (node.kind === "directory") setCurrentPath(node.relativePath);
                  }}
                >
                  <IconCircle className="size-8">
                    {node.kind === "directory" ? <Folder className="size-4" /> : <FileText className="size-4" />}
                  </IconCircle>
                  <span className="min-w-0 flex-1 truncate text-sm text-dls-text">{node.name}</span>
                  {node.kind === "directory" ? <ChevronRight className="size-4 text-dls-secondary" aria-hidden /> : null}
                </button>
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger render={
                    <Button type="button" size="icon-xs" variant="ghost" aria-label={t("files.column_actions")}>
                      <MoreHorizontal className="size-4" aria-hidden />
                    </Button>
                  } />
                  <DropdownMenuContent align="end" sideOffset={6} className="min-w-40 border border-dls-border bg-dls-surface-solid p-1.5 text-dls-text">
                    <DropdownMenuItem
                      disabled={!sourcePath}
                      onClick={() => {
                        if (sourcePath) void revealDesktopItemInDir(sourcePath);
                      }}
                      className="cursor-pointer gap-2 text-dls-text focus:bg-dls-hover"
                    >
                      <Folder className="size-4 text-dls-secondary" aria-hidden />
                      {t("files.open_in_folder")}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      onClick={() => setPendingDelete(node)}
                      className="cursor-pointer gap-2 text-dls-status-danger-fg focus:bg-dls-hover"
                    >
                      <X className="size-4" aria-hidden />
                      {t("common.delete")}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            );
          }) : (
            <div className="flex min-h-48 items-center justify-center rounded-xl bg-dls-surface text-sm text-dls-secondary">
              {t("agents.expert_creation_knowledge_empty")}
            </div>
          )}
          <p className="pt-2 text-xs text-dls-secondary">
            {t("agents.expert_creation_knowledge_files", { count: props.entries.length })}
          </p>
        </div>
      ) : (
        <div className="flex min-h-[calc(100dvh-12rem)] flex-col items-center justify-center rounded-xl bg-dls-surface px-6 text-center">
          <div className="flex items-end -space-x-2">
            <IconCircle className="size-10 rotate-[-8deg] bg-dls-background text-dls-accent">
              <Upload className="size-5" aria-hidden />
            </IconCircle>
            <IconCircle className="relative z-10 size-12 bg-dls-background text-dls-accent">
              <Sparkles className="size-6" aria-hidden />
            </IconCircle>
            <IconCircle className="size-10 rotate-[8deg] bg-dls-background text-dls-accent">
              <FolderPlus className="size-5" aria-hidden />
            </IconCircle>
          </div>
          <p className="mt-6 max-w-sm text-sm leading-6 text-dls-secondary">{t("agents.expert_creation_knowledge_empty_desc")}</p>
          <div className="mt-6 flex flex-wrap justify-center gap-2">
            <Button type="button" variant="secondary" size="sm" disabled={props.staging} onClick={() => {
              setFolderDialogError(null);
              setFolderName("");
              setFolderDialogOpen(true);
            }}>
              <FolderPlus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_create_folder")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.staging} onClick={() => documentInputRef.current?.click()}>
              <Upload data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_upload_document")}
            </Button>
            <Button type="button" variant="secondary" size="sm" disabled={props.staging} onClick={openFolderUpload}>
              <FolderPlus data-icon="inline-start" className="size-3.5" />
              {t("agents.expert_creation_upload_folder")}
            </Button>
          </div>
        </div>
      )}
      <Dialog open={folderDialogOpen} onOpenChange={setFolderDialogOpen}>
        <DialogContent className="w-[min(28rem,calc(100%-2rem))] gap-4 rounded-xl bg-dls-surface p-5 text-dls-text">
          <DialogHeader>
            <DialogTitle>{t("agents.expert_creation_create_folder")}</DialogTitle>
            <DialogDescription>{t("agents.expert_creation_folder_name")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              autoFocus
              value={folderName}
              onChange={(event) => {
                setFolderName(event.currentTarget.value);
                setFolderDialogError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  createFolder();
                }
              }}
              placeholder={t("agents.expert_creation_folder_name_placeholder")}
              aria-label={t("agents.expert_creation_folder_name")}
            />
            {folderDialogError ? (
              <p className="text-sm text-dls-status-danger-fg">
                {t(folderDialogError === "duplicate"
                  ? "agents.expert_creation_folder_name_duplicate"
                  : "agents.expert_creation_folder_name_error")}
              </p>
            ) : null}
          </div>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setFolderDialogOpen(false)}>
              {t("common.cancel")}
            </Button>
            <Button type="button" onClick={createFolder}>
              {t("common.create")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmModal
        open={pendingDelete !== null}
        title={t("files.delete_confirm_title")}
        message={t("files.delete_confirm_desc", { name: pendingDelete?.name ?? "" })}
        confirmLabel={t("common.delete")}
        cancelLabel={t("common.cancel")}
        variant="danger"
        onConfirm={() => {
          if (pendingDelete) deleteNode(pendingDelete);
        }}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
