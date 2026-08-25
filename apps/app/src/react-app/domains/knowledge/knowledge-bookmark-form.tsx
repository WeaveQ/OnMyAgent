/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Link as LinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t } from "../../../i18n";
import { isHttpUrl } from "./knowledge-bookmark";

export type BookmarkDraft = { title: string; url: string };

type KnowledgeBookmarkFormProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (draft: BookmarkDraft) => void | Promise<void>;
};

export function KnowledgeBookmarkForm(props: KnowledgeBookmarkFormProps) {
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");

  useEffect(() => {
    if (props.open) {
      setTitle("");
      setUrl("");
    }
  }, [props.open]);

  const trimmedUrl = url.trim();
  const valid = isHttpUrl(trimmedUrl);
  const canSubmit = valid && title.trim().length > 0;

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <LinkIcon className="size-4 text-dls-secondary" />
            {t("knowledge.add_link")}
          </DialogTitle>
          <DialogDescription>{t("knowledge.bookmark_url_invalid")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm font-medium text-dls-text">
            {t("knowledge.bookmark_title_label")}
            <Input
              autoFocus
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1"
              placeholder={t("knowledge.bookmark_title_label")}
            />
          </label>
          <label className="block text-sm font-medium text-dls-text">
            {t("knowledge.bookmark_url_label")}
            <Input
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              className="mt-1"
              placeholder="https://"
              inputMode="url"
            />
          </label>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={!canSubmit}
            onClick={() => {
              if (!canSubmit) return;
              void props.onCreate({ title: title.trim(), url: trimmedUrl });
              props.onOpenChange(false);
            }}
          >
            {t("common.create")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
