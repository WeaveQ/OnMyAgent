/** Leaf sidebar view ids — provider imports these without cycling through app-sidebar. */

export type SidebarPrimaryView =
  | "chat"
  | "billing"
  | "usage"
  | "agents"
  | "skills"
  | "connectors"
  | "devices"
  | "scheduledTasks"
  | "channels"
  | "personalAssistant";

export type SidebarAccountInfo = {
  name: string;
  email?: string | null;
};
