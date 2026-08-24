/** @jsxImportSource react */
import { useState } from "react";
import { ChevronDown } from "lucide-react";

import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import type { ConversationItemVM } from "../../../capabilities/conversation";
import { MarkdownBlock } from "../../../capabilities/artifacts/markdown";

/** Local Agent reasoning rendered with the same process-fold grammar as Expert/Assistant. */
export function LocalAgentThinkingFold(props: {
  item: ConversationItemVM;
  streaming?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const text = props.item.text.trim();
  if (!text) return null;

  return (
    <section
      className={cn(
        "session-workbuddy-process-fold is-thinking",
        expanded && "is-expanded",
      )}
      data-kind="thinking"
      data-testid="conversation-thinking-block"
    >
      <button
        type="button"
        className="session-workbuddy-process-head session-workbuddy-process-head-thinking focus-visible:ring-1 focus-visible:ring-dls-focus focus-visible:ring-offset-0"
        aria-expanded={expanded}
        onClick={() => setExpanded((value) => !value)}
        data-testid="conversation-thinking-header"
      >
        <span
          className={cn(props.streaming && "session-transcript-loading-shimmer")}
          data-testid="conversation-thinking-status"
        >
          {t("session.process_summary_deep_thinking")}
        </span>
        <ChevronDown aria-hidden="true" className="session-workbuddy-process-arrow" />
      </button>
      {expanded ? (
        <div
          className="session-workbuddy-process-body"
          data-testid="conversation-thinking-body"
          data-scrollable="true"
        >
          <MarkdownBlock
            text={text}
            streaming={Boolean(props.streaming)}
            showStreamingCursor={false}
            locale={currentLocale()}
          />
        </div>
      ) : null}
    </section>
  );
}
