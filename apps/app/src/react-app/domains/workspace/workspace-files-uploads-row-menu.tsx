/** @jsxImportSource react */
/**
 * Mine uploads row ⋯ menu + upload error formatting helpers.
 */
import {
  Copy,
  ExternalLink,
  FileUp,
  FolderInput,
  FolderOpen,
  MoreHorizontal,
  Trash2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  OnMyAgentServerError,
} from "../../../app/lib/onmyagent-server";
import { t } from "../../../i18n";
import { formatWorkspaceFileSize } from "../../capabilities/artifacts/workspace-file-tree";

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

export function formatUploadError(error: unknown, file?: File): string {
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

export function UploadRowActionsMenu(props: {
  name: string;
  pathCopied: boolean;
  showMoveTo?: boolean;
  onPreview: () => void;
  onOpenExternally: () => void;
  onOpenInFolder: () => void;
  onMoveTo?: () => void;
  onCopyPath: () => void;
  onDelete: () => void;
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
        {props.showMoveTo && props.onMoveTo ? (
          <DropdownMenuItem
            data-files-move-to="true"
            onClick={(event) => {
              event.stopPropagation();
              props.onMoveTo?.();
            }}
          >
            <FolderInput />
            {t("files.move_to")}
          </DropdownMenuItem>
        ) : null}
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

export { CLIENT_INBOX_MAX_BYTES_DEFAULT };
