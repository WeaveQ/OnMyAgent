import {
  Bot,
  Clock3,
  FileText,
  MonitorSmartphone,
  Network,
  Sparkles,
  UserRound,
  Zap,
  type LucideIcon,
} from "lucide-react";

import { t } from "../../../../i18n";
import type { SidebarPrimaryView } from "../sidebar/app-sidebar";

export type OnMyAgentPrimaryView =
  | SidebarPrimaryView
  | "files"
  | "store"
  | "projects"
  | "localAgent";

export type SidebarFeatureView = Exclude<
  OnMyAgentPrimaryView,
  "chat" | "files" | "store" | "projects"
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
  usage: UserRound,
  agents: Bot,
  skills: FileText,
  connectors: Zap,
  devices: MonitorSmartphone,
  scheduledTasks: Clock3,
  channels: Network,
  personalAssistant: UserRound,
  localAgent: MonitorSmartphone,
};
