/** @jsxImportSource react */
import { useState } from "react";
import { File as FileIcon } from "lucide-react";

import { openDesktopPath } from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { usePlatform } from "../../../kernel/platform";
import { ImageAttachmentLightbox } from "./image-attachment-lightbox";

export function TranscriptResourceChip(props: {
  filename?: string;
  url: string;
  mediaType: string;
}) {
  const platform = usePlatform();
  const label = props.filename || props.url || t("session.attached_file");
  const isImage = props.mediaType.startsWith("image/");
  const isRemote = /^(?:https?|data):/i.test(props.url);
  const [imagePreviewOpen, setImagePreviewOpen] = useState(false);

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

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="h-auto max-w-[200px] justify-start gap-1.5 rounded-sm border border-dls-border bg-dls-surface-muted px-2 py-1 text-xs font-normal text-dls-text hover:bg-dls-hover"
      title={label}
      disabled={!props.url}
      onClick={() => {
        if (!props.url) return;
        if (isRemote) {
          platform.openLink(props.url);
          return;
        }
        void openDesktopPath(props.url);
      }}
    >
      <FileIcon className="size-4 shrink-0" aria-hidden="true" />
      <span className="min-w-0 truncate leading-4">{label}</span>
    </Button>
  );
}
