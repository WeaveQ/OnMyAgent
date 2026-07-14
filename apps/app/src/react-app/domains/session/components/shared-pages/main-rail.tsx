/** @jsxImportSource react */
import type { ComponentType } from "react";
import {
  FolderOpen,
  MonitorCog,
  SlidersHorizontal,
  Store,
} from "lucide-react";

import { RailButton } from "@/components/ui/action-row";
import { t } from "../../../../../i18n";
import {
  SidebarAccountButton,
  type SidebarAccountInfo,
  type SidebarPrimaryView,
} from "../../sidebar/app-sidebar";
import { AssistantRailIcon, ExpertRailIcon } from "./primary-rail-icons";

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

type BottomRailItem = Omit<RailItem, "icon"> & {
  icon: ComponentType<{ active: boolean; className?: string }>;
};

function WeChatBubblesIcon(props: { active: boolean; className?: string }) {
  const bubbleClassName = props.active
    ? "fill-current"
    : "fill-dls-surface transition-colors group-hover/channel:fill-dls-text-tertiary";
  const eyeClassName = "fill-dls-rail";

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      className={props.className}
    >
      <path
        className={bubbleClassName}
        d="M10.15 3.25C5.65 3.25 2 6.1 2 9.62c0 2.02 1.2 3.84 3.1 5l-.77 2.64 2.94-1.48c.74.18 1.53.27 2.35.27h.34a6.5 6.5 0 0 1-.56-2.57c0-3.84 3.48-6.96 7.82-6.96h.47c-1.3-1.97-4.1-3.27-7.54-3.27Z"
      />
      <circle cx="7.15" cy="8.25" r="1" className={eyeClassName} />
      <circle cx="12.05" cy="8.25" r="1" className={eyeClassName} />
      <path
        className={bubbleClassName}
        d="M22 13.48c0-3.35-3.27-6.06-7.3-6.06s-7.3 2.71-7.3 6.06 3.27 6.06 7.3 6.06c.76 0 1.49-.1 2.18-.27l2.68 1.36-.68-2.43c1.89-1.1 3.12-2.83 3.12-4.72Z"
      />
      <circle cx="12.25" cy="12.55" r="0.9" className={eyeClassName} />
      <circle cx="16.75" cy="12.55" r="0.9" className={eyeClassName} />
    </svg>
  );
}

const TOP_RAIL_ITEMS: RailItem[] = [
  { id: "assistant", get label() { return t("nav.assistant"); }, get shortLabel() { return t("nav.assistant_short"); }, icon: AssistantRailIcon },
  { id: "chat", get label() { return t("nav.experts"); }, get shortLabel() { return t("nav.experts_short"); }, icon: ExpertRailIcon },
  { id: "localAgent", get label() { return t("nav.local_agent"); }, get shortLabel() { return t("nav.local_agent_short"); }, icon: MonitorCog },
  { id: "files", get label() { return t("nav.files"); }, get shortLabel() { return t("nav.files_short"); }, icon: FolderOpen },
  { id: "store", get label() { return t("nav.store"); }, get shortLabel() { return t("nav.store_short"); }, icon: Store },
  { id: "agentManagement", get label() { return t("nav.management"); }, get shortLabel() { return t("nav.management_short"); }, icon: SlidersHorizontal },
];

const BOTTOM_RAIL_ITEMS: BottomRailItem[] = [
  {
    id: "channels",
    get label() { return t("nav.channels"); },
    shortLabel: "",
    icon: WeChatBubblesIcon,
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
      className="group/channel"
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
          onOpenDevices={props.onOpenDevices}
          onOpenSettings={props.onOpenAccountSettings}
          onSignOut={props.onSignOut}
          onOpenBilling={props.onOpenBilling}
        />
      </div>
    </aside>
  );
}
