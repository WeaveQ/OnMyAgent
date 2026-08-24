/** @jsxImportSource react */
import { MoreHorizontal, PencilLine, Plus, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
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
      <div className="flex h-full min-w-0 flex-1 items-center overflow-x-auto mac:titlebar-no-drag">
        {props.tabs.map((tab, index) => {
          const active = tab.id === props.activeId;
          const dirty = tab.draft !== tab.loaded;
          const label = tabLabel(tab);
          return (
            <div key={tab.id} className="flex h-full w-32 shrink-0 items-center overflow-hidden">
              {index > 0 ? (
                <span className="h-4 w-px shrink-0 bg-dls-border" aria-hidden />
              ) : null}
              <div
                className={cn(
                  "group relative flex h-full min-w-0 flex-1 cursor-pointer items-center overflow-hidden px-3",
                  active ? "text-dls-text" : "text-dls-secondary hover:text-dls-text",
                )}
                onClick={() => props.onActivate(tab.id)}
              >
                <button
                  type="button"
                  className={cn(
                    "block min-w-0 w-full cursor-pointer truncate pe-5 text-left text-sm leading-none",
                    active ? "font-medium" : "font-normal",
                  )}
                  title={label}
                  onClick={() => props.onActivate(tab.id)}
                >
                  {dirty ? "• " : ""}
                  {label}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 size-6 -translate-y-1/2 opacity-0 group-hover:opacity-100 data-[active=true]:opacity-70"
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
                {active ? (
                  <span className="absolute inset-x-3 bottom-0 h-px bg-dls-text" aria-hidden />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
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
