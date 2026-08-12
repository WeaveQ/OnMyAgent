/** @jsxImportSource react */
import { AssistantPage } from "./assistant";
import { ExpertPage } from "./expert";
import { SessionPageErrorBoundary } from "./session-page-error-boundary";
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
      <SessionPageErrorBoundary mode="assistant" key="assistant">
        <AssistantPage
          {...props}
          onNavigateToMode={props.onNavigateToMode}
        />
      </SessionPageErrorBoundary>
    );
  }
  return (
    <SessionPageErrorBoundary mode="expert" key="expert">
      <ExpertPage
        {...props}
        onNavigateToMode={props.onNavigateToMode}
      />
    </SessionPageErrorBoundary>
  );
}
