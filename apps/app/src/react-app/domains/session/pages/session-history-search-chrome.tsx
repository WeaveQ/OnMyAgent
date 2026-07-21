/** @jsxImportSource react */
/**
 * Shared session header chrome: find-in-transcript expand + history popover slot + side panel toggle.
 */
import type { ReactNode, RefObject, MouseEvent } from "react";
import { ChevronDown, ChevronUp, PanelRight, Search, X } from "lucide-react";

import { t } from "../../../../i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export function SessionHistorySearchChrome(props: {
  searchOpen: boolean;
  searchQuery: string;
  matchLabel: string;
  matchCount: number;
  shortcutLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  onQueryChange: (query: string) => void;
  onOpen: (event: MouseEvent) => void;
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
  onEnterNavigate: (shiftKey: boolean) => void;
  historyPopover: ReactNode;
  sidePanelOpen: boolean;
  onToggleSidePanel: (event: MouseEvent) => void;
}) {
  const searchControl = props.searchOpen ? (
    <div
      className={cn(
        "flex h-8 items-center gap-1 rounded-full border border-dls-border",
        "bg-dls-surface-muted/70 px-2 shadow-sm",
        "focus-within:border-dls-accent/40 focus-within:bg-dls-surface-solid",
      )}
    >
      <Search className="size-3.5 shrink-0 text-dls-secondary" aria-hidden />
      <input
        ref={props.inputRef}
        type="search"
        value={props.searchQuery}
        onChange={(event) => props.onQueryChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            if (!props.matchCount) return;
            props.onEnterNavigate(event.shiftKey);
          } else if (event.key === "Escape") {
            event.preventDefault();
            props.onClose();
          }
        }}
        placeholder={t("session.conversation_history_search_header_placeholder")}
        className="w-40 min-w-0 bg-transparent text-sm text-dls-text outline-none placeholder:text-dls-secondary/70 sm:w-52"
        aria-label={t("session.conversation_history_search_header_placeholder")}
      />
      {props.matchLabel ? (
        <span className="shrink-0 tabular-nums text-xs text-dls-secondary">
          {props.matchLabel}
        </span>
      ) : null}
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-dls-secondary hover:text-dls-text"
        disabled={!props.matchCount}
        onClick={props.onPrev}
        title={t("session.conversation_history_search_prev")}
        aria-label={t("session.conversation_history_search_prev")}
      >
        <ChevronUp className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-dls-secondary hover:text-dls-text"
        disabled={!props.matchCount}
        onClick={props.onNext}
        title={t("session.conversation_history_search_next")}
        aria-label={t("session.conversation_history_search_next")}
      >
        <ChevronDown className="size-3.5" />
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon-xs"
        className="shrink-0 text-dls-secondary hover:text-dls-text"
        onClick={props.onClose}
        title={t("session.conversation_history_search_clear")}
        aria-label={t("session.conversation_history_search_clear")}
      >
        <X className="size-3.5" />
      </Button>
    </div>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon-xs"
      className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
      onMouseDown={(event) => {
        event.preventDefault();
        event.stopPropagation();
      }}
      onClick={(event) => {
        event.stopPropagation();
        props.onOpen(event);
      }}
      title={t("session.conversation_history_search_tooltip", {
        shortcut: props.shortcutLabel,
      })}
      aria-label={t("session.conversation_history_search_tooltip", {
        shortcut: props.shortcutLabel,
      })}
    >
      <Search className="size-3.5" />
    </Button>
  );

  return (
    <div className="flex items-center gap-1 text-dls-secondary mac:titlebar-no-drag">
      {searchControl}
      {props.historyPopover}
      {!props.sidePanelOpen ? (
        <Button
          data-code-side-panel-toggle="true"
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
          onMouseDown={(event) => event.preventDefault()}
          onClick={(event) => {
            event.stopPropagation();
            props.onToggleSidePanel(event);
          }}
          title={t("session.code_side_panel_toggle")}
          aria-label={t("session.code_side_panel_toggle")}
          aria-expanded={props.sidePanelOpen}
        >
          <PanelRight className="size-3.5" />
        </Button>
      ) : null}
    </div>
  );
}
