/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronUp,
  History,
  MessageSquareText,
  PanelRightClose,
  Search,
  X,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyStateBox } from "@/components/ui/notice-box";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type {
  OnMyAgentServerClient,
  OnMyAgentSessionMessage,
} from "../../../../app/lib/onmyagent-server";
import { t } from "../../../../i18n";
import { formatConversationTime } from "./conversation-model";

export type ConversationHistoryEntry = {
  id: string;
  text: string;
  createdAt: number | null;
};

function partText(part: OnMyAgentSessionMessage["parts"][number]): string {
  if (part.type === "text" && !part.synthetic && !part.ignored) {
    return part.text.trim();
  }
  return "";
}

export function extractUserHistoryEntries(
  messages: OnMyAgentSessionMessage[] | undefined,
): ConversationHistoryEntry[] {
  if (!messages?.length) return [];
  const out: ConversationHistoryEntry[] = [];
  for (const message of messages) {
    if (message.info.role !== "user") continue;
    const text = message.parts
      .map(partText)
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    if (!text) continue;
    const completed =
      "completed" in message.info.time ? message.info.time.completed : null;
    const created = message.info.time?.created ?? null;
    out.push({
      id: message.info.id,
      text,
      createdAt:
        typeof completed === "number"
          ? completed
          : typeof created === "number"
            ? created
            : null,
    });
  }
  // Newest first for quick resend of recent asks.
  return out.reverse();
}

/** Split text into segments for mark highlighting (case-insensitive). */
export function splitHighlightSegments(
  text: string,
  query: string,
): Array<{ text: string; match: boolean }> {
  const q = query.trim();
  if (!q) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const needle = q.toLowerCase();
  const segments: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < text.length) {
    const idx = lower.indexOf(needle, cursor);
    if (idx < 0) {
      segments.push({ text: text.slice(cursor), match: false });
      break;
    }
    if (idx > cursor) {
      segments.push({ text: text.slice(cursor, idx), match: false });
    }
    segments.push({ text: text.slice(idx, idx + needle.length), match: true });
    cursor = idx + needle.length;
  }
  return segments.length ? segments : [{ text, match: false }];
}

function HighlightedText(props: { text: string; query: string }) {
  const segments = splitHighlightSegments(props.text, props.query);
  return (
    <>
      {segments.map((seg, index) =>
        seg.match ? (
          <mark
            key={`${index}-${seg.text}`}
            className="rounded-sm bg-emerald-200/90 px-0.5 text-dls-text dark:bg-emerald-500/35"
          >
            {seg.text}
          </mark>
        ) : (
          <span key={`${index}-${seg.text.slice(0, 8)}`}>{seg.text}</span>
        ),
      )}
    </>
  );
}

export function ConversationHistoryPanel(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  sessionId: string | null;
  onClose: () => void;
  onSelectPrompt?: (text: string, messageId: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<Map<string, HTMLButtonElement>>(new Map());

  const snapshotQuery = useQuery({
    queryKey: [
      "conversation-history-snapshot",
      props.workspaceId,
      props.sessionId,
    ],
    enabled: Boolean(props.client && props.workspaceId && props.sessionId),
    queryFn: async () => {
      const client = props.client;
      const sessionId = props.sessionId;
      if (!client || !sessionId) throw new Error("unavailable");
      return (
        await client.getSessionSnapshot(props.workspaceId, sessionId, {
          limit: 200,
        })
      ).item;
    },
    staleTime: 3_000,
    refetchInterval: 8_000,
  });

  const entries = useMemo(
    () => extractUserHistoryEntries(snapshotQuery.data?.messages),
    [snapshotQuery.data?.messages],
  );

  const trimmedQuery = query.trim();
  const filtered = useMemo(() => {
    if (!trimmedQuery) return entries;
    const needle = trimmedQuery.toLowerCase();
    return entries.filter((entry) => entry.text.toLowerCase().includes(needle));
  }, [entries, trimmedQuery]);

  // Reset active match when filter set changes.
  useEffect(() => {
    setActiveMatch(0);
  }, [trimmedQuery, props.sessionId, filtered.length]);

  useEffect(() => {
    if (!filtered.length) return;
    const entry = filtered[activeMatch];
    if (!entry) return;
    itemRefs.current.get(entry.id)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [activeMatch, filtered]);

  const goPrev = () => {
    if (!filtered.length) return;
    setActiveMatch((i) => (i - 1 + filtered.length) % filtered.length);
  };
  const goNext = () => {
    if (!filtered.length) return;
    setActiveMatch((i) => (i + 1) % filtered.length);
  };

  const clearSearch = () => {
    setQuery("");
    setActiveMatch(0);
    searchInputRef.current?.focus();
  };

  const matchLabel =
    trimmedQuery && filtered.length > 0
      ? `${activeMatch + 1}/${filtered.length}`
      : trimmedQuery
        ? "0/0"
        : "";

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-surface-solid">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-dls-border px-3">
        <History className="size-4 text-dls-secondary" aria-hidden />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-medium text-dls-text">
            {t("session.conversation_history_title")}
            {entries.length > 0 ? (
              <span className="ms-1 font-normal text-dls-secondary">
                ({entries.length})
              </span>
            ) : null}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          className="text-dls-secondary hover:text-dls-text"
          onClick={props.onClose}
          title={t("session.conversation_history_close")}
          aria-label={t("session.conversation_history_close")}
        >
          <PanelRightClose className="size-3.5" />
        </Button>
      </div>

      {/* Find bar — mirrors in-chat search chrome (query + n/m + prev/next + clear). */}
      <div className="shrink-0 border-b border-dls-border px-2 py-2">
        <div
          className={cn(
            "flex h-9 items-center gap-1 rounded-full border border-dls-border",
            "bg-dls-surface-muted/60 px-2.5",
            "focus-within:border-dls-accent/40 focus-within:bg-dls-surface-solid",
          )}
        >
          <Search className="size-3.5 shrink-0 text-dls-secondary" aria-hidden />
          <input
            ref={searchInputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                if (event.shiftKey) goPrev();
                else goNext();
              } else if (event.key === "Escape") {
                event.preventDefault();
                if (query) clearSearch();
              }
            }}
            placeholder={t("session.conversation_history_search_placeholder")}
            className="min-w-0 flex-1 bg-transparent text-sm text-dls-text outline-none placeholder:text-dls-secondary/70"
            aria-label={t("session.conversation_history_search_placeholder")}
          />
          {matchLabel ? (
            <span className="shrink-0 tabular-nums text-xs text-dls-secondary">
              {matchLabel}
            </span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className="shrink-0 text-dls-secondary hover:text-dls-text"
            onClick={goPrev}
            disabled={!filtered.length || !trimmedQuery}
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
            onClick={goNext}
            disabled={!filtered.length || !trimmedQuery}
            title={t("session.conversation_history_search_next")}
            aria-label={t("session.conversation_history_search_next")}
          >
            <ChevronDown className="size-3.5" />
          </Button>
          {query ? (
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              className="shrink-0 text-dls-secondary hover:text-dls-text"
              onClick={clearSearch}
              title={t("session.conversation_history_search_clear")}
              aria-label={t("session.conversation_history_search_clear")}
            >
              <X className="size-3.5" />
            </Button>
          ) : null}
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 p-2">
          {!props.sessionId ? (
            <div className="px-2 py-8">
              <EmptyStateBox size="comfortable" tone="muted" className="text-sm">
                {t("session.conversation_history_no_session")}
              </EmptyStateBox>
            </div>
          ) : snapshotQuery.isLoading ? (
            <div className="px-3 py-6 text-sm text-dls-secondary">
              {t("session.conversation_history_loading")}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-2 py-8">
              <EmptyStateBox size="comfortable" tone="muted" className="text-sm">
                {t("session.conversation_history_empty")}
              </EmptyStateBox>
            </div>
          ) : filtered.length === 0 ? (
            <div className="px-2 py-8">
              <EmptyStateBox size="comfortable" tone="muted" className="text-sm">
                {t("session.conversation_history_search_empty")}
              </EmptyStateBox>
            </div>
          ) : (
            filtered.map((entry, index) => {
              const timeLabel = formatConversationTime(entry.createdAt);
              const isActive = trimmedQuery.length > 0 && index === activeMatch;
              return (
                <button
                  key={entry.id}
                  ref={(node) => {
                    if (node) itemRefs.current.set(entry.id, node);
                    else itemRefs.current.delete(entry.id);
                  }}
                  type="button"
                  onClick={() => props.onSelectPrompt?.(entry.text, entry.id)}
                  className={cn(
                    "group flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors",
                    "hover:bg-dls-list-hover",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
                    isActive && "bg-dls-list-selected ring-1 ring-dls-border",
                  )}
                  title={entry.text}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-dls-secondary opacity-70" />
                    <span className="min-w-0 flex-1 text-sm leading-5 text-dls-text line-clamp-3">
                      {trimmedQuery ? (
                        <HighlightedText text={entry.text} query={trimmedQuery} />
                      ) : (
                        entry.text
                      )}
                    </span>
                  </div>
                  {timeLabel ? (
                    <span className="ps-5 text-xs text-dls-secondary">
                      {timeLabel}
                    </span>
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
