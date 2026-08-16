/** @jsxImportSource react */
/** Attachment chip rail + image lightbox for the session composer. */
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ArtifactIcon } from "../../artifacts/artifact-icon";
import type { ComposerAttachment } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { ImageAttachmentLightbox } from "../image-attachment-lightbox";
import { formatBytes, isImageAttachment } from "./composer-helpers";

export type ComposerAttachmentChipsProps = {
  attachments: ComposerAttachment[];
  onRemoveAttachment: (id: string) => void;
};

export function ComposerAttachmentChips(props: ComposerAttachmentChipsProps) {
  const [imagePreview, setImagePreview] = useState<{ src: string; alt: string } | null>(null);

  return (
    <>
      {props.attachments.length > 0 ? (
        // Align with editor padding (px-4); keep chips compact so they don't fight the shell.
        <div className="flex flex-wrap gap-2 px-4 pt-3">
          {props.attachments.map((attachment) => {
            const canPreviewImage =
              isImageAttachment(attachment) && Boolean(attachment.previewUrl);
            return (
              <div
                key={attachment.id}
                className="group/att flex max-w-full items-center gap-2 rounded-lg bg-dls-surface-muted px-2 py-1.5 text-xs"
              >
                {canPreviewImage && attachment.previewUrl ? (
                  <button
                    type="button"
                    className="size-8 shrink-0 cursor-zoom-in overflow-hidden rounded-md bg-dls-surface ring-offset-2 ring-offset-dls-surface-muted transition hover:ring-2 hover:ring-dls-border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent"
                    onClick={() =>
                      setImagePreview({
                        src: attachment.previewUrl ?? "",
                        alt: attachment.name,
                      })
                    }
                    title={t("session.image_attachment_open", { name: attachment.name })}
                    aria-label={t("session.image_attachment_open", { name: attachment.name })}
                  >
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.name}
                      decoding="async"
                      className="size-full object-cover"
                    />
                  </button>
                ) : (
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-dls-surface text-dls-secondary">
                    <ArtifactIcon name={attachment.name} className="size-3.5" />
                  </div>
                )}
                {canPreviewImage && attachment.previewUrl ? (
                  <button
                    type="button"
                    className="min-w-0 max-w-[14rem] cursor-zoom-in rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent"
                    onClick={() =>
                      setImagePreview({
                        src: attachment.previewUrl ?? "",
                        alt: attachment.name,
                      })
                    }
                    title={t("session.image_attachment_open", { name: attachment.name })}
                  >
                    <div className="truncate text-xs font-medium text-dls-text" title={attachment.name}>
                      {attachment.name}
                    </div>
                    <div className="truncate text-2xs text-dls-secondary">
                      {t("composer.image_kind")}
                      {" · "}
                      {formatBytes(attachment.size)}
                    </div>
                  </button>
                ) : (
                  <div className="min-w-0 max-w-[14rem]">
                    <div className="truncate text-xs font-medium text-dls-text" title={attachment.name}>
                      {attachment.name}
                    </div>
                    <div className="truncate text-2xs text-dls-secondary">
                      {t("composer.file_kind")}
                      {" · "}
                      {formatBytes(attachment.size)}
                    </div>
                  </div>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="ml-0.5 size-5 shrink-0 rounded-md text-dls-secondary opacity-70 hover:bg-dls-hover hover:text-dls-text hover:opacity-100 group-hover/att:opacity-100"
                  onClick={() => props.onRemoveAttachment(attachment.id)}
                  title={t("action.remove")}
                  aria-label={t("action.remove")}
                >
                  <X className="size-3" />
                </Button>
              </div>
            );
          })}
        </div>
      ) : null}
      <ImageAttachmentLightbox
        open={imagePreview !== null}
        src={imagePreview?.src ?? null}
        alt={imagePreview?.alt}
        onOpenChange={(open) => {
          if (!open) setImagePreview(null);
        }}
      />
    </>
  );
}
