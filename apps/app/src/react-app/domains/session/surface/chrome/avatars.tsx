/** @jsxImportSource react */
import { BookOpenCheck } from "lucide-react";

import { t } from "../../../../../i18n";
import { cn } from "@/lib/utils";
import type { AssistantCategoryId } from "../personal-assistant-config";

function AssistantCodeDraftHomeIcon(props: {
  className?: string;
  strokeWidth?: number;
}) {
  return (
    <svg
      viewBox="0 0 36 36"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        d="M19.649 5.39976C19.8701 4.51583 20.766 3.97857 21.65 4.19957C22.5339 4.42066 23.0712 5.31654 22.8502 6.20054L16.3502 32.2005C16.1291 33.0845 15.2332 33.6217 14.3492 33.4007C13.4653 33.1796 12.928 32.2837 13.149 31.3998L19.649 5.39976ZM7.15389 11.0668C7.83499 10.4617 8.87769 10.5235 9.48299 11.2044C10.0881 11.8855 10.0271 12.9282 9.34627 13.5336L6.13241 16.39C4.68932 17.6729 4.68937 19.9274 6.13241 21.2103L9.34627 24.0668C10.0271 24.6721 10.088 25.7148 9.48299 26.3959C8.87768 27.0769 7.835 27.1387 7.15389 26.5336L3.94002 23.6771C1.02 21.0815 1.01999 16.5188 3.94002 13.9232L7.15389 11.0668ZM26.5162 11.2044C27.1216 10.5234 28.1652 10.4613 28.8463 11.0668L32.0592 13.9232C34.8878 16.4376 34.9765 20.7982 32.3248 23.4281L32.0592 23.6771L28.8463 26.5336C28.1652 27.139 27.1216 27.077 26.5162 26.3959C25.9111 25.7147 25.9729 24.672 26.6539 24.0668L29.8668 21.2103C31.3098 19.9274 31.3099 17.6729 29.8668 16.39L26.6539 13.5336C25.9729 12.9282 25.9111 11.8855 26.5162 11.2044Z"
        fill="currentColor"
      />
    </svg>
  );
}

export function AssistantDraftHomeMark(props: { categoryId: AssistantCategoryId }) {
  const Icon =
    props.categoryId === "code" ? AssistantCodeDraftHomeIcon : BookOpenCheck;

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
