/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react";
import { Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { NoticeBox } from "@/components/ui/notice-box";
import { writeKnowledgeVaultFile } from "../../../app/lib/desktop";
import { t } from "../../../i18n";
import {
  buildSessionArchiveMarkdown,
  safeArchiveFileName,
} from "./knowledge-bookmark";
import { joinKnowledgeRelPath } from "./knowledge-vault-model";
import type { KnowledgeVaultScope } from "./knowledge-vault-model";

export type ArchiveScopeOption = {
  scope: KnowledgeVaultScope;
  label: string;
  workspaceId?: string;
  expertId?: string;
};

type KnowledgeArchiveSessionResult =
  | { ok: true; relPath: string }
  | { ok: false; reason: string };

type KnowledgeArchiveSessionDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  defaultTitle: string;
  markdown: string;
  scopes: readonly ArchiveScopeOption[];
  onSaved?: (result: { ok: true; relPath: string; scope: KnowledgeVaultScope }) => void;
};

export function KnowledgeArchiveSessionDialog(props: KnowledgeArchiveSessionDialogProps) {
  const [fileName, setFileName] = useState("");
  const [scopeIndex, setScopeIndex] = useState(0);
  const [folder, setFolder] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.open) {
      setFileName(safeArchiveFileName(props.defaultTitle).replace(/\.md$/i, ""));
      setScopeIndex(0);
      setFolder("");
      setError(null);
    }
  }, [props.open, props.defaultTitle]);

  const selected = props.scopes[scopeIndex];
  const previewName = useMemo(
    () => safeArchiveFileName(fileName || props.defaultTitle),
    [fileName, props.defaultTitle],
  );

  const save = async (): Promise<KnowledgeArchiveSessionResult> => {
    if (!selected) return { ok: false, reason: "no_scope" };
    const relPath = joinKnowledgeRelPath(folder, previewName);
    const content = buildSessionArchiveMarkdown({
      sessionId: props.sessionId,
      title: previewName.replace(/\.md$/i, ""),
      body: props.markdown,
    });
    const result = await writeKnowledgeVaultFile({
      scope: selected.scope,
      relPath,
      content,
      workspaceId: selected.workspaceId,
      expertId: selected.expertId,
    });
    if (!result?.ok) return { ok: false, reason: result?.reason ?? "write_failed" };
    return { ok: true, relPath };
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Inbox className="size-4 text-dls-secondary" />
            {t("knowledge.archive_dialog_title")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3 py-2">
          <label className="block text-sm font-medium text-dls-text">
            {t("knowledge.archive_file_name")}
            <Input
              value={fileName}
              onChange={(event) => setFileName(event.target.value)}
              className="mt-1"
              autoFocus
            />
            <span className="mt-1 block text-xs text-dls-secondary">{previewName}</span>
          </label>
          {props.scopes.length > 1 ? (
            <div className="flex flex-wrap gap-2">
              {props.scopes.map((option, index) => (
                <Button
                  key={option.scope}
                  size="sm"
                  variant={index === scopeIndex ? "default" : "outline"}
                  onClick={() => setScopeIndex(index)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          ) : null}
          {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => props.onOpenChange(false)}>
            {t("common.cancel")}
          </Button>
          <Button
            disabled={saving || !selected}
            onClick={async () => {
              setSaving(true);
              setError(null);
              const result = await save();
              setSaving(false);
              if (!result.ok) {
                setError(t("knowledge.archive_failed"));
                return;
              }
              if (selected) props.onSaved?.({ ...result, scope: selected.scope });
              props.onOpenChange(false);
            }}
          >
            {t("knowledge.save_to_knowledge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
