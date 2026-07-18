/** @jsxImportSource react */
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, PanelRightClose, MessageSquareText } from "lucide-react";

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

export function ConversationHistoryPanel(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  sessionId: string | null;
  onClose: () => void;
  onSelectPrompt?: (text: string, messageId: string) => void;
}) {
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
          ) : (
            entries.map((entry) => {
              const timeLabel = formatConversationTime(entry.createdAt);
              return (
                <button
                  key={entry.id}
                  type="button"
                  onClick={() => props.onSelectPrompt?.(entry.text, entry.id)}
                  className={cn(
                    "group flex w-full flex-col gap-1 rounded-xl px-3 py-2.5 text-left transition-colors",
                    "hover:bg-dls-list-hover",
                    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-dls-accent/30",
                  )}
                  title={entry.text}
                >
                  <div className="flex items-start gap-2">
                    <MessageSquareText className="mt-0.5 size-3.5 shrink-0 text-dls-secondary opacity-70" />
                    <span className="min-w-0 flex-1 text-sm leading-5 text-dls-text line-clamp-3">
                      {entry.text}
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
