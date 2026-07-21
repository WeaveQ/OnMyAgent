/** @jsxImportSource react */
/**
 * Expert empty chat: avatar + capability copy + prompt suggestions.
 */
import type { ReactNode } from "react";
import { PendingAgentAvatar } from "./avatars";
import { sessionSurfaceTextClass } from "../surface-styles";

export function SessionSurfaceExpertEmpty(props: {
  agent: {
    name: string;
    description?: string | null;
    avatar: { avatarUrl: string | null; avatarBackground?: string | null };
  };
  promptSuggestions: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-6 overflow-y-auto px-5 py-6">
      <div className="flex shrink-0 flex-col items-center gap-2">
        <PendingAgentAvatar
          name={props.agent.name}
          avatarUrl={props.agent.avatar.avatarUrl}
          avatarBackground={props.agent.avatar.avatarBackground ?? undefined}
          className="size-16 text-3xl"
        />
        <h2 className={sessionSurfaceTextClass.agentEmptyTitle}>{props.agent.name}</h2>
        {props.agent.description ? (
          <p className={sessionSurfaceTextClass.agentEmptyDescription}>
            {props.agent.description}
          </p>
        ) : null}
      </div>
      {props.promptSuggestions}
    </div>
  );
}
