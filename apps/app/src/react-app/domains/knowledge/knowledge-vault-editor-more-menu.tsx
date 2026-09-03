/** @jsxImportSource react */
import { MoreHorizontal } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "../../../i18n";
import type { KnowledgeContextTarget } from "./knowledge-vault-context-menu";
import { GETTING_STARTED_REL_PATH } from "./knowledge-vault-model";
import type { KnowledgeNoteRef } from "./knowledge-vault-model";
import type { KnowledgeTreeActions } from "./knowledge-vault-tree";

type KnowledgeVaultEditorMoreMenuProps = {
  note: KnowledgeNoteRef | null;
  treeActions: KnowledgeTreeActions;
  onShowInTree: () => void;
};

export function KnowledgeVaultEditorMoreMenu(props: KnowledgeVaultEditorMoreMenuProps) {
  const target: KnowledgeContextTarget | null = props.note
    ? { kind: "file", relPath: props.note.relPath }
    : null;
  const disabled = !target;
  const canMutate = Boolean(target) && props.note?.relPath !== GETTING_STARTED_REL_PATH;
  const favoriteKey = props.note ? `${props.note.scope}:${props.note.relPath}` : "";
  const favorited = Boolean(favoriteKey) && props.treeActions.favorites.has(favoriteKey);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        disabled={disabled}
        render={
          <Button
            variant="ghost"
            size="icon-xs"
            className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            aria-label={t("knowledge.more")}
            title={t("knowledge.more")}
            disabled={disabled}
          >
            <MoreHorizontal className="size-3.5" />
          </Button>
        }
      />
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuItem
          disabled={!canMutate}
          onClick={() => target && props.treeActions.onRename(target)}
        >
          {t("knowledge.rename")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={!canMutate}
          onClick={() => target && props.treeActions.onMove(target)}
        >
          {t("knowledge.move_to")}
        </DropdownMenuItem>
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => target && props.treeActions.onFavorite(target)}
        >
          {favorited ? t("knowledge.unfavorite") : t("knowledge.favorite")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={disabled}>
            {t("knowledge.copy_path")}
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent align="start" className="min-w-36">
            <DropdownMenuItem
              onClick={() => target && props.treeActions.onCopyPath(target, "rel")}
            >
              {t("knowledge.copy_rel_path")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onClick={() => target && props.treeActions.onCopyPath(target, "abs")}
            >
              {t("knowledge.copy_abs_path")}
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>
        <DropdownMenuItem
          disabled={disabled}
          onClick={() => target && props.treeActions.onReveal(target)}
        >
          {t("knowledge.reveal")}
        </DropdownMenuItem>
        <DropdownMenuItem disabled={disabled} onClick={props.onShowInTree}>
          {t("knowledge.show_in_tree")}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          disabled={!canMutate}
          onClick={() => target && props.treeActions.onDelete(target)}
        >
          {t("knowledge.delete")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
