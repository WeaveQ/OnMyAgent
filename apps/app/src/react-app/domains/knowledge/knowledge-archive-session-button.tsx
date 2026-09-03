/** @jsxImportSource react */
import { useMemo, useState } from "react";
import { Inbox } from "lucide-react";

import { Button } from "@/components/ui/button";
import { isElectronRuntime } from "../../../app/utils";
import { t } from "../../../i18n";
import {
  KnowledgeArchiveSessionDialog,
  type ArchiveScopeOption,
} from "./knowledge-archive-session";
import { openKnowledgeNoteInRail } from "./knowledge-vault-navigation";

export type KnowledgeArchiveSessionButtonProps = {
  sessionId: string;
  defaultTitle: string;
  markdown: string;
  workspaceId?: string;
  expertId?: string;
};

export function useKnowledgeArchiveSession(props: KnowledgeArchiveSessionButtonProps) {
  const [open, setOpen] = useState(false);
  const scopes = useMemo(() => {
    const items: ArchiveScopeOption[] = [
      { scope: "user", label: t("knowledge.scope_user") },
    ];
    if (props.workspaceId) {
      items.push({
        scope: "project",
        label: t("knowledge.scope_project"),
        workspaceId: props.workspaceId,
      });
    }
    if (props.expertId) {
      items.push({
        scope: "expert",
        label: t("knowledge.scope_expert"),
        expertId: props.expertId,
      });
    }
    return items;
  }, [props.expertId, props.workspaceId]);

  const available = isElectronRuntime() && Boolean(props.sessionId.trim());
  const dialog = available ? (
    <KnowledgeArchiveSessionDialog
      open={open}
      onOpenChange={setOpen}
      sessionId={props.sessionId}
      defaultTitle={props.defaultTitle}
      markdown={props.markdown}
      scopes={scopes}
      onSaved={(result) => {
        openKnowledgeNoteInRail({ scope: result.scope, relPath: result.relPath });
      }}
    />
  ) : null;

  return {
    available,
    openDialog: () => setOpen(true),
    dialog,
  };
}

export function KnowledgeArchiveSessionIconButton(props: { onClick: () => void }) {
  return (
    <Button
      variant="ghost"
      size="icon-xs"
      type="button"
      className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
      title={t("knowledge.save_to_knowledge")}
      aria-label={t("knowledge.save_to_knowledge")}
      onClick={props.onClick}
    >
      <Inbox className="size-3.5" />
    </Button>
  );
}

export function KnowledgeArchiveSessionButton(props: KnowledgeArchiveSessionButtonProps) {
  const archive = useKnowledgeArchiveSession(props);
  if (!archive.available) return null;
  return (
    <>
      <KnowledgeArchiveSessionIconButton onClick={archive.openDialog} />
      {archive.dialog}
    </>
  );
}

