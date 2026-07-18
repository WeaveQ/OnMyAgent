/** @jsxImportSource react */
/**
 * Header "历史提问" popover — floats under the clock icon (not a right rail).
 * Uses portal Popover so it is not clipped by session overflow containers.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Clock3 } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { OnMyAgentServerClient } from "../../../../app/lib/onmyagent-server";
import { t } from "../../../../i18n";
import {
  extractUserHistoryEntries,
  type ConversationHistoryEntry,
} from "./conversation-history-panel";

export function ConversationHistoryPopover(props: {
  client: OnMyAgentServerClient | null;
  workspaceId: string;
  sessionId: string | null;
  onSelectPrompt?: (text: string, messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  const snapshotQuery = useQuery({
    queryKey: [
      "conversation-history-popover",
      props.workspaceId,
      props.sessionId,
    ],
    enabled: Boolean(
      open && props.client && props.workspaceId && props.sessionId,
    ),
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
  });

  const entries = useMemo(
    () => extractUserHistoryEntries(snapshotQuery.data?.messages),
    [snapshotQuery.data?.messages],
  );

  useEffect(() => {
    setOpen(false);
  }, [props.sessionId]);

  const selectEntry = (entry: ConversationHistoryEntry) => {
    props.onSelectPrompt?.(entry.text, entry.id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        render={
          <Button
            type="button"
            variant="ghost"
            size="icon-xs"
            className={cn(
              "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
              open && "bg-dls-hover text-dls-text",
            )}
            title={t("session.conversation_history_toggle")}
            aria-label={t("session.conversation_history_toggle")}
          >
            <Clock3 className="size-3.5" />
          </Button>
        }
      />

      <PopoverContent
        align="end"
        side="bottom"
        sideOffset={8}
        className={cn(
          "z-[120] w-[min(22rem,calc(100vw-2rem))] gap-0 overflow-hidden rounded-2xl p-0",
          "border border-dls-border bg-dls-surface-solid text-dls-text shadow-lg",
        )}
        style={{
          backgroundColor: "var(--dls-surface-solid, #2c2c2c)",
        }}
      >
        <div className="flex items-center justify-between gap-2 border-b border-dls-border px-3.5 py-2.5">
          <div className="text-sm text-dls-secondary">
            {t("session.conversation_history_popover_heading")}
            {entries.length > 0 ? (
              <span className="ms-1">({entries.length})</span>
            ) : null}
          </div>
          <span className="shrink-0 rounded-lg border border-dls-border px-2 py-0.5 text-xs text-dls-text">
            {t("session.conversation_history_popover_badge")}
          </span>
        </div>

        <div className="max-h-72 overflow-y-auto py-1">
          {!props.sessionId ? (
            <div className="px-3.5 py-6 text-sm text-dls-secondary">
              {t("session.conversation_history_no_session")}
            </div>
          ) : snapshotQuery.isLoading ? (
            <div className="px-3.5 py-6 text-sm text-dls-secondary">
              {t("session.conversation_history_loading")}
            </div>
          ) : entries.length === 0 ? (
            <div className="px-3.5 py-6 text-sm text-dls-secondary">
              {t("session.conversation_history_empty")}
            </div>
          ) : (
            entries.map((entry) => (
              <button
                key={entry.id}
                type="button"
                onClick={() => selectEntry(entry)}
                className={cn(
                  "flex w-full px-3.5 py-2.5 text-left text-sm leading-5 text-dls-text",
                  "transition-colors hover:bg-dls-list-hover",
                  "focus-visible:outline-none focus-visible:bg-dls-list-hover",
                )}
                title={entry.text}
              >
                <span className="line-clamp-2">{entry.text}</span>
              </button>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
