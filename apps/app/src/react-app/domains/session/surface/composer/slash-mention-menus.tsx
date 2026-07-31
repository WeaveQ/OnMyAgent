/** @jsxImportSource react */
/**
 * Slash command and @mention popup menus for the session composer.
 * Extracted from composer.tsx (mechanical UI split).
 */
import type { RefObject } from "react";
import { ChevronLeft, ChevronRight, Folder } from "lucide-react";
import { MenuRowButton } from "@/components/ui/action-row";
import { ArtifactIcon } from "../../artifacts/artifact-icon";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import { cn } from "@/lib/utils";
import type { SlashCommandOption } from "../../../../../app/types";
import { t } from "../../../../../i18n";
import { formatWorkspaceFolderDisplayName } from "../../../workspace/workspace-files-model";
import {
  composerMenuClass,
  type MentionItem,
} from "./composer-helpers";
import { skillMenuDescription } from "./tool-menu-model";

/** ~5 rows visible (py-2 + line + gap ≈ 2.25rem each). */
const SLASH_LIST_MAX_HEIGHT = "max-h-[11.25rem]";

function mentionFolderTitle(folderPath: string): string {
  if (folderPath === "uploads") return t("files.source_uploads");
  if (folderPath === "tasks" || folderPath === "projects") {
    return t("files.source_task");
  }
  if (folderPath === "experts") return t("files.source_expert");
  const segment = folderPath.split("/").filter(Boolean).at(-1) ?? folderPath;
  return formatWorkspaceFolderDisplayName(segment);
}

function partitionSlashCommands(commands: SlashCommandOption[]) {
  const skills: SlashCommandOption[] = [];
  const cmds: SlashCommandOption[] = [];
  for (const command of commands) {
    // Connectors (source "mcp") are excluded from slash — use + → connectors.
    if (command.source === "mcp") continue;
    if (command.source === "skill") skills.push(command);
    else cmds.push(command);
  }
  return { skills, cmds };
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
  // Match + skills flyout: strip noisy "(opencode - Skill)" prefixes.
  const description = skillMenuDescription(command.description);
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

  const { skills, cmds } = partitionSlashCommands(props.filtered);
  // Merge skills + commands under skills only (no connector section).
  // (Many backends tag skills as source "command" — still show under skills.)
  const skillItems = [...skills, ...cmds];

  return (
    <div className={composerMenuClass.anchor}>
      <div className={composerMenuClass.panel}>
        {skillItems.length > 0 ? (
          <div className="flex min-h-0 flex-col">
            {/* Fixed title — does not scroll with the list. */}
            <SlashSectionHeader
              label={t("composer.slash_section_skills")}
              count={skillItems.length}
            />
            <SlashScrollList
              items={skillItems}
              filtered={skillItems}
              activeMenu={props.activeMenu}
              menuIndex={props.menuIndex}
              menuItemRefs={props.menuItemRefs}
              setMenuIndex={props.setMenuIndex}
              onSelect={props.onSelect}
            />
          </div>
        ) : (
          <div
            role="presentation"
            className="px-3 py-3 text-sm leading-5 text-dls-secondary"
            onMouseDown={(event) => event.preventDefault()}
          >
            {props.commandsLoading
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
  folderPath: string | null;
  folderItems: MentionItem[];
  folderLoading: boolean;
  folderAdding: boolean;
  folderError: string | null;
  selectedFilePaths: ReadonlySet<string>;
  activeMenu: string | null;
  menuIndex: number;
  menuItemRefs: RefObject<Array<HTMLButtonElement | null>>;
  setMenuIndex: (index: number) => void;
  onSelect: (item: MentionItem) => void;
  onOpenFolder: (path: string) => void;
  onBackFolder: () => void;
  onToggleFile: (path: string) => void;
  onAddSelectedFiles: () => void;
}) {
  if (!props.open) return null;
  if (props.folderPath) {
    const folderTitle = mentionFolderTitle(props.folderPath);
    return (
      <div className={composerMenuClass.anchor}>
        <div className={composerMenuClass.panelWithoutBottomBorder}>
          <div className="flex items-center gap-2 border-b border-dls-border px-2.5 py-2">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("composer.folder_files_back")}
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onBackFolder();
              }}
              onClick={(event) => {
                if (event.detail === 0) props.onBackFolder();
              }}
            >
              <ChevronLeft />
            </Button>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium text-dls-text">
                {folderTitle}
              </div>
              <div className="truncate text-xs text-dls-secondary">
                {t("composer.folder_files_hint")}
              </div>
            </div>
            <Button
              type="button"
              size="sm"
              disabled={
                props.folderAdding || props.selectedFilePaths.size === 0
              }
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
                props.onAddSelectedFiles();
              }}
              onClick={(event) => {
                if (event.detail === 0) props.onAddSelectedFiles();
              }}
            >
              {props.folderAdding
                ? t("composer.folder_files_adding")
                : t("composer.folder_files_add", {
                    count: props.selectedFilePaths.size,
                  })}
            </Button>
          </div>
          {props.folderError ? (
            <div
              role="alert"
              className="border-b border-dls-status-danger-border bg-dls-status-danger-soft px-3 py-2 text-xs text-dls-status-danger-fg"
            >
              {props.folderError}
            </div>
          ) : null}
          <div
            role="presentation"
            className={composerMenuClass.scrollArea}
            onMouseDown={(event) => event.preventDefault()}
          >
            {props.folderLoading ? (
              <div className="flex min-h-20 items-center justify-center">
                <LoadingSpinner />
                <span className="sr-only">
                  {t("composer.folder_files_loading")}
                </span>
              </div>
            ) : props.folderItems.length === 0 ? (
              <div className="px-3 py-4 text-center text-sm text-dls-secondary">
                {t("composer.folder_files_empty")}
              </div>
            ) : (
              <div className="grid gap-0.5">
                {props.folderItems.map((item) =>
                  item.kind === "directory" ? (
                    <MenuRowButton
                      key={item.id}
                      type="button"
                      density="compact"
                      align="center"
                      className="gap-2 px-2.5 py-1.5"
                      onClick={() => props.onOpenFolder(item.value)}
                    >
                      <Folder className="size-3.5 shrink-0 text-dls-secondary" />
                      <span className="min-w-0 flex-1 truncate text-sm font-medium text-dls-text">
                        {item.label}
                      </span>
                      <ChevronRight className="size-3.5 text-dls-secondary" />
                    </MenuRowButton>
                  ) : (
                    <label
                      key={item.id}
                      className="flex cursor-pointer items-center gap-2 rounded-lg px-2.5 py-1.5 text-sm text-dls-text transition-colors hover:bg-dls-surface-muted/70"
                    >
                      <Checkbox
                        checked={props.selectedFilePaths.has(item.value)}
                        onCheckedChange={() => props.onToggleFile(item.value)}
                      />
                      <ArtifactIcon
                        name={item.value || item.label}
                        className="size-3.5 shrink-0"
                      />
                      <span className="min-w-0 flex-1 truncate">
                        {item.label}
                      </span>
                    </label>
                  ),
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }
  if (props.filtered.length === 0) return null;
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
                {item.kind === "directory" ? (
                  <Folder className="size-3.5 shrink-0 text-dls-secondary" />
                ) : (
                  <ArtifactIcon name={item.value || item.label} className="size-3.5 shrink-0" />
                )}
                <div className="min-w-0 flex-1 overflow-hidden text-left">
                  <div className="truncate text-sm font-medium leading-5 text-dls-text">
                    {item.kind === "directory" ? item.label : `@${item.label}`}
                  </div>
                  <div className="truncate text-sm leading-5 text-dls-secondary">
                    {item.subtitle ||
                      t(
                        item.kind === "directory"
                          ? "composer.folder_kind"
                          : "composer.file_kind",
                      )}
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
