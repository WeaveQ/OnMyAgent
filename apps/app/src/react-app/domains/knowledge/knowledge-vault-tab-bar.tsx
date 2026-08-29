/** @jsxImportSource react */
import { MoreHorizontal, PencilLine, Plus, X } from "lucide-react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { t } from "../../../i18n";
import { GETTING_STARTED_REL_PATH } from "./knowledge-vault-model";
import { parseKnowledgeNoteProps } from "./knowledge-vault-frontmatter";
import type { KnowledgeEditorTab } from "./knowledge-vault-tabs";

type KnowledgeVaultTabBarProps = {
  tabs: readonly KnowledgeEditorTab[];
  activeId: string;
  onActivate: (id: string) => void;
  onClose: (id: string) => void;
  onAdd: () => void;
  mode: "view" | "edit";
  onModeChange: (mode: "view" | "edit") => void;
};

function tabLabel(tab: KnowledgeEditorTab): string {
  if (!tab.note) return t("knowledge.empty_tab");
  if (tab.note.relPath === GETTING_STARTED_REL_PATH) return t("knowledge.getting_started");
  const title = parseKnowledgeNoteProps(tab.draft).title.trim();
  if (title) return title;
  return tab.note.relPath.split("/").pop() ?? tab.note.relPath;
}

export function KnowledgeVaultTabBar(props: KnowledgeVaultTabBarProps) {
  return (
    <div className="flex h-14 min-h-0 w-full min-w-0 items-center bg-dls-background mac:titlebar-drag">
      <SegmentedTabGroup
        density="bare"
        role="tablist"
        className="h-full min-h-0 w-auto min-w-0 flex-1 overflow-x-auto mac:titlebar-no-drag"
      >
        {props.tabs.map((tab) => {
          const active = tab.id === props.activeId;
          const dirty = tab.draft !== tab.loaded;
          const label = tabLabel(tab);
          return (
            <div key={tab.id} className="group relative flex w-32 shrink-0 items-center">
              <NavTabButton
                type="button"
                role="tab"
                size="tab"
                shape="tab"
                active={active}
                className="h-8 w-32 min-w-0 cursor-pointer justify-start px-3 text-left"
                title={label}
                aria-current={active ? "page" : undefined}
                aria-selected={active}
                onClick={() => props.onActivate(tab.id)}
              >
                {dirty ? (
                  <span className="size-1.5 shrink-0 rounded-full bg-current" aria-hidden />
                ) : null}
                <span className="block min-w-0 w-full truncate pe-5 text-left text-sm leading-none">
                  {label}
                </span>
              </NavTabButton>
              <Button
                variant="ghost"
                size="icon-sm"
                className="absolute right-1 top-1/2 size-6 -translate-y-1/2 opacity-0 group-hover:opacity-100 data-[active=true]:opacity-70 data-[active=true]:text-white"
                data-active={active}
                onClick={(event) => {
                  event.stopPropagation();
                  props.onClose(tab.id);
                }}
                aria-label={t("knowledge.close_tab")}
                title={t("knowledge.close_tab")}
              >
                <X className="size-3" />
              </Button>
            </div>
          );
        })}
      </SegmentedTabGroup>
      <div className="flex h-10 shrink-0 items-center gap-0.5 pe-2.5 mac:titlebar-no-drag">
        <Button
          variant="ghost"
          size="icon-sm"
          onClick={props.onAdd}
          aria-label={t("knowledge.new_tab")}
          title={t("knowledge.new_tab")}
        >
          <Plus className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          className={props.mode === "edit" ? "bg-dls-list-selected" : undefined}
          onClick={() => props.onModeChange(props.mode === "edit" ? "view" : "edit")}
          aria-label={props.mode === "edit" ? t("knowledge.mode_view") : t("knowledge.mode_edit")}
          title={props.mode === "edit" ? t("knowledge.mode_view") : t("knowledge.mode_edit")}
        >
          <PencilLine className="size-4" />
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger
            render={
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={t("knowledge.more")}
                title={t("knowledge.more")}
              >
                <MoreHorizontal className="size-4" />
              </Button>
            }
          />
          <DropdownMenuContent align="end" className="min-w-36">
            <DropdownMenuItem onClick={() => props.onModeChange("view")}>
              {t("knowledge.mode_view")}
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => props.onModeChange("edit")}>
              {t("knowledge.mode_edit")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
