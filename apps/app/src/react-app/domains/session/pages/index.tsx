/** @jsxImportSource react */
import { AssistantPage } from "./assistant";
import { ExpertPage } from "./expert";
import type { SessionPageWithModeProps } from "./session-page-types";

export type {
  PageMode,
  SessionAgentManagementIntent,
  SessionPageHistoryControls,
  SessionPageProps,
  SessionPageSidebarProps,
  SessionPageSurfaceProps,
  SessionPageWithModeProps,
} from "./session-page-types";

export function SessionPage(props: SessionPageWithModeProps) {
  if (props.mode === "assistant") {
    return (
      <AssistantPage
        {...props}
        onNavigateToMode={props.onNavigateToMode}
      />
    );
  }
  return (
    <ExpertPage
      {...props}
      onNavigateToMode={props.onNavigateToMode}
    />
  );
}
