/**
 * Transcript in-conversation search helpers for SessionSurface.
 */
import { useEffect, useMemo, useRef } from "react";
import type { UIMessage } from "ai";

import { findTranscriptSearchMatchIds } from "./session-surface-model";

export function deriveTranscriptSearchState(input: {
  messages: UIMessage[];
  searchQuery: string;
  activeMatchIndex?: number;
}) {
  const searchQuery = input.searchQuery.trim();
  const searchMatchIds = findTranscriptSearchMatchIds(
    input.messages,
    searchQuery,
  );
  const searchMatchIdSet: Set<string> = new Set(searchMatchIds);
  const activeSearchMessageId =
    searchQuery && searchMatchIds.length > 0
      ? searchMatchIds[
          ((input.activeMatchIndex ?? 0) % searchMatchIds.length +
            searchMatchIds.length) %
            searchMatchIds.length
        ] ?? null
      : null;
  return {
    searchQuery,
    searchMatchIds,
    searchMatchIdSet,
    activeSearchMessageId,
  };
}

export function useSessionSurfaceSearch(input: {
  messages: UIMessage[];
  searchQuery?: string;
  activeMatchIndex?: number;
  onSearchMatchCountChange?: (count: number) => void;
  scrollToMessageById?: (
    messageId: string,
    behavior?: ScrollBehavior,
  ) => boolean;
}) {
  const search = useMemo(
    () =>
      deriveTranscriptSearchState({
        messages: input.messages,
        searchQuery: input.searchQuery ?? "",
        activeMatchIndex: input.activeMatchIndex,
      }),
    [input.messages, input.searchQuery, input.activeMatchIndex],
  );

  useEffect(() => {
    input.onSearchMatchCountChange?.(search.searchMatchIds.length);
  }, [input.onSearchMatchCountChange, search.searchMatchIds.length]);

  const scrollRef = useRef(input.scrollToMessageById);
  scrollRef.current = input.scrollToMessageById;

  useEffect(() => {
    if (!search.activeSearchMessageId) return;
    const scroll = scrollRef.current;
    if (!scroll) return;
    window.requestAnimationFrame(() => {
      scroll(search.activeSearchMessageId!, "smooth");
    });
  }, [search.activeSearchMessageId, search.searchQuery]);

  return search;
}
