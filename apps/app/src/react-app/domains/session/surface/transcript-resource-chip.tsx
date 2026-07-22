/** @jsxImportSource react */
import { useState } from "react";
import {
  openDesktopPath,
  revealDesktopItemCandidates,
} from "../../../../app/lib/desktop";
import { t } from "@/i18n";
import { usePlatform } from "../../../kernel/platform";
import { resolveArtifactRevealCandidates } from "../artifacts/open-target";
import { ArtifactIcon } from "../artifacts/artifact-icon";
import { formatBytes } from "./composer/composer-helpers";
import { ImageAttachmentLightbox } from "./image-attachment-lightbox";
import { absolutePathFromFileUrl } from "./user-upload-display";

export function TranscriptResourceChip(props: {
  filename?: string;
  url: string;
  mediaType: string;
  /** Optional byte size when known (composer chips show this). */
  size?: number;
  /** Workspace-relative path from the upload instruction dump. */
  relativePath?: string;
  workspaceRoot?: string;
}) {
  const platform = usePlatform();
  const label = props.filename || props.url || t("session.attached_file");
  const isImage = props.mediaType.startsWith("image/");
  const isRemote = /^(?:https?|data):/i.test(props.url);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  if (isImage && props.url) {
    return (
      <>
        <button
          type="button"
          className="group/att flex max-w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-2 py-1.5 text-left text-xs transition hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent"
          title={t("session.image_attachment_open", { name: label })}
          aria-label={t("session.image_attachment_open", { name: label })}
          onClick={() => setImagePreviewOpen(true)}
        >
          <span className="size-8 shrink-0 cursor-zoom-in overflow-hidden rounded-md bg-dls-surface ring-offset-2 ring-offset-dls-surface-muted transition group-hover/att:ring-2 group-hover/att:ring-dls-border">
            <img
              src={props.url}
              alt={label}
              loading="lazy"
              decoding="async"
              className="size-full object-cover"
            />
          </span>
          <span className="min-w-0 max-w-[14rem]">
            <span className="block truncate text-xs font-medium text-dls-text">
              {label}
            </span>
            <span className="block truncate text-2xs text-dls-secondary">
              {t("composer.image_kind")}
              {typeof props.size === "number" && props.size > 0
                ? ` · ${formatBytes(props.size)}`
                : ""}
            </span>
          </span>
        </button>
        <ImageAttachmentLightbox
          open={imagePreviewOpen}
          src={props.url}
          alt={label}
          onOpenChange={setImagePreviewOpen}
        />
      </>
    );
  }

  const handleOpen = () => {
    if (!props.url && !props.relativePath) return;
    if (isRemote) {
      platform.openLink(props.url);
      return;
    }
    if (busy) return;
    setBusy(true);

    const absolute = absolutePathFromFileUrl(props.url);
    const relative = props.relativePath?.trim() ?? "";
    const candidates = [
      ...resolveArtifactRevealCandidates(absolute || relative, {
        workspaceRoot: props.workspaceRoot,
        verifiedValue: absolute || null,
      }),
      ...resolveArtifactRevealCandidates(relative, {
        workspaceRoot: props.workspaceRoot,
      }),
      absolute,
      relative,
    ].filter((item, index, all) => {
      const next = item.trim();
      return next.length > 0 && all.findIndex((v) => v.trim() === next) === index;
    });

    void (async () => {
      try {
        if (candidates.length > 0) {
          await revealDesktopItemCandidates(candidates);
          return;
        }
        if (absolute) {
          await openDesktopPath(absolute);
        }
      } catch (error) {
        console.error(
          "[transcript] failed to reveal attachment in folder",
          { label, absolute, relative, candidates, workspaceRoot: props.workspaceRoot },
          error,
        );
        if (absolute) {
          try {
            await openDesktopPath(absolute);
          } catch (openError) {
            console.error("[transcript] failed to open attachment path", openError);
          }
        }
      } finally {
        setBusy(false);
      }
    })();
  };

  return (
    <button
      type="button"
      className="group/att flex max-w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-2 py-1.5 text-left text-xs transition hover:bg-dls-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent disabled:opacity-50"
      title={t("files.open_in_folder")}
      aria-label={`${label} · ${t("files.open_in_folder")}`}
      disabled={(!props.url && !props.relativePath) || busy}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        handleOpen();
      }}
    >
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
        <ArtifactIcon name={label} className="size-3.5" />
      </span>
      <span className="min-w-0 max-w-[14rem]">
        <span className="block truncate text-xs font-medium text-dls-text">
          {label}
        </span>
        <span className="block truncate text-2xs text-dls-secondary">
          {t("composer.file_kind")}
          {typeof props.size === "number" && props.size > 0
            ? ` · ${formatBytes(props.size)}`
            : ""}
        </span>
      </span>
    </button>
  );
}
