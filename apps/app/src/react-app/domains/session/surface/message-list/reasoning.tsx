/** @jsxImportSource react */
import { useEffect, useRef, useState, type UIEvent } from "react";
import { ChevronDown } from "lucide-react";

import { DisclosureRowButton } from "@/components/ui/action-row";
import { MessageRolePrefix, MessageRoleRow } from "@/components/ui/message-role";
import { currentLocale, t } from "@/i18n";
import { cn } from "@/lib/utils";
import { MarkdownBlock } from "../markdown";

export function TranscriptReasoning(props: {
  text: string;
  complete: boolean;
}) {
  const [collapsed, setCollapsed] = useState(true);
  const contentRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  const trustedScrollRef = useRef(false);
  const lastScrollTopRef = useRef(0);

  useEffect(() => {
    const content = contentRef.current;
    if (!content || collapsed || props.complete || !autoScrollRef.current) return;
    const nextScrollTop = Math.max(0, content.scrollHeight - content.clientHeight);
    if (Math.abs(content.scrollTop - nextScrollTop) <= 1) {
      trustedScrollRef.current = false;
      lastScrollTopRef.current = content.scrollTop;
      return;
    }
    trustedScrollRef.current = true;
    content.scrollTo({ top: nextScrollTop, behavior: "auto" });
  }, [collapsed, props.complete, props.text]);

  const handleScroll = (event: UIEvent<HTMLDivElement>) => {
    const target = event.currentTarget;
    const currentScrollTop = target.scrollTop;
    const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
    if (trustedScrollRef.current) {
      trustedScrollRef.current = false;
      lastScrollTopRef.current = currentScrollTop;
      return;
    }
    const scrollingUp = currentScrollTop < lastScrollTopRef.current;
    if (!scrollingUp && Math.abs(distanceFromBottom) < 10) {
      autoScrollRef.current = true;
    } else if (scrollingUp && distanceFromBottom > 20) {
      autoScrollRef.current = false;
    }
    lastScrollTopRef.current = currentScrollTop;
  };

  return (
    <section
      data-reasoning="true"
      data-reasoning-state={props.complete ? "complete" : "streaming"}
      className="flex max-w-[760px] flex-col gap-0.5 py-0.5 text-dls-secondary"
    >
      <DisclosureRowButton
        type="button"
        density="flush"
        aria-expanded={!collapsed}
        className="gap-1 text-sm leading-6 text-dls-secondary hover:bg-transparent hover:text-dls-text"
        onClick={() => setCollapsed((current) => !current)}
      >
        <MessageRolePrefix role="thinking" />
        <span className={cn(!props.complete && "session-transcript-loading-shimmer")}>
          {t("session.reasoning")}
        </span>
        {props.complete ? (
          <ChevronDown
            size={12}
            className={cn(
              "transition-transform",
              collapsed && "-rotate-90 opacity-0 group-hover:opacity-100",
            )}
          />
        ) : null}
      </DisclosureRowButton>
      <MessageRoleRow
        role="thinking"
        ref={contentRef}
        hidden={collapsed}
        data-scrollable="true"
        onScroll={handleScroll}
        className="max-h-[200px] overflow-x-hidden overflow-y-auto rounded-none bg-transparent py-0.5 pl-3 pr-1 text-dls-text not-italic"
      >
        <MarkdownBlock
          text={props.text}
          streaming={!props.complete}
          showStreamingCursor={false}
          locale={currentLocale()}
        />
      </MessageRoleRow>
    </section>
  );
}
