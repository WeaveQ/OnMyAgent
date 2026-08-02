/** @jsxImportSource react */
/**
 * Shared L1 action bar for file preview surfaces (drawer, artifact panel, side panel).
 * All file types: open externally, reveal, copy path, optional edit / ask agent.
 */
import {
  Copy,
  ExternalLink,
  Folder,
  MessageSquarePlus,
  Pencil,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export type FilePreviewActionBarProps = {
  className?: string;
  /** Dense bar for narrow side panels. */
  compact?: boolean;
  copied?: boolean;
  onEdit?: () => void;
  onOpenExternally?: () => void;
  onOpenInFolder?: () => void;
  onCopyPath?: () => void;
  /** Seed composer with @file + instruction (WP3). */
  onAskAgent?: () => void;
};

export function FilePreviewActionBar(props: FilePreviewActionBarProps) {
  const size = props.compact ? "xs" : "sm";
  const icon = props.compact ? "size-3" : "size-3.5";
  const labelClass = props.compact
    ? "text-dls-secondary hover:text-dls-text"
    : "text-dls-secondary hover:text-dls-text";

  const hasAny =
    props.onEdit ||
    props.onOpenExternally ||
    props.onOpenInFolder ||
    props.onCopyPath ||
    props.onAskAgent;
  if (!hasAny) return null;

  return (
    <div
      data-file-preview-action-bar="true"
      className={cn(
        "flex shrink-0 flex-wrap items-center gap-1 border-b border-dls-border bg-dls-surface-muted/60",
        props.compact ? "gap-1 px-2 py-1.5" : "gap-1.5 px-3 py-2",
        props.className,
      )}
    >
      {props.onEdit ? (
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={props.onEdit}
          className={labelClass}
        >
          <Pencil data-icon="inline-start" className={icon} aria-hidden />
          {t("files.edit_file")}
        </Button>
      ) : null}
      {props.onOpenExternally ? (
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={props.onOpenExternally}
          className={labelClass}
        >
          <ExternalLink data-icon="inline-start" className={icon} aria-hidden />
          {t("files.open_file")}
        </Button>
      ) : null}
      {props.onOpenInFolder ? (
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={props.onOpenInFolder}
          className={labelClass}
        >
          <Folder data-icon="inline-start" className={icon} aria-hidden />
          {t("files.open_in_folder")}
        </Button>
      ) : null}
      {props.onCopyPath ? (
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={props.onCopyPath}
          className={labelClass}
        >
          <Copy data-icon="inline-start" className={icon} aria-hidden />
          {props.copied ? t("files.copied") : t("files.copy_path")}
        </Button>
      ) : null}
      {props.onAskAgent ? (
        <Button
          type="button"
          variant="ghost"
          size={size}
          onClick={props.onAskAgent}
          className={cn(labelClass, "ms-auto")}
        >
          <MessageSquarePlus data-icon="inline-start" className={icon} aria-hidden />
          {t("files.ask_agent")}
        </Button>
      ) : null}
    </div>
  );
}
