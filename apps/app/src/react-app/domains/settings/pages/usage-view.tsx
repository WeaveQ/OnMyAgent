/** @jsxImportSource react */
/**
 * Global settings host for personal usage.
 * Reuses the session-domain PersonalUsagePage (cross-workspace metrics).
 */
import type { WorkspaceInfo } from "../../../../app/lib/desktop";
import { PersonalUsagePage, type PersonalUsageClient } from "../../session";

export type UsageSettingsViewProps = {
  client: PersonalUsageClient | null;
  workspaces: WorkspaceInfo[];
  identity: {
    name: string;
    email?: string | null;
  };
};

export function UsageSettingsView(props: UsageSettingsViewProps) {
  return (
    <PersonalUsagePage
      client={props.client}
      workspaces={props.workspaces}
      identity={props.identity}
    />
  );
}
