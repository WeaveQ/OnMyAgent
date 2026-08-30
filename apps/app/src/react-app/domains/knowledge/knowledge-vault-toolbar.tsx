/** @jsxImportSource react */
import { Fragment } from "react";
import { ArrowDownAZ, Clock, FolderOpen, ListTree, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "../../../i18n";
import { ToolbarIconButton } from "./knowledge-vault-toolbar-button";
import { KnowledgeNewMenu } from "./knowledge-new-menu";
import {
  parseKnowledgeTreeSortKey,
  type KnowledgeTreeSortKey,
  type KnowledgeVaultScope,
} from "./knowledge-vault-model";

const SORT_ITEMS: { key: KnowledgeTreeSortKey; label: string; sep?: boolean }[] = [
  { key: "name-asc", label: "knowledge.sort_name_az" },
  { key: "name-desc", label: "knowledge.sort_name_za", sep: true },
  { key: "mtime-desc", label: "knowledge.sort_edited_new" },
  { key: "mtime-asc", label: "knowledge.sort_edited_old", sep: true },
  { key: "ctime-desc", label: "knowledge.sort_created_new" },
  { key: "ctime-asc", label: "knowledge.sort_created_old" },
];

type KnowledgeVaultToolbarProps = {
  scope: KnowledgeVaultScope;
  workspaceId?: string;
  expertId?: string;
  indexing: boolean;
  sortKey: KnowledgeTreeSortKey;
  allExpanded: boolean;
  onNewNote: () => void;
  onNewCsv: () => void;
  onNewFolder: () => void;
  onNewLink: () => void;
  onUploaded: () => void;
  onOpenFolder: () => void;
  onToggleExpand: () => void;
  onSortKeyChange: (key: KnowledgeTreeSortKey) => void;
  onToggleRecent: () => void;
  onRebuildIndex: () => void;
};

export function KnowledgeVaultToolbar(props: KnowledgeVaultToolbarProps) {
  const expandHint = props.allExpanded
    ? t("knowledge.toolbar_collapse_all")
    : t("knowledge.toolbar_expand_all");
  return (
    <div className="flex h-8 shrink-0 items-center gap-0.5 px-2.5 text-dls-secondary mac:titlebar-no-drag">
      <KnowledgeNewMenu
        scope={props.scope}
        workspaceId={props.workspaceId}
        expertId={props.expertId}
        onNewNote={props.onNewNote}
        onNewCsv={props.onNewCsv}
        onNewFolder={props.onNewFolder}
        onNewLink={props.onNewLink}
        onUploaded={props.onUploaded}
      />
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <ToolbarIconButton
        label={t("knowledge.open_folder")}
        hint={t("knowledge.toolbar_open_folder")}
        onClick={props.onOpenFolder}
      >
        <FolderOpen className="size-3.5" strokeWidth={1.75} />
      </ToolbarIconButton>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
              aria-label={t("knowledge.sort")}
              title={t("knowledge.sort")}
            >
              <ArrowDownAZ className="size-3.5" strokeWidth={1.75} />
            </Button>
          }
        />
        <DropdownMenuContent align="start" className="w-max min-w-max">
          <DropdownMenuRadioGroup
            value={props.sortKey}
            onValueChange={(value) => props.onSortKeyChange(parseKnowledgeTreeSortKey(value))}
          >
            {SORT_ITEMS.map((item) => (
              <Fragment key={item.key}>
                <DropdownMenuRadioItem value={item.key} className="whitespace-nowrap py-1.5 text-sm font-normal">
                  {t(item.label)}
                </DropdownMenuRadioItem>
                {item.sep ? <DropdownMenuSeparator /> : null}
              </Fragment>
            ))}
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarIconButton
        label={expandHint}
        hint={expandHint}
        pressed={props.allExpanded}
        onClick={props.onToggleExpand}
      >
        <ListTree className="size-3.5" strokeWidth={1.75} />
      </ToolbarIconButton>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <ToolbarIconButton
        label={t("knowledge.recent_title")}
        hint={t("knowledge.recent_title")}
        onClick={props.onToggleRecent}
      >
        <Clock className="size-3.5" strokeWidth={1.75} />
      </ToolbarIconButton>
      <span className="mx-0.5 h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
      <ToolbarIconButton
        label={t("knowledge.sync_index")}
        hint={t("knowledge.toolbar_sync_index")}
        disabled={props.indexing}
        busy={props.indexing}
        onClick={props.onRebuildIndex}
      >
        <RefreshCw
          className={`size-3.5 ${props.indexing ? "animate-spin" : ""}`}
          strokeWidth={1.75}
        />
      </ToolbarIconButton>
    </div>
  );
}
