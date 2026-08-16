/** @jsxImportSource react */
/**
 * Named extracts from WorkspaceFilesBrowserPanel: row chrome, empty state,
 * and local favorites helpers.
 */
import {
  CirclePlus,
  Cloud,
  Copy,
  FileStack,
  Folder,
  FolderOpen,
  MessageSquare,
  MoreHorizontal,
  Star,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "@/components/ui/empty";
import { cn } from "@/lib/utils";
import { FILES_EMPTY_STATE_ASSET } from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import { t } from "../../../i18n";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import { workspaceFileOpenTarget } from "../../capabilities/artifacts/workspace-file-open-target";
import { type WorkspaceFileTreeNode } from "../../capabilities/artifacts/workspace-file-tree";
import { type SourceSessionStatus } from "./workspace-files-open-session";
import { formatWorkspaceFolderDisplayName, isFilesUngroupedPath } from "./workspace-files-model";

export function folderDisplayName(node: WorkspaceFileTreeNode): string {
  if (isFilesUngroupedPath(node.path)) return t("files.ungrouped");
  return formatWorkspaceFolderDisplayName(node.name, node.mtimeMs);
}

export function FileKindIcon(props: { node: WorkspaceFileTreeNode; fileRoot: string }) {
  if (props.node.kind === "dir") {
    if (isFilesUngroupedPath(props.node.path)) {
      return (
        <FileStack
          className="size-4 shrink-0 text-dls-secondary"
          strokeWidth={1.75}
          aria-hidden="true"
        />
      );
    }
    return (
      <Folder
        className="size-4 shrink-0 text-dls-text opacity-100"
        strokeWidth={1.75}
        aria-hidden="true"
      />
    );
  }
  const target = workspaceFileOpenTarget({
    fileRoot: props.fileRoot || "/",
    path: props.node.path,
    name: props.node.name,
    size: props.node.size,
    mtimeMs: props.node.mtimeMs,
  });
  return <ArtifactIcon type={target.preview} name={props.node.name} className="size-4 shrink-0" />;
}

export function FilesListEmptyState(props: { filtered: boolean; sessionScoped: boolean }) {
  const title = props.filtered
    ? t("files.no_matching_files")
    : props.sessionScoped
      ? t("files.no_session_files")
      : t("files.no_files");
  const description = props.filtered
    ? t("files.no_matching_files_hint")
    : props.sessionScoped
      ? t("files.no_session_files_hint")
      : t("files.no_files_hint");

  return (
    <div className="flex min-h-56 flex-1 items-center justify-center px-6 py-12">
      <Empty className="max-w-sm flex-none border-0 bg-transparent p-0" variant="ghost">
        <EmptyHeader>
          <EmptyStateIllustration src={FILES_EMPTY_STATE_ASSET} size="compact" className="mb-3" />
          <EmptyTitle className="text-sm font-medium text-dls-text">{title}</EmptyTitle>
          <EmptyDescription className="mt-1 text-xs leading-5 text-dls-secondary">
            {description}
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    </div>
  );
}

const FILE_FAVORITES_STORAGE_KEY = "onmyagent.files.favorites.v1";

export function readFavoritePaths(workspaceId: string): Set<string> {
  if (typeof window === "undefined" || !workspaceId.trim()) return new Set();
  try {
    const raw = window.localStorage.getItem(FILE_FAVORITES_STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw) as Record<string, string[]>;
    const list = parsed[workspaceId.trim()];
    return new Set(Array.isArray(list) ? list.filter((p) => typeof p === "string") : []);
  } catch {
    return new Set();
  }
}

export function writeFavoritePaths(workspaceId: string, paths: Set<string>) {
  if (typeof window === "undefined" || !workspaceId.trim()) return;
  try {
    const raw = window.localStorage.getItem(FILE_FAVORITES_STORAGE_KEY);
    const parsed = raw && raw.trim() ? (JSON.parse(raw) as Record<string, string[]>) : {};
    parsed[workspaceId.trim()] = Array.from(paths);
    window.localStorage.setItem(FILE_FAVORITES_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    // ignore storage failures
  }
}

/** Inline quick actions after the file/folder name (hover row → show; hover icon → tooltip).
 * Add-to-conversation is only for concrete files, not folders.
 */
export function FileNameQuickActions(props: {
  path: string;
  favorited: boolean;
  /** Files only — folders omit the add-to-conversation control. */
  showAddToTask?: boolean;
  onAddToTask?: () => void;
  onOpenInFolder: () => void;
  onToggleFavorite: () => void;
}) {
  const quickBtnClass =
    "inline-flex size-7 shrink-0 items-center justify-center rounded-md text-dls-secondary opacity-0 transition-[opacity,color,background-color,transform] duration-150 hover:bg-dls-hover hover:text-dls-text hover:scale-105 group-hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30";
  const iconClass = "size-4";
  const favoriteLabel = props.favorited ? t("files.unfavorite") : t("files.favorite");
  const showAdd = Boolean(props.showAddToTask && props.onAddToTask);

  return (
    <span className="ms-1 inline-flex shrink-0 items-center gap-1.5">
      {showAdd ? (
        <Tooltip>
          <TooltipTrigger
            render={
              <button
                type="button"
                className={quickBtnClass}
                aria-label={t("files.add_to_task")}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onAddToTask?.();
                }}
              />
            }
          >
            <CirclePlus className={iconClass} strokeWidth={1.75} aria-hidden />
          </TooltipTrigger>
          <TooltipContent side="top" sideOffset={6}>
            {t("files.add_to_task")}
          </TooltipContent>
        </Tooltip>
      ) : null}
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={quickBtnClass}
              aria-label={t("files.open_folder")}
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenInFolder();
              }}
            />
          }
        >
          <FolderOpen className={iconClass} strokeWidth={1.75} aria-hidden />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {t("files.open_folder")}
        </TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger
          render={
            <button
              type="button"
              className={cn(quickBtnClass, props.favorited && "text-dls-accent opacity-100")}
              aria-label={favoriteLabel}
              aria-pressed={props.favorited}
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleFavorite();
              }}
            />
          }
        >
          <Star
            className={iconClass}
            strokeWidth={1.75}
            aria-hidden
            fill={props.favorited ? "currentColor" : "none"}
          />
        </TooltipTrigger>
        <TooltipContent side="top" sideOffset={6}>
          {favoriteLabel}
        </TooltipContent>
      </Tooltip>
    </span>
  );
}

export function openSourceSessionLabel(status: SourceSessionStatus): string {
  if (status === "archived") return t("files.open_source_session_archived");
  if (status === "missing") return t("files.open_source_session_missing");
  return t("files.open_source_session");
}

export function FileRowActionsMenu(props: {
  name: string;
  pathCopied: boolean;
  favorited: boolean;
  openSourceSession?: {
    status: SourceSessionStatus;
    canOpen: boolean;
  } | null;
  onOpenSourceSession?: () => void;
  onOpenInFolder: () => void;
  onAddToTask: () => void;
  onToggleFavorite: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
}) {
  const openSession = props.openSourceSession;
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
        {/* Hope-style order: cloud first, then add-to-task / open folder / favorite */}
        <DropdownMenuItem disabled className="opacity-60">
          <Cloud />
          {t("files.upload_to_cloud_soon")}
        </DropdownMenuItem>
        {openSession && openSession.status !== "none" ? (
          <DropdownMenuItem
            disabled={!openSession.canOpen || !props.onOpenSourceSession}
            title={
              openSession.status === "missing" ? t("files.open_source_session_missing") : undefined
            }
            data-files-open-source-session="true"
            onClick={(event) => {
              event.stopPropagation();
              if (!openSession.canOpen) return;
              props.onOpenSourceSession?.();
            }}
          >
            <MessageSquare />
            {openSourceSessionLabel(openSession.status)}
          </DropdownMenuItem>
        ) : null}
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onAddToTask();
          }}
        >
          <CirclePlus />
          {t("files.add_to_task")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onOpenInFolder();
          }}
        >
          <FolderOpen />
          {t("files.open_folder")}
        </DropdownMenuItem>
        <DropdownMenuItem
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleFavorite();
          }}
        >
          <Star fill={props.favorited ? "currentColor" : "none"} />
          {props.favorited ? t("files.unfavorite") : t("files.favorite")}
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
