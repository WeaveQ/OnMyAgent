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
import { t } from "../../../../i18n";
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
    <div className="flex h-10 shrink-0 items-stretch bg-dls-background mac:titlebar-drag">
      <div className="flex min-w-0 shrink-0 items-stretch overflow-x-auto mac:titlebar-no-drag">
        {props.tabs.map((tab, index) => {
          const active = tab.id === props.activeId;
          const dirty = tab.draft !== tab.loaded;
          return (
            <div key={tab.id} className="flex h-full shrink-0 items-center">
              {index > 0 ? (
                <span className="h-3.5 w-px shrink-0 bg-dls-border" aria-hidden />
              ) : null}
              <div
                className={cn(
                  "group relative flex h-full w-36 cursor-pointer items-center justify-center px-6",
                  active ? "text-dls-text" : "text-dls-secondary hover:text-dls-text",
                )}
                onClick={() => props.onActivate(tab.id)}
              >
                <button
                  type="button"
                  className={cn(
                    "max-w-full cursor-pointer truncate text-center text-sm leading-none",
                    active ? "font-medium" : "font-normal",
                  )}
                  title={tabLabel(tab)}
                  onClick={() => props.onActivate(tab.id)}
                >
                  {dirty ? "• " : ""}
                  {tabLabel(tab)}
                </button>
                <Button
                  variant="ghost"
                  size="icon-sm"
                  className="absolute right-1 top-1/2 size-5 -translate-y-1/2 opacity-0 group-hover:opacity-100 data-[active=true]:opacity-70"
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
                  <span className="absolute inset-x-4 bottom-1 h-px bg-dls-text" aria-hidden />
                ) : null}
              </div>
            </div>
          );
        })}
      </div>
      <div className="min-w-4 flex-1" aria-hidden />
      <Button
        variant="ghost"
        size="icon-sm"
        className="m-1 shrink-0 mac:titlebar-no-drag"
        onClick={props.onAdd}
        aria-label={t("knowledge.new_tab")}
        title={t("knowledge.new_tab")}
      >
        <Plus className="size-4" />
      </Button>
      <div className="flex shrink-0 items-center gap-0.5 px-1 mac:titlebar-no-drag">
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
