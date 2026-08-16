/** @jsxImportSource react */
import { ArrowUpRight } from "lucide-react";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export function FollowUpSuggestionChips(props: {
  suggestions: string[];
  onSelect: (prompt: string) => void;
  className?: string;
}) {
  if (props.suggestions.length === 0) return null;

  return (
    <div
      className={cn(
        "session-follow-up-suggestions flex max-w-3xl flex-col items-start gap-2 px-0 pt-2 pb-2",
        props.className,
      )}
      data-follow-up-suggestions="true"
      role="group"
      aria-label={t("session.try_ask_expert")}
    >
      <div className="text-xs font-medium leading-4 text-dls-secondary">
        {t("session.try_ask_expert")}
      </div>
      <div className="flex max-w-full flex-row flex-wrap items-center gap-2">
        {props.suggestions.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            className={cn(
              "mac:titlebar-no-drag group inline-flex max-w-full shrink-0 cursor-pointer items-center gap-1.5 rounded-lg",
              "border border-dls-border bg-dls-surface-muted px-3 py-1.5 text-left text-sm leading-5 text-dls-text",
              " transition-colors duration-150",
              "hover:border-dls-secondary hover:bg-dls-hover hover:text-dls-text",
              "active:bg-dls-hover active:border-dls-secondary",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
            )}
            onClick={() => props.onSelect(suggestion)}
          >
            <span className="line-clamp-1 min-w-0 max-w-[14rem] truncate sm:max-w-[16rem]">
              {suggestion}
            </span>
            <ArrowUpRight
              className="size-3.5 shrink-0 text-dls-secondary transition-colors group-hover:text-dls-text"
              aria-hidden
            />
          </button>
        ))}
      </div>
    </div>
  );
}
