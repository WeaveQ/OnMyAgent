/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldLabel } from "@/components/ui/field";
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
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [fileName, setFileName] = useState("");
  const [scopeIndex, setScopeIndex] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (props.open) {
      setFileName(safeArchiveFileName(props.defaultTitle).replace(/\.md$/i, ""));
      setScopeIndex(0);
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
    const relPath = joinKnowledgeRelPath("", previewName);
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

  const handleSave = async () => {
    if (saving || !selected) return;
    setSaving(true);
    setError(null);
    const result = await save();
    setSaving(false);
    if (!result.ok) {
      setError(t("knowledge.archive_failed"));
      return;
    }
    props.onSaved?.({ ...result, scope: selected.scope });
    props.onOpenChange(false);
  };

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="sm:max-w-md" initialFocus={inputRef}>
        <DialogHeader>
          <DialogTitle>{t("knowledge.archive_dialog_title")}</DialogTitle>
        </DialogHeader>
        <Field>
          <FieldLabel htmlFor="archive-session-file-name">
            {t("knowledge.archive_file_name")}
          </FieldLabel>
          <Input
            ref={inputRef}
            id="archive-session-file-name"
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            onKeyDown={(event) => {
              if (event.nativeEvent.isComposing || event.key === "Process") return;
              if (event.key !== "Enter") return;
              event.preventDefault();
              void handleSave();
            }}
          />
        </Field>
        {props.scopes.length > 1 ? (
          <Field>
            <FieldLabel>{t("knowledge.archive_scope")}</FieldLabel>
            <div className="flex flex-wrap gap-2">
              {props.scopes.map((option, index) => (
                <Button
                  key={option.scope}
                  type="button"
                  size="sm"
                  variant={index === scopeIndex ? "default" : "outline"}
                  onClick={() => setScopeIndex(index)}
                >
                  {option.label}
                </Button>
              ))}
            </div>
          </Field>
        ) : null}
        {error ? <NoticeBox tone="error">{error}</NoticeBox> : null}
        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            size="lg"
            disabled={saving}
            onClick={() => props.onOpenChange(false)}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            size="lg"
            disabled={saving || !selected}
            onClick={() => void handleSave()}
          >
            {t("knowledge.save_to_knowledge")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
