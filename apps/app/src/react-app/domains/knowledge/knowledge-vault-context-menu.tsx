/** @jsxImportSource react */
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { t } from "../../../i18n";
import { GETTING_STARTED_REL_PATH } from "./knowledge-vault-model";

export type KnowledgeContextTarget =
  | { kind: "file"; relPath: string }
  | { kind: "dir"; path: string }
  | { kind: "root" };

type KnowledgeVaultContextMenuProps = {
  target: KnowledgeContextTarget;
  favorited?: boolean;
  children: React.ReactElement;
  onNewNote: (folder: string) => void;
  onNewFolder: (folder: string) => void;
  onDuplicate: (relPath: string) => void;
  onMove: (target: KnowledgeContextTarget) => void;
  onSearchInFolder: (folder: string) => void;
  onFavorite: (target: KnowledgeContextTarget) => void;
  onCopyPath: (target: KnowledgeContextTarget, which: "rel" | "abs") => void;
  onReveal: (target: KnowledgeContextTarget) => void;
  onRename: (target: KnowledgeContextTarget) => void;
  onDelete: (target: KnowledgeContextTarget) => void;
};

function contextFolder(target: KnowledgeContextTarget): string {
  if (target.kind === "dir") return target.path;
  if (target.kind === "file") {
    const slash = target.relPath.lastIndexOf("/");
    return slash >= 0 ? target.relPath.slice(0, slash) : "";
  }
  return "";
}

export function KnowledgeVaultContextMenu(props: KnowledgeVaultContextMenuProps) {
  const folder = contextFolder(props.target);
  const isSeedFile =
    props.target.kind === "file" && props.target.relPath === GETTING_STARTED_REL_PATH;
  const canMutateItem = props.target.kind !== "root" && !isSeedFile;
  const canSearchFolder = props.target.kind === "dir" || Boolean(folder);
  const itemClass = "rounded-md px-2 py-1 text-sm font-normal";
  const panelClass =
    "min-w-40 p-1 bg-dls-surface text-dls-text shadow-lg ring-1 ring-dls-border";

  return (
    <ContextMenu>
      <ContextMenuTrigger render={props.children} />
      <ContextMenuContent className={panelClass}>
        <ContextMenuItem className={itemClass} onClick={() => props.onNewNote(folder)}>
          {t("knowledge.new_note")}
        </ContextMenuItem>
        <ContextMenuItem className={itemClass} onClick={() => props.onNewFolder(folder)}>
          {t("knowledge.new_folder")}
        </ContextMenuItem>
        {props.target.kind === "root" ? null : (
          <>
        <ContextMenuSeparator />
        {props.target.kind === "file" ? (
          <ContextMenuItem
            className={itemClass}
            onClick={() => {
              if (props.target.kind !== "file") return;
              props.onDuplicate(props.target.relPath);
            }}
          >
            {t("knowledge.duplicate")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem className={itemClass} onClick={() => props.onMove(props.target)}>
          {t("knowledge.move_to")}
        </ContextMenuItem>
        {canSearchFolder ? (
          <ContextMenuItem
            className={itemClass}
            onClick={() =>
              props.onSearchInFolder(
                props.target.kind === "dir" ? props.target.path : folder,
              )
            }
          >
            {t("knowledge.search_in_folder")}
          </ContextMenuItem>
        ) : null}
        <ContextMenuItem className={itemClass} onClick={() => props.onFavorite(props.target)}>
          {props.favorited ? t("knowledge.unfavorite") : t("knowledge.favorite")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuSub>
          <ContextMenuSubTrigger className={itemClass}>{t("knowledge.copy_path")}</ContextMenuSubTrigger>
          <ContextMenuSubContent className={panelClass}>
            <ContextMenuItem className={itemClass} onClick={() => props.onCopyPath(props.target, "rel")}>
              {t("knowledge.copy_rel_path")}
            </ContextMenuItem>
            <ContextMenuItem className={itemClass} onClick={() => props.onCopyPath(props.target, "abs")}>
              {t("knowledge.copy_abs_path")}
            </ContextMenuItem>
          </ContextMenuSubContent>
        </ContextMenuSub>
        <ContextMenuSeparator />
        <ContextMenuItem className={itemClass} onClick={() => props.onReveal(props.target)}>
          {t("knowledge.reveal")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className={itemClass}
          disabled={!canMutateItem}
          onClick={() => props.onRename(props.target)}
        >
          {t("knowledge.rename")}
        </ContextMenuItem>
        <ContextMenuItem
          className={itemClass}
          variant="destructive"
          disabled={!canMutateItem}
          onClick={() => props.onDelete(props.target)}
        >
          {t("knowledge.delete")}
        </ContextMenuItem>
          </>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
