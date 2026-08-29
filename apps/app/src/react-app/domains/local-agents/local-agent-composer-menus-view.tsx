/** @jsxImportSource react */
import { Folder, Paperclip, SlashSquare } from "lucide-react";

import { MenuRowButton } from "@/components/ui/action-row";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { ArtifactIcon } from "../../capabilities/artifacts/artifact-icon";
import type { LocalAgentComposerFileEntry } from "@/app/lib/desktop";
import { localAgentComposerClass } from "./local-agent-composer-layout";
import type { LocalAgentSlashCommand } from "./local-agent-composer-types";

export function LocalAgentComposerSlashMenu(props: {
  commands: LocalAgentSlashCommand[];
  onSelect: (command: LocalAgentSlashCommand) => void;
}) {
  return (
    <div className={localAgentComposerClass.menuAnchor} data-testid="local-agent-slash-menu">
      <div className={cn(localAgentComposerClass.menuPanel, localAgentComposerClass.menuScroll)}>
        {props.commands.length ? (
          <div className="grid gap-0.5">
            {props.commands.map((command) => (
              <MenuRowButton
                key={`${command.source}:${command.name}`}
                type="button"
                align="start"
                density="compact"
                className="w-full justify-start gap-2 text-dls-text hover:text-dls-text"
                onClick={() => props.onSelect(command)}
                data-testid={`local-agent-slash-${command.name.replace(/^\//, "")}`}
              >
                <SlashSquare size={14} className={localAgentComposerClass.itemIcon} />
                <span className="min-w-0 flex-1 text-left">
                  <span className="flex items-center justify-between gap-2">
                    <span className={localAgentComposerClass.itemTitle}>{command.name}</span>
                    <span className="flex items-center gap-1">
                      {command.hint ? (
                        <kbd className="rounded-sm border border-dls-border bg-dls-surface-muted px-1 py-0.5 text-xs font-mono text-dls-secondary">
                          {command.hint}
                        </kbd>
                      ) : null}
                      <StatusBadge size="tiny" tone="surface">
                        {command.source === "acp" ? "ACP" : t("local_agent.slash_builtin")}
                      </StatusBadge>
                    </span>
                  </span>
                  {command.description ? (
                    <span className={cn("block", localAgentComposerClass.itemMeta)}>
                      {command.description}
                    </span>
                  ) : null}
                </span>
              </MenuRowButton>
            ))}
          </div>
        ) : (
          <div className="px-3 py-2 text-xs text-dls-secondary" data-testid="local-agent-slash-empty">
            {t("local_agent.slash_empty")}
          </div>
        )}
      </div>
    </div>
  );
}

export function LocalAgentComposerMentionMenu(props: {
  files: LocalAgentComposerFileEntry[];
  mentionIndex: number;
  onHover: (index: number) => void;
  onSelect: (entry: LocalAgentComposerFileEntry) => void;
}) {
  return (
    <div className={localAgentComposerClass.menuAnchor} data-testid="local-agent-mention-menu">
      <div className={cn(localAgentComposerClass.menuPanel, localAgentComposerClass.menuScroll)}>
        <div className="grid gap-0.5">
          {props.files.map((entry, index) => (
            <MenuRowButton
              key={entry.path}
              type="button"
              align="start"
              density="compact"
              className={cn(
                "w-full justify-start gap-2 text-dls-text hover:text-dls-text",
                index === props.mentionIndex && "bg-dls-hover",
              )}
              onMouseEnter={() => props.onHover(index)}
              onClick={() => props.onSelect(entry)}
            >
              {entry.isDirectory ? (
                <Folder className={cn("size-3.5", localAgentComposerClass.itemIcon)} />
              ) : (
                <ArtifactIcon name={entry.name} className={cn("size-3.5", localAgentComposerClass.itemIcon)} />
              )}
              <span className="min-w-0 flex-1 text-left">
                <span className={cn("block", localAgentComposerClass.itemTitle)}>
                  {entry.name}
                  {entry.isDirectory ? "/" : ""}
                </span>
                <span className={cn("block", localAgentComposerClass.itemMeta)}>{entry.relativePath}</span>
              </span>
            </MenuRowButton>
          ))}
        </div>
      </div>
    </div>
  );
}

export function LocalAgentComposerToolMenu(props: {
  slashCommands: LocalAgentSlashCommand[];
  onAddFile: () => void;
  onSelectSlash: (command: LocalAgentSlashCommand) => void;
}) {
  return (
    <div
      className={localAgentComposerClass.toolMenuPanel}
      style={{ backgroundColor: "var(--dls-surface-solid, var(--dls-surface))" }}
      role="menu"
      data-testid="local-agent-tool-menu"
    >
      <MenuRowButton
        type="button"
        align="center"
        density="compact"
        className="justify-start gap-2 text-dls-text hover:text-dls-text"
        onClick={props.onAddFile}
      >
        <Paperclip className="size-3.5 shrink-0 text-dls-text" />
        <span className="truncate text-sm leading-5">{t("composer.add_file")}</span>
      </MenuRowButton>
      {props.slashCommands.length > 0 ? (
        <>
          <div className="my-1 h-px bg-dls-border/80" role="separator" />
          <div className="px-2 py-1 text-2xs font-medium uppercase tracking-wide text-dls-secondary">
            {t("local_agent.slash_menu_title")}
          </div>
          <div className="max-h-48 overflow-y-auto">
            {props.slashCommands.map((command) => (
              <MenuRowButton
                key={`${command.source}:${command.name}`}
                type="button"
                align="start"
                density="compact"
                className="w-full justify-start gap-2 text-dls-text hover:text-dls-text"
                onClick={() => props.onSelectSlash(command)}
                data-testid={`local-agent-tool-slash-${command.name.replace(/^\//, "")}`}
              >
                <SlashSquare className={cn("size-3.5", localAgentComposerClass.itemIcon)} />
                <span className="min-w-0 flex-1 text-left">
                  <span className={cn("block", localAgentComposerClass.itemTitle)}>{command.name}</span>
                  {command.description ? (
                    <span className={cn("block", localAgentComposerClass.itemMeta)}>{command.description}</span>
                  ) : null}
                </span>
              </MenuRowButton>
            ))}
          </div>
        </>
      ) : null}
    </div>
  );
}
