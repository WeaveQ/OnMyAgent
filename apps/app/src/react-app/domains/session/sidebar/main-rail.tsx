/** @jsxImportSource react */
import type { ComponentType } from "react";
import { MonitorSmartphone } from "lucide-react";

import { RailButton } from "@/components/ui/action-row";
import { t } from "../../../../i18n";
import {
  SidebarAccountButton,
  type SidebarAccountInfo,
  type SidebarPrimaryView,
} from "./app-sidebar";
import {
  AssistantRailIcon,
  ChannelsRailIcon,
  ExpertRailIcon,
  FilesRailIcon,
  LocalAgentRailIcon,
  ManageRailIcon,
  StoreRailIcon,
} from "./primary-rail-icons";

export type OnMyAgentPrimaryView =
  | SidebarPrimaryView
  | "assistant"
  | "files"
  | "store"
  | "projects"
  | "localAgent"
  | "agentManagement";

type RailItem = {
  id: OnMyAgentPrimaryView;
  label: string;
  shortLabel: string;
  icon: ComponentType<{ className?: string }>;
};

type BottomRailIcon = ComponentType<{ active?: boolean; className?: string }>;

type BottomRailItem = {
  id: OnMyAgentPrimaryView;
  label: string;
  icon: BottomRailIcon;
};

const TOP_RAIL_ITEMS: RailItem[] = [
  { id: "assistant", get label() { return t("nav.assistant"); }, get shortLabel() { return t("nav.assistant_short"); }, icon: AssistantRailIcon },
  { id: "chat", get label() { return t("nav.experts"); }, get shortLabel() { return t("nav.experts_short"); }, icon: ExpertRailIcon },
  { id: "localAgent", get label() { return t("nav.local_agent"); }, get shortLabel() { return t("nav.local_agent_short"); }, icon: LocalAgentRailIcon },
  { id: "files", get label() { return t("nav.files"); }, get shortLabel() { return t("nav.files_short"); }, icon: FilesRailIcon },
  { id: "store", get label() { return t("nav.store"); }, get shortLabel() { return t("nav.store_short"); }, icon: StoreRailIcon },
  { id: "agentManagement", get label() { return t("nav.management"); }, get shortLabel() { return t("nav.management_short"); }, icon: ManageRailIcon },
];

function DevicesRailIcon(props: { active?: boolean; className?: string }) {
  return <MonitorSmartphone className={props.className} aria-hidden="true" />;
}

const BOTTOM_RAIL_ITEMS: BottomRailItem[] = [
  {
    id: "channels",
    get label() { return t("nav.channels"); },
    icon: ChannelsRailIcon,
  },
  {
    id: "devices",
    get label() { return t("nav.devices"); },
    icon: DevicesRailIcon,
  },
];

function TopRailButton(props: {
  item: RailItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = props.item.icon;
  return (
    <RailButton
      type="button"
      onClick={props.onClick}
      data-view-id={props.item.id}
      active={props.active}
      title={props.item.label}
      aria-label={props.item.label}
      aria-pressed={props.active}
    >
      <Icon className="size-5" />
      <span className="w-full truncate text-center text-xs leading-none">{props.item.shortLabel}</span>
    </RailButton>
  );
}

function BottomRailButton(props: {
  item: BottomRailItem;
  active: boolean;
  onClick: () => void;
}) {
  const Icon = props.item.icon;
  return (
    <RailButton
      type="button"
      onClick={props.onClick}
      data-view-id={props.item.id}
      size="bottom"
      active={props.active}
      title={props.item.label}
      aria-label={props.item.label}
      aria-pressed={props.active}
    >
      <Icon active={props.active} className="size-5" />
    </RailButton>
  );
}

export function OnMyAgentRail(props: {
  activeView: OnMyAgentPrimaryView;
  account?: SidebarAccountInfo | null;
  onOpenView: (view: OnMyAgentPrimaryView) => void;
  onOpenDevices: () => void;
  onOpenUsage: () => void;
  onOpenAccountSettings?: () => void;
  onSignOut?: () => void;
  onOpenBilling?: () => void;
}) {
  return (
    <aside className="flex w-16 shrink-0 flex-col items-center bg-dls-rail pb-4 pt-14 text-dls-text">
      <div className="flex min-h-0 w-full flex-1 flex-col items-center gap-2.5">
        <nav className="flex min-h-0 w-full -translate-y-0.5 flex-1 flex-col items-center gap-2 overflow-y-auto pb-2">
          {TOP_RAIL_ITEMS.map((item) => (
            <TopRailButton
              key={item.id}
              item={item}
              active={item.id === "chat" ? props.activeView === "chat" : props.activeView === item.id}
              onClick={() => props.onOpenView(item.id)}
            />
          ))}
        </nav>
      </div>
      <div className="mt-auto flex w-full flex-col items-center gap-1">
        {BOTTOM_RAIL_ITEMS.map((item) => (
          <BottomRailButton
            key={item.id}
            item={item}
            active={props.activeView === item.id}
            onClick={() => props.onOpenView(item.id)}
          />
        ))}
        <SidebarAccountButton
          compact
          account={props.account || undefined}
          onOpenUsage={props.onOpenUsage}
          onOpenSettings={props.onOpenAccountSettings}
          onSignOut={props.onSignOut}
          onOpenBilling={props.onOpenBilling}
        />
      </div>
    </aside>
  );
}
