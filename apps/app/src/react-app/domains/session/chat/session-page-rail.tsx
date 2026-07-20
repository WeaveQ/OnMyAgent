/** @jsxImportSource react */
import type { ComponentType } from "react";
import {
  Bot,
  Clock3,
  Folder,
  MonitorSmartphone,
  Network,
  ShoppingBag,
  UserRound,
} from "lucide-react";

import { t } from "../../../../i18n";
import { RailButton } from "@/components/ui/action-row";
import { resolvePublicAssetUrl } from "@/lib/public-asset-url";
import {
  SidebarAccountButton,
  type SidebarAccountInfo,
} from "../sidebar/app-sidebar";

import type { OnMyAgentPrimaryView } from "./session-page-sidebar-view-model";

type RailItem = {
  id: OnMyAgentPrimaryView;
  label: string;
  icon: ComponentType<{ className?: string }>;
};

const TOP_RAIL_ITEMS: RailItem[] = [
  { id: "personalAssistant", get label() { return t("nav.assistant"); }, icon: UserRound },
  { id: "chat", get label() { return t("nav.experts"); }, icon: Bot },
  { id: "localAgent", get label() { return t("nav.local_agent"); }, icon: MonitorSmartphone },
  { id: "files", get label() { return t("nav.files"); }, icon: Folder },
  { id: "store", get label() { return t("nav.store"); }, icon: ShoppingBag },
];

const BOTTOM_RAIL_ITEMS: RailItem[] = [
  { id: "scheduledTasks", label: "", icon: Clock3 },
  { id: "channels", label: "", icon: Network },
];

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
    <aside className="flex w-16 shrink-0 flex-col items-center border-r border-dls-surface/45 bg-dls-rail px-1.5 pb-4 pt-3 mac:pt-14 text-dls-text">
      <div className="flex w-full flex-col items-center gap-2.5">
        <nav className="mt-4 flex w-full flex-col items-center gap-3">
          {TOP_RAIL_ITEMS.map((item) => (
            <TopRailButton
              key={item.id}
              item={item}
              active={
                item.id === "chat"
                  ? props.activeView === "chat"
                  : props.activeView === item.id
              }
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
      size="bottom"
      active={props.active}
      className="size-[38px] hover:bg-dls-surface"
      title={props.item.label}
      aria-label={props.item.label}
      aria-pressed={props.active}
    >
      <Icon className="size-4" />
      <span className="max-w-full truncate leading-none">
        {props.item.label}
      </span>
    </RailButton>
  );
}

function BottomRailButton(props: {
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
      size="bottom"
      active={props.active}
      className="size-7 rounded-xl hover:bg-dls-surface"
      title={props.item.label}
      aria-label={props.item.label}
      aria-pressed={props.active}
    >
      <Icon className="size-4" />
      <span className="max-w-full truncate leading-none">
        {props.item.label}
      </span>
    </RailButton>
  );
}
