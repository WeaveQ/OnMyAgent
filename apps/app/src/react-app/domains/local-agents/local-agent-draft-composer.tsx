/** @jsxImportSource react */
import { memo, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

import { SendButton } from "@/components/ui/send-button";
import { StatusBadge } from "@/components/ui/status-badge";
import { Textarea } from "@/components/ui/textarea";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type LocalAgentSlashCommand = {
  name: string;
  description: string;
  source: "acp" | "builtin";
  selectionBehavior: "insert" | "execute";
};

export const LocalAgentDraftComposer = memo(function LocalAgentDraftComposer(props: {
  draftKey: string;
  initialDraft: string;
  disabled: boolean;
  submitting: boolean;
  placeholder: string;
  slashCommands: LocalAgentSlashCommand[];
  onDraftCommit: (draftKey: string, value: string) => void;
  onSubmit: (value: string) => void;
  onSlashCommandExecute?: (command: LocalAgentSlashCommand) => void;
  toolbarLeft?: ReactNode;
  toolbarRight?: ReactNode;
}) {
  const [value, setValue] = useState(props.initialDraft);
  const [slashOpen, setSlashOpen] = useState(false);
  const [focused, setFocused] = useState(false);
  const slashQuery = value.startsWith("/") && !/\s/.test(value) ? value.toLowerCase() : "";
  const visibleSlashCommands = useMemo(
    () => slashQuery ? props.slashCommands.filter((command) => command.name.toLowerCase().startsWith(slashQuery)).slice(0, 8) : [],
    [props.slashCommands, slashQuery],
  );
  useEffect(() => setValue(props.initialDraft), [props.draftKey, props.initialDraft]);
  useEffect(() => {
    const timer = window.setTimeout(() => props.onDraftCommit(props.draftKey, value), 350);
    return () => window.clearTimeout(timer);
  }, [props.draftKey, props.onDraftCommit, value]);
  const submit = useCallback(() => {
    props.onDraftCommit(props.draftKey, value);
    props.onSubmit(value);
  }, [props, value]);
  const selectSlashCommand = useCallback((command: LocalAgentSlashCommand) => {
    setSlashOpen(false);
    if (command.source === "builtin") {
      setValue("");
      props.onDraftCommit(props.draftKey, "");
      props.onSlashCommandExecute?.(command);
      return;
    }
    const nextValue = `${command.name} `;
    setValue(nextValue);
    props.onDraftCommit(props.draftKey, nextValue);
  }, [props]);
  return (
    <div
      className={cn(
        "relative rounded-2xl border bg-dls-surface transition-colors",
        focused ? "border-dls-accent/60 shadow-[0_0_0_3px_rgba(59,130,246,0.08)]" : "border-dls-border",
      )}
      data-local-agent-composer-root="true"
    >
      {slashOpen ? (
        <div
          className="absolute bottom-[calc(100%+0.5rem)] left-0 right-0 z-20 max-h-56 overflow-y-auto rounded-lg border border-dls-border bg-dls-surface p-1 shadow-lg"
          data-testid="local-agent-slash-menu"
        >
          {visibleSlashCommands.length ? visibleSlashCommands.map((command) => (
            <button
              key={`${command.source}:${command.name}`}
              type="button"
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-dls-hover"
              onClick={() => selectSlashCommand(command)}
              data-testid={`local-agent-slash-${command.name.replace(/^\//, "")}`}
            >
              <span className="min-w-0">
                <span className="block font-medium text-dls-text">{command.name}</span>
                {command.description ? <span className="block truncate text-xs text-dls-secondary">{command.description}</span> : null}
              </span>
              <StatusBadge size="tiny" tone="surface">{command.source === "acp" ? "ACP" : t("local_agent.slash_builtin")}</StatusBadge>
            </button>
          )) : (
            <div className="px-3 py-2 text-sm text-dls-secondary" data-testid="local-agent-slash-empty">
              {t("local_agent.slash_empty")}
            </div>
          )}
        </div>
      ) : null}
      <Textarea
        rows={2}
        className="min-h-[52px] resize-none border-0 bg-transparent px-4 pb-1 pt-3 text-sm leading-6 shadow-none focus-visible:ring-0"
        aria-label={t("local_agent.input_aria")}
        data-local-agent-composer="true"
        value={value}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onChange={(event) => { setValue(event.target.value); setSlashOpen(event.target.value.startsWith("/")); }}
        onKeyDown={(event) => {
          if (event.key === "Escape" && slashOpen) { event.preventDefault(); setSlashOpen(false); return; }
          if ((event.key === "Tab" || event.key === "Enter") && slashOpen && visibleSlashCommands.length) {
            event.preventDefault();
            selectSlashCommand(visibleSlashCommands[0]);
            return;
          }
          if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); submit(); }
        }}
        placeholder={props.placeholder}
        disabled={props.disabled || props.submitting}
      />
      <div className="flex items-center justify-between gap-2 px-2 pb-2 pt-1">
        <div className="flex min-w-0 items-center gap-1">{props.toolbarLeft}</div>
        <div className="flex shrink-0 items-center gap-1.5">
          {props.toolbarRight}
          <SendButton
            aria-label={t("local_agent.send_aria")}
            onClick={submit}
            disabled={!value.trim() || props.disabled || props.submitting}
            loading={props.submitting}
          />
        </div>
      </div>
    </div>
  );
});
LocalAgentDraftComposer.displayName = "LocalAgentDraftComposer";
