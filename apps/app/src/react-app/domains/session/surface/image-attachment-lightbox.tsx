/** @jsxImportSource react */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { t } from "@/i18n";

export function ImageAttachmentLightbox(props: {
  open: boolean;
  src: string | null;
  alt?: string;
  onOpenChange: (open: boolean) => void;
}) {
  const alt = props.alt?.trim() || t("session.image_attachment_preview");
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="bg-dls-surface p-3 sm:max-w-4xl" showCloseButton>
        <DialogTitle className="sr-only">
          {t("session.image_attachment_preview")}
        </DialogTitle>
        <DialogDescription className="sr-only">
          {t("session.image_attachment_preview_description")}
        </DialogDescription>
        {props.src ? (
          <img
            src={props.src}
            alt={alt}
            className="max-h-[82vh] w-full object-contain"
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
