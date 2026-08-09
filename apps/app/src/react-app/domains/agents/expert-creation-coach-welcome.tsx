/** @jsxImportSource react */

import { t } from "@/i18n";
import { cn } from "@/lib/utils";

export type ExpertCreationCoachWelcomeProps = {
  /** When set, option chips send a quick reply (typically "1"…"4"). */
  onPickOption?: (reply: string) => void;
  className?: string;
};

const COACH_OPTION_KEYS = [
  "agents.expert_creation_coach_option_1",
  "agents.expert_creation_coach_option_2",
  "agents.expert_creation_coach_option_3",
  "agents.expert_creation_coach_option_4",
] as const;

/**
 * Empty-state welcome for the expert-creation coach panel.
 * Structured hierarchy + optional one-tap starter chips (vs plain numbered list).
 */
export function ExpertCreationCoachWelcome(
  props: ExpertCreationCoachWelcomeProps,
) {
  const options = COACH_OPTION_KEYS.map((key, index) => ({
    reply: String(index + 1),
    label: t(key),
  }));

  return (
    <div
      className={cn(
        "space-y-4 px-1 pt-1 text-sm leading-6 text-dls-text",
        props.className,
      )}
    >
      <div className="space-y-2">
        <p className="text-base font-semibold leading-6 text-dls-text">
          {t("agents.expert_creation_coach_greeting")}
        </p>
        <p className="text-sm leading-6 text-dls-secondary">
          {t("agents.expert_creation_coach_intro")}
        </p>
      </div>

      <div className="space-y-2.5">
        <p className="text-sm font-medium leading-6 text-dls-text">
          {t("agents.expert_creation_coach_question")}
        </p>
        <div className="grid gap-2" role="list">
          {options.map((option) => {
            const content = (
              <>
                <span
                  className={cn(
                    "inline-flex size-7 shrink-0 items-center justify-center rounded-lg",
                    "bg-dls-surface-muted text-xs font-semibold tabular-nums text-dls-text",
                  )}
                  aria-hidden
                >
                  {option.reply}
                </span>
                <span className="min-w-0 flex-1 text-sm leading-5 text-dls-text">
                  {option.label}
                </span>
              </>
            );
            const chipClass = cn(
              "flex w-full items-center gap-3 rounded-xl border border-dls-border/70",
              "bg-dls-surface-muted/40 px-3 py-2.5 text-left transition-colors",
              props.onPickOption
                ? "cursor-pointer hover:border-dls-border-strong hover:bg-dls-list-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30"
                : "cursor-default",
            );
            if (props.onPickOption) {
              return (
                <button
                  key={option.reply}
                  type="button"
                  role="listitem"
                  className={chipClass}
                  onClick={() => props.onPickOption?.(option.reply)}
                >
                  {content}
                </button>
              );
            }
            return (
              <div key={option.reply} role="listitem" className={chipClass}>
                {content}
              </div>
            );
          })}
        </div>
        <p className="text-xs leading-5 text-dls-secondary">
          {t("agents.expert_creation_coach_reply_hint")}
        </p>
      </div>
    </div>
  );
}
