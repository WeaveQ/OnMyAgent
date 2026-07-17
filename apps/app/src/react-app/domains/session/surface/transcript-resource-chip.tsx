/** @jsxImportSource react */
import { File as FileIcon, Image as ImageIcon } from "lucide-react";

import { openDesktopPath } from "../../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { usePlatform } from "../../../kernel/platform";

export function TranscriptResourceChip(props: {
  filename?: string;
  url: string;
  mediaType: string;
}) {
  const platform = usePlatform();
  const label = props.filename || props.url || t("session.attached_file");
  const isImage = props.mediaType.startsWith("image/");
  const isRemote = /^(?:https?|data):/i.test(props.url);

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
      {isImage ? (
        <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
      ) : (
        <FileIcon className="size-4 shrink-0" aria-hidden="true" />
      )}
      <span className="min-w-0 truncate leading-4">{label}</span>
    </Button>
  );
}
