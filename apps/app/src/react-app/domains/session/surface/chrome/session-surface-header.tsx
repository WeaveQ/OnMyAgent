/** @jsxImportSource react */
/**
 * Session surface top header (agent name + toolbar actions).
 */
import type { ReactNode } from "react";
import { Settings2 } from "lucide-react";

import { t } from "../../../../../i18n";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { PendingAgentAvatar } from "./avatars";
import { sessionSurfaceTextClass } from "../surface-styles";

export type SessionSurfaceHeaderAgent = {
  name: string;
  avatarUrl: string | null;
  avatarBackground: string | null | undefined;
};

export function SessionSurfaceHeader(props: {
  agent: SessionSurfaceHeaderAgent;
  codeSceneToolbar: ReactNode;
  personalAssistantHome?: boolean;
  onOpenAgentSettings?: () => void;
  headerActions?: ReactNode;
  /**
   * Bottom rule under the title row. Hide when the session-tab strip is
   * expanded (tabs own the single divider) to avoid double lines.
   */
  showBottomBorder?: boolean;
}) {
  const showBottomBorder = props.showBottomBorder !== false;
  return (
    <header
      className={cn(
        "flex h-12 shrink-0 items-center justify-between bg-dls-background px-5",
        // Align with side-panel header when this is the only chrome rule.
        showBottomBorder && "border-b border-dls-mist",
      )}
    >
      <div className="flex min-w-0 items-center gap-2.5">
        <PendingAgentAvatar
          name={props.agent.name}
          avatarUrl={props.agent.avatarUrl}
          avatarBackground={props.agent.avatarBackground ?? undefined}
          className="size-7 text-xs"
        />
        <div className={sessionSurfaceTextClass.headerAgentName}>
          {props.agent.name}
        </div>
      </div>
      <div className="relative flex items-center gap-1.5 mac:titlebar-no-drag">
        {props.codeSceneToolbar}
        {!props.personalAssistantHome && props.onOpenAgentSettings ? (
          <Button
            variant="ghost"
            size="icon-sm"
            type="button"
            className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text"
            title={t("session.configure_current_agent")}
            aria-label={t("session.configure_current_agent")}
            onClick={props.onOpenAgentSettings}
          >
            <Settings2 className="size-4" />
          </Button>
        ) : null}
        {props.headerActions}
      </div>
    </header>
  );
}
