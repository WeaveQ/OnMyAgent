/** @jsxImportSource react */
import { BookOpenCheck, Code2 } from "lucide-react";

import { t } from "../../../../../i18n";
import { cn } from "@/lib/utils";
import type { AssistantCategoryId } from "../personal-assistant-config";

export function AssistantDraftHomeMark(props: { categoryId: AssistantCategoryId }) {
  const Icon = props.categoryId === "code" ? Code2 : BookOpenCheck;

  return (
    <span className="inline-flex size-6 shrink-0 items-center justify-center text-current">
      <Icon className="size-6" strokeWidth={1.7} />
    </span>
  );
}


/**
 * Lightweight avatar rendered in the "+新任务" welcome card and alongside
 * every assistant message when the session was started from a custom
 * agent card. Expects the fully-resolved image URL (local DiceBear data
 * URI or custom upload) so it never has to depend on the `AgentRegistry` tree; falls
 * back to a colored initial badge only when the URL can't be resolved.
 */
const AGENT_AVATAR_PALETTES = [
  { background: "#d7ecf8", foreground: "#16324f" },
  { background: "#e1e2f0", foreground: "#42475f" },
  { background: "#ffe1c7", foreground: "#6d3b1f" },
  { background: "#cceaf5", foreground: "#174767" },
  { background: "#ddefc8", foreground: "#355a18" },
] as const;

export function PendingAgentAvatar(props: {
  name: string;
  avatarUrl: string | null;
  avatarBackground?: string | null;
  className?: string;
}) {
  if (!props.avatarUrl) {
    // Pick a palette that matches the agent name so siblings don't twin.
    const index =
      Math.abs(
        Array.from(props.name).reduce(
          (acc, ch) => acc * 31 + ch.charCodeAt(0),
          0,
        ),
      ) % AGENT_AVATAR_PALETTES.length;
    const palette = AGENT_AVATAR_PALETTES[index]!;
    return (
      <div
        className={cn(
          "flex items-center justify-center rounded-full font-medium",
          props.className,
        )}
        style={{ background: palette.background, color: palette.foreground }}
      >
        {props.name.slice(0, 1) || t("session.agent_initial")}
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex items-center justify-center overflow-hidden rounded-full",
        props.className,
      )}
      style={
        props.avatarBackground
          ? { background: props.avatarBackground }
          : undefined
      }
    >
      <img
        src={props.avatarUrl}
        alt={props.name}
        className="size-full rounded-full object-cover"
      />
    </div>
  );
}

