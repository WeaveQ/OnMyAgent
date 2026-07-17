/** @jsxImportSource react */
/**
 * Slash command and @mention popup menus for the session composer.
 * Extracted from composer.tsx (mechanical UI split).
 */
import type { RefObject } from "react";
import { FileText, Terminal, Zap } from "lucide-react";
import { MenuRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import type { SlashCommandOption } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import {
  composerMenuClass,
  composerTextClass,
  type MentionItem,
} from "./composer-helpers";

export function ComposerSlashMenu(props: {
  open: boolean;
  filtered: SlashCommandOption[];
  commandsLoaded: boolean;
  commandsLoading: boolean;
  activeMenu: string | null;
  menuIndex: number;
  menuItemRefs: RefObject<Array<HTMLButtonElement | null>>;
  setMenuIndex: (index: number) => void;
  onSelect: (command: SlashCommandOption) => void;
}) {
  if (!props.open) return null;
  return (
    <div className={composerMenuClass.anchor}>
      <div className={composerMenuClass.panel}>
        <div
          role="presentation"
          className={composerMenuClass.scrollArea}
          onMouseDown={(event) => event.preventDefault()}
        >
          {props.filtered.length > 0 ? (
            <div className="grid gap-1">
              {props.filtered.map((command, index) => (
                <MenuRowButton
                  key={command.id}
                  ref={(element) => {
                    props.menuItemRefs.current[index] = element;
                  }}
                  type="button"
                  active={
                    props.activeMenu === "slash" &&
                    props.filtered[props.menuIndex]?.id === command.id
                  }
                  onMouseEnter={() => props.setMenuIndex(index)}
                  onMouseDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    props.onSelect(command);
                  }}
                  onClick={(event) => {
                    if (event.detail === 0) props.onSelect(command);
                  }}
                >
                  <Terminal size={14} className={composerMenuClass.itemIcon} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-3">
                      <div className={composerMenuClass.itemTitle}>/{command.name}</div>
                      {command.source && command.source !== "command" ? (
                        <StatusBadge
                          className={
                            command.source === "skill"
                              ? composerTextClass.sourceBadge
                              : composerTextClass.commandBadge
                          }
                          size="tiny"
                        >
                          {command.source === "skill"
                            ? t("composer.skill_source")
                            : t("composer.mcps_label")}
                        </StatusBadge>
                      ) : null}
                    </div>
                    {command.description ? (
                      <div className={composerMenuClass.itemMeta}>{command.description}</div>
                    ) : null}
                  </div>
                </MenuRowButton>
              ))}
            </div>
          ) : (
            <div className="px-3 py-2 text-xs text-dls-secondary">
              {!props.commandsLoaded && props.commandsLoading
                ? t("composer.loading_commands")
                : t("composer.no_commands")}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function ComposerMentionMenu(props: {
  open: boolean;
  filtered: MentionItem[];
  activeMenu: string | null;
  menuIndex: number;
  menuItemRefs: RefObject<Array<HTMLButtonElement | null>>;
  setMenuIndex: (index: number) => void;
  onSelect: (item: MentionItem) => void;
}) {
  if (!props.open || props.filtered.length === 0) return null;
  return (
    <div className={composerMenuClass.anchor}>
      <div className={composerMenuClass.panelWithoutBottomBorder}>
        <div
          role="presentation"
          className={composerMenuClass.scrollArea}
          onMouseDown={(event) => event.preventDefault()}
        >
          <div className="grid gap-1">
            {props.filtered.map((item, index) => (
              <MenuRowButton
                key={item.id}
                ref={(element) => {
                  props.menuItemRefs.current[index] = element;
                }}
                type="button"
                active={
                  props.activeMenu === "mention" &&
                  props.filtered[props.menuIndex]?.id === item.id
                }
                onMouseEnter={() => props.setMenuIndex(index)}
                onClick={() => props.onSelect(item)}
              >
                {item.kind === "agent" ? (
                  <Zap size={14} className={composerMenuClass.itemIcon} />
                ) : (
                  <FileText size={14} className={composerMenuClass.itemIcon} />
                )}
                <div className="min-w-0">
                  <div className={composerMenuClass.itemTitle}>@{item.label}</div>
                  <div className={composerMenuClass.itemMeta}>
                    {item.kind === "agent"
                      ? t("composer.agent_label")
                      : t("composer.file_kind")}
                  </div>
                </div>
              </MenuRowButton>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
