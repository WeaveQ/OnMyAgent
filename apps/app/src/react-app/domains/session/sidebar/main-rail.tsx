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

function WeChatBubblesIcon(props: { active?: boolean; className?: string }) {
  const active = props.active === true;
  const bubbleClassName = active
    ? "fill-current"
    : "fill-none stroke-current transition-colors";
  const eyeClassName = active
    ? "fill-dls-rail"
    : "fill-current transition-colors";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      {/* Rear (left) bubble */}
      <path
        className={bubbleClassName}
        strokeWidth={active ? 0 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M9.6 3.4C5.55 3.4 2.3 6.05 2.3 9.35c0 1.88 1.05 3.55 2.7 4.6l-.7 2.35 2.7-1.3c.7.16 1.44.24 2.2.24.18 0 .36 0 .54-.02A5.9 5.9 0 0 1 9.2 13c0-3.55 3.2-6.4 7.15-6.4.18 0 .36.01.53.02C15.7 4.55 12.95 3.4 9.6 3.4Z"
      />
      <circle cx="7.05" cy="8.15" r="0.95" className={eyeClassName} />
      <circle cx="11.35" cy="8.15" r="0.95" className={eyeClassName} />
      {/* Front (right) bubble — WeChat dual-bubble mark */}
      <path
        className={bubbleClassName}
        strokeWidth={active ? 0 : 1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M21.7 13.65c0-3.15-3-5.7-6.7-5.7s-6.7 2.55-6.7 5.7 3 5.7 6.7 5.7c.72 0 1.42-.09 2.07-.26l2.55 1.22-.65-2.2c1.7-1.05 2.73-2.7 2.73-4.46Z"
      />
      <circle cx="12.55" cy="12.75" r="0.85" className={eyeClassName} />
      <circle cx="16.85" cy="12.75" r="0.85" className={eyeClassName} />
    </svg>
  );
}

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
    icon: WeChatBubblesIcon,
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
      className={props.item.id === "channels" ? "group/channel" : undefined}
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
