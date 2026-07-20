/** @jsxImportSource react */
/**
 * Slash command and @mention popup menus for the session composer.
 * Extracted from composer.tsx (mechanical UI split).
 */
import type { RefObject } from "react";
import { FileText } from "lucide-react";
import { MenuRowButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import type { SlashCommandOption } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import {
  composerMenuClass,
  type MentionItem,
} from "./composer-helpers";

/** ~5 rows visible (py-2 + line + gap ≈ 2.25rem each). */
const SLASH_LIST_MAX_HEIGHT = "max-h-[11.25rem]";

function partitionSlashCommands(commands: SlashCommandOption[]) {
  const skills: SlashCommandOption[] = [];
  const cmds: SlashCommandOption[] = [];
  const mcps: SlashCommandOption[] = [];
  for (const command of commands) {
    if (command.source === "skill") skills.push(command);
    else if (command.source === "mcp") mcps.push(command);
    else cmds.push(command);
  }
  return { skills, cmds, mcps };
}

function SlashSectionHeader(props: { label: string; count: number }) {
  return (
    <div className="shrink-0 border-b border-dls-border/50 bg-dls-surface-solid px-3 py-2.5 text-sm font-semibold leading-none text-dls-text">
      {props.label}
      <span className="tabular-nums font-semibold text-dls-secondary">
        {" "}
        ({props.count})
      </span>
    </div>
  );
}

function SlashCommandRow(props: {
  command: SlashCommandOption;
  index: number;
  active: boolean;
  menuItemRefs: RefObject<Array<HTMLButtonElement | null>>;
  setMenuIndex: (index: number) => void;
  onSelect: (command: SlashCommandOption) => void;
}) {
  const { command } = props;
  const description = command.description?.trim() ?? "";
  return (
    <MenuRowButton
      ref={(element) => {
        props.menuItemRefs.current[props.index] = element;
      }}
      type="button"
      density="compact"
      align="center"
      active={props.active}
      className="gap-0 rounded-lg px-3 py-2"
      onMouseEnter={() => props.setMenuIndex(props.index)}
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
        props.onSelect(command);
      }}
      onClick={(event) => {
        if (event.detail === 0) props.onSelect(command);
      }}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2.5 overflow-hidden text-left">
        <span className="max-w-[40%] shrink-0 truncate text-sm font-medium leading-5 text-dls-text">
          /{command.name}
        </span>
        {description ? (
          <span className="min-w-0 flex-1 truncate text-xs leading-5 text-dls-secondary">
            {description}
          </span>
        ) : null}
      </div>
    </MenuRowButton>
  );
}

function SlashScrollList(props: {
  items: SlashCommandOption[];
  filtered: SlashCommandOption[];
  activeMenu: string | null;
  menuIndex: number;
  menuItemRefs: RefObject<Array<HTMLButtonElement | null>>;
  setMenuIndex: (index: number) => void;
  onSelect: (command: SlashCommandOption) => void;
}) {
  const indexById = new Map(
    props.filtered.map((command, index) => [command.id, index] as const),
  );
  return (
    <div
      role="presentation"
      className={cn(SLASH_LIST_MAX_HEIGHT, "min-h-0 overflow-y-auto px-1.5 py-1")}
      onMouseDown={(event) => event.preventDefault()}
    >
      <div className="flex flex-col gap-0.5">
        {props.items.map((command) => {
          const index = indexById.get(command.id) ?? 0;
          return (
            <SlashCommandRow
              key={command.id}
              command={command}
              index={index}
              active={
                props.activeMenu === "slash" &&
                props.filtered[props.menuIndex]?.id === command.id
              }
              menuItemRefs={props.menuItemRefs}
              setMenuIndex={props.setMenuIndex}
              onSelect={props.onSelect}
            />
          );
        })}
      </div>
    </div>
  );
}

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

  const { skills, cmds, mcps } = partitionSlashCommands(props.filtered);
  // Merge skills + commands under 「技能」; keep connectors separate.
  // (Many backends tag skills as source "command" — still show under 技能.)
  const skillItems = [...skills, ...cmds];

  return (
    <div className={composerMenuClass.anchor}>
      <div className={composerMenuClass.panel}>
        {props.filtered.length > 0 ? (
          <div className="flex min-h-0 flex-col">
            {skillItems.length > 0 ? (
              <>
                {/* Fixed title — does not scroll with the list. */}
                <SlashSectionHeader
                  label={t("composer.slash_section_skills")}
                  count={skillItems.length}
                />
                <SlashScrollList
                  items={skillItems}
                  filtered={props.filtered}
                  activeMenu={props.activeMenu}
                  menuIndex={props.menuIndex}
                  menuItemRefs={props.menuItemRefs}
                  setMenuIndex={props.setMenuIndex}
                  onSelect={props.onSelect}
                />
              </>
            ) : null}
            {mcps.length > 0 ? (
              <>
                <SlashSectionHeader
                  label={t("composer.slash_section_mcps")}
                  count={mcps.length}
                />
                <SlashScrollList
                  items={mcps}
                  filtered={props.filtered}
                  activeMenu={props.activeMenu}
                  menuIndex={props.menuIndex}
                  menuItemRefs={props.menuItemRefs}
                  setMenuIndex={props.setMenuIndex}
                  onSelect={props.onSelect}
                />
              </>
            ) : null}
          </div>
        ) : (
          <div
            role="presentation"
            className="px-3 py-3 text-sm leading-5 text-dls-secondary"
            onMouseDown={(event) => event.preventDefault()}
          >
            {!props.commandsLoaded && props.commandsLoading
              ? t("composer.loading_commands")
              : t("composer.no_commands")}
          </div>
        )}
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
          <div className="grid gap-0.5">
            {props.filtered.map((item, index) => (
              <MenuRowButton
                key={item.id}
                ref={(element) => {
                  props.menuItemRefs.current[index] = element;
                }}
                type="button"
                density="compact"
                align="center"
                active={
                  props.activeMenu === "mention" &&
                  props.filtered[props.menuIndex]?.id === item.id
                }
                className="gap-2 px-2.5 py-1.5"
                onMouseEnter={() => props.setMenuIndex(index)}
                onClick={() => props.onSelect(item)}
              >
                <FileText className="size-3.5 shrink-0 text-dls-secondary" />
                <div className="min-w-0 flex-1 overflow-hidden text-left">
                  <div className="truncate text-sm font-medium leading-5 text-dls-text">
                    @{item.label}
                  </div>
                  <div className="truncate text-sm leading-5 text-dls-secondary">
                    {t("composer.file_kind")}
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
