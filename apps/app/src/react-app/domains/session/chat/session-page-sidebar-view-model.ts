import {
  Bot,
  ChartNoAxesColumn,
  Clock3,
  HardDrive,
  MessagesSquare,
  MonitorSmartphone,
  Plug,
  Sparkles,
  type LucideIcon,
} from "lucide-react";

import { t } from "../../../../i18n";
import type { SidebarPrimaryView } from "../sidebar/app-sidebar";

export type OnMyAgentPrimaryView =
  | SidebarPrimaryView
  | "files"
  | "store"
  | "company"
  | "projects"
  | "localAgent";

export type SidebarFeatureView = Exclude<
  OnMyAgentPrimaryView,
  "chat" | "files" | "store" | "company" | "projects"
>;

export const SIDEBAR_VIEW_LABELS: Record<SidebarFeatureView, string> = {
  get billing() { return t("nav.billing"); },
  get usage() { return t("nav.usage"); },
  get agents() { return t("nav.agents"); },
  get skills() { return t("nav.skills"); },
  get connectors() { return t("nav.connectors"); },
  get devices() { return t("nav.devices"); },
  get scheduledTasks() { return t("nav.scheduled_tasks"); },
  get channels() { return t("nav.channels"); },
  get personalAssistant() { return t("nav.assistant"); },
  get localAgent() { return t("nav.local_agent"); },
};

export const SIDEBAR_VIEW_ICONS: Record<SidebarFeatureView, LucideIcon> = {
  billing: Sparkles,
  usage: ChartNoAxesColumn,
  agents: Bot,
  // Skills — capability/magic, not a document.
  skills: Sparkles,
  // Connectors / MCP — plug into tools, not keys or lightning.
  connectors: Plug,
  // Distinct from localAgent (MonitorSmartphone) — devices = storage/device rack.
  devices: HardDrive,
  scheduledTasks: Clock3,
  // Messaging channels — chat bubbles, not network topology.
  channels: MessagesSquare,
  personalAssistant: Sparkles,
  localAgent: MonitorSmartphone,
};
