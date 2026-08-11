import { useEffect, useMemo, useState } from "react";
import type { SidebarSessionItem } from "../../../../app/types";
import { mergeStableSessionTabOrder } from "../sidebar/session-chrome";

export type ExpertSessionTabOrderState = {
  sessionTabOrderIdsByScope: Record<string, string[]>;
  sessionTabOrderScope: string;
  sessionTabOrderIds: string[];
};

export function useExpertSessionTabOrder(input: {
  workspaceId: string;
  agentId: string | null;
  sessions: SidebarSessionItem[];
}): ExpertSessionTabOrderState {
  const [sessionTabOrderIdsByScope, setSessionTabOrderIdsByScope] = useState<
    Record<string, string[]>
  >({});
  const sessionTabOrderScope = [
    input.workspaceId,
    input.agentId ?? "unbound",
  ].join(":");
  const sessionTabOrderIds = useMemo(
    () =>
      mergeStableSessionTabOrder(
        sessionTabOrderIdsByScope[sessionTabOrderScope] ?? [],
        input.sessions,
      ),
    [input.sessions, sessionTabOrderIdsByScope, sessionTabOrderScope],
  );

  useEffect(() => {
    setSessionTabOrderIdsByScope((current) => {
      const previous = current[sessionTabOrderScope] ?? [];
      if (
        previous.length === sessionTabOrderIds.length &&
        previous.every((id, index) => id === sessionTabOrderIds[index])
      ) {
        return current;
      }
      return {
        ...current,
        [sessionTabOrderScope]: sessionTabOrderIds,
      };
    });
  }, [sessionTabOrderIds, sessionTabOrderScope]);

  return {
    sessionTabOrderIdsByScope,
    sessionTabOrderScope,
    sessionTabOrderIds,
  };
}
