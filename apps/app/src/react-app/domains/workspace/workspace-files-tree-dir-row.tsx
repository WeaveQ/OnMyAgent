/**
 * Tasks/Experts outline directory row: folder vs session icon + open conversation.
 */
import type { ComponentType, ReactNode } from "react";
import { ChevronDown, ChevronRight, MessageSquare } from "lucide-react";
import { TableCell, TableRow } from "@/components/ui/table";
import { cn } from "@/lib/utils";
import { t } from "../../../i18n";
import {
  formatWorkspaceFileSize,
  formatWorkspaceFileTime,
  type WorkspaceFileTreeNode,
} from "../../capabilities/artifacts/workspace-file-tree";
import type { OpenSourceSessionAction } from "./workspace-files-open-session";
import { isFilesUngroupedPath } from "./workspace-files-tree-outline";

export type FilesTreeDirRowProps = {
  node: WorkspaceFileTreeNode;
  depth: number;
  expanded: boolean;
  fileCount: number;
  title: string;
  fileRoot: string;
  sessionAction: OpenSourceSessionAction;
  favorited: boolean;
  FileKindIcon: ComponentType<{
    node: WorkspaceFileTreeNode;
    fileRoot: string;
  }>;
  FileNameQuickActions: ComponentType<{
    path: string;
    favorited: boolean;
    onOpenInFolder: () => void;
    onToggleFavorite: () => void;
  }>;
  onToggleExpanded: (path: string) => void;
  onOpenSession: (path: string) => void;
  onOpenInFolder: (path: string) => void;
  onToggleFavorite: (path: string) => void;
};

export function FilesTreeDirRow(props: FilesTreeDirRowProps) {
  const { node } = props;
  const isUngrouped = isFilesUngroupedPath(node.path);
  const hasChildren = node.children.length > 0;
  const isSession = !isUngrouped && props.sessionAction.isSessionFolder;
  const canOpenSession = isSession && props.sessionAction.canOpen;
  const isOrphanSession =
    isSession && props.sessionAction.status === "missing";
  const FileKindIcon = props.FileKindIcon;
  const FileNameQuickActions = props.FileNameQuickActions;

  return (
    <TableRow
      key={`tree-dir:${node.path}`}
      data-workspace-file-row={
        isUngrouped ? "ungrouped" : isSession ? "session" : "dir"
      }
      data-files-tree-depth={String(props.depth)}
      data-files-ungrouped={isUngrouped ? "true" : undefined}
      data-files-open-source-session={canOpenSession ? "true" : undefined}
      data-files-session-orphan={isOrphanSession ? "true" : undefined}
      className="group h-11 hover:bg-dls-hover/50"
    >
      <TableCell className="py-2">
        <span
          className="flex min-w-0 items-center gap-2"
          style={{ paddingLeft: `${props.depth * 1.25}rem` }}
        >
          {hasChildren ? (
            <button
              type="button"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
              aria-expanded={props.expanded}
              aria-label={
                props.expanded
                  ? t("files.collapse_all_folders")
                  : t("files.expand_all_folders")
              }
              onClick={(event) => {
                event.stopPropagation();
                props.onToggleExpanded(node.path);
              }}
            >
              {props.expanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
            </button>
          ) : (
            <span className="size-6 shrink-0" />
          )}
          {isSession ? (
            <button
              type="button"
              className={cn(
                "inline-flex size-4 shrink-0 items-center justify-center rounded-sm",
                canOpenSession
                  ? "text-dls-accent hover:opacity-80"
                  : "text-dls-secondary opacity-70",
              )}
              title={
                canOpenSession
                  ? t("files.open_source_session")
                  : isOrphanSession
                    ? t("files.open_source_session_missing")
                    : undefined
              }
              disabled={!canOpenSession}
              onClick={(event) => {
                event.stopPropagation();
                if (canOpenSession) props.onOpenSession(node.path);
              }}
            >
              <MessageSquare
                className="size-4"
                strokeWidth={1.75}
                aria-hidden
              />
            </button>
          ) : (
            <FileKindIcon node={node} fileRoot={props.fileRoot} />
          )}
          {canOpenSession ? (
            <button
              type="button"
              className="min-w-0 truncate text-left text-sm font-medium text-dls-text underline decoration-dls-border underline-offset-4 transition-colors hover:text-dls-accent hover:decoration-dls-accent"
              title={props.title}
              data-files-session-title="true"
              onClick={(event) => {
                event.stopPropagation();
                props.onOpenSession(node.path);
              }}
            >
              {props.title}
            </button>
          ) : (
            <button
              type="button"
              className={cn(
                "min-w-0 truncate text-left text-sm font-medium text-dls-text",
                hasChildren && "cursor-pointer hover:text-dls-accent",
                isOrphanSession && "opacity-80",
              )}
              title={
                isUngrouped
                  ? t("files.ungrouped")
                  : isOrphanSession
                    ? t("files.open_source_session_missing")
                    : props.title
              }
              onClick={(event) => {
                event.stopPropagation();
                if (hasChildren) props.onToggleExpanded(node.path);
              }}
            >
              {props.title}
            </button>
          )}
          {props.fileCount > 0 ? (
            <span className="inline-flex shrink-0 items-center rounded-full bg-dls-surface-muted px-2 py-0.5 text-[11px] font-medium text-dls-secondary ring-1 ring-dls-border/60">
              {t("files.file_count", { count: props.fileCount })}
            </span>
          ) : null}
          {!isUngrouped ? (
            <FileNameQuickActions
              path={node.path}
              favorited={props.favorited}
              onOpenInFolder={() => props.onOpenInFolder(node.path)}
              onToggleFavorite={() => props.onToggleFavorite(node.path)}
            />
          ) : null}
        </span>
      </TableCell>
      <TableCell className="py-2 text-left text-xs text-dls-secondary">
        {t("files.type_folder")}
      </TableCell>
      <TableCell className="py-2 text-left text-xs text-dls-secondary tabular-nums">
        {node.mtimeMs > 0 ? formatWorkspaceFileTime(node.mtimeMs) : "-"}
      </TableCell>
      <TableCell className="py-2 text-left text-xs text-dls-secondary tabular-nums">
        {formatWorkspaceFileSize(node.size)}
      </TableCell>
      <TableCell className="py-2" />
    </TableRow>
  );
}
