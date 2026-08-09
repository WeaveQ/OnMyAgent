/** @jsxImportSource react */
import { useEffect, useMemo, type ComponentType } from "react";

import { RailButton } from "@/components/ui/action-row";
import { cn } from "@/lib/utils";
import { resolvePublicAssetUrl } from "../../../../lib/public-asset-url";
import { APP_NAME } from "../../../../i18n/locales/brand";
import { t } from "../../../../i18n";
import { useCompanyConnected } from "../hooks/use-company-connected";
import {
  SidebarAccountButton,
  type SidebarAccountInfo,
  type SidebarPrimaryView,
} from "./app-sidebar";
import {
  AssistantRailIcon,
  AutomationRailIcon,
  ChannelsRailIcon,
  CompanyRailIcon,
  ExpertRailIcon,
  FilesRailIcon,
  ProjectsRailIcon,
  StoreRailIcon,
} from "./primary-rail-icons";

export type OnMyAgentPrimaryView =
  | SidebarPrimaryView
  | "assistant"
  | "files"
  | "store"
  | "company"
  | "projects"
  | "localAgent"
  | "agentManagement"
  /** Primary rail automation workspace (schedule definitions + run history). */
  | "automation"
  /**
   * Legacy alias for automation (assistant “定时任务”). Prefer writing
   * `automation`; keep reading for bookmarks / deep links.
   */
  | "scheduledTasks";

/** True for the automation primary surface (new id or legacy scheduledTasks). */
export function isAutomationRailView(view: string): boolean {
  return view === "automation" || view === "scheduledTasks";
}

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

// Order: Home → Experts → Automation → Files → Store → Company (gated) → Projects
// Local agents + agent management live under the account/settings menu.
// Company stays in the list definition for icon contracts; runtime filters by OMC connect.
const TOP_RAIL_ITEMS: RailItem[] = [
  { id: "assistant", get label() { return t("nav.assistant"); }, get shortLabel() { return t("nav.assistant_short"); }, icon: AssistantRailIcon },
  { id: "chat", get label() { return t("nav.experts"); }, get shortLabel() { return t("nav.experts_short"); }, icon: ExpertRailIcon },
  { id: "automation", get label() { return t("nav.automation"); }, get shortLabel() { return t("nav.automation_short"); }, icon: AutomationRailIcon },
  { id: "files", get label() { return t("nav.files"); }, get shortLabel() { return t("nav.files_short"); }, icon: FilesRailIcon },
  { id: "store", get label() { return t("nav.store"); }, get shortLabel() { return t("nav.store_short"); }, icon: StoreRailIcon },
  { id: "company", get label() { return t("nav.company"); }, get shortLabel() { return t("nav.company_short"); }, icon: CompanyRailIcon },
  { id: "projects", get label() { return t("nav.projects"); }, get shortLabel() { return t("nav.projects_short"); }, icon: ProjectsRailIcon },
];

// Bottom strip: channels only (devices entry removed — settings stays via account gear).
const BOTTOM_RAIL_ITEMS: BottomRailItem[] = [
  {
    id: "channels",
    get label() { return t("nav.channels"); },
    icon: ChannelsRailIcon,
  },
];

/**
 * Brand mark above primary rail items (same slot as peer apps' app icon).
 * Rounded solid tile + product logo; click returns to Home.
 */
function RailBrandMark(props: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={props.onClick}
      data-view-id="brand"
      title={APP_NAME}
      aria-label={APP_NAME}
      className={cn(
        // 44px tile / 24px mark — 2px under prior 46 / 26.
        "flex size-[44px] shrink-0 items-center justify-center rounded-2xl shadow-sm",
        // Light: black tile; dark: white tile so the blue mark stays readable.
        "bg-black ring-1 ring-black/20 hover:bg-neutral-900",
        "dark:bg-white dark:ring-white/30 dark:hover:bg-neutral-100",
        "transition-colors focus-visible:outline-none",
        "focus-visible:ring-3 focus-visible:ring-ring/30",
      )}
    >
      <img
        src={resolvePublicAssetUrl("/onmyagent-logo.webp")}
        alt=""
        width={24}
        height={24}
        className="size-6 object-contain"
        draggable={false}
      />
    </button>
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
      active={props.active}
      title={props.item.label}
      aria-label={props.item.label}
      aria-pressed={props.active}
    >
      <Icon className="size-5.5" />
      <span className="w-full truncate text-center text-xs font-medium leading-none tracking-tight">{props.item.shortLabel}</span>
    </RailButton>
  );
}

function isTopRailItemActive(
  itemId: OnMyAgentPrimaryView,
  activeView: OnMyAgentPrimaryView,
): boolean {
  if (itemId === "automation") return isAutomationRailView(activeView);
  return activeView === itemId;
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
      <Icon active={props.active} className="size-5.5" />
    </RailButton>
  );
}

export function OnMyAgentRail(props: {
  activeView: OnMyAgentPrimaryView;
  account?: SidebarAccountInfo | null;
  onOpenView: (view: OnMyAgentPrimaryView) => void;
  onOpenDevices: () => void;
  onOpenAccountSettings?: () => void;
  onOpenProfile?: () => void;
  onSignOut?: () => void;
  onOpenBilling?: () => void;
}) {
  // Only show Company shortcut after Settings → Workspace → Company is connected.
  const companyConnected = useCompanyConnected();
  const topRailItems = useMemo(
    () =>
      TOP_RAIL_ITEMS.filter(
        (item) => item.id !== "company" || companyConnected,
      ),
    [companyConnected],
  );

  useEffect(() => {
    if (!companyConnected && props.activeView === "company") {
      props.onOpenView("assistant");
    }
  }, [companyConnected, props.activeView, props.onOpenView]);

  // mac:pt-10 clears traffic lights (y≈12) without a large empty band above the brand mark.
  // Windows keeps compact top padding. Column = --dls-rail-width; pills = --dls-rail-pill-width.
  // Single soft right edge only — avoid double seam next to the list panel.
  return (
    <aside className="flex w-rail shrink-0 flex-col items-center border-r border-dls-border/40 bg-dls-rail px-1 pb-4 pt-2 mac:pt-10 text-dls-text">
      <div className="flex min-h-0 w-full flex-1 flex-col items-center">
        <nav className="flex min-h-0 w-full flex-1 flex-col items-center gap-2.5 overflow-y-auto overflow-x-hidden pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          <RailBrandMark onClick={() => props.onOpenView("assistant")} />
          {topRailItems.map((item) => (
            <TopRailButton
              key={item.id}
              item={item}
              active={isTopRailItemActive(item.id, props.activeView)}
              onClick={() => props.onOpenView(item.id)}
            />
          ))}
        </nav>
      </div>
      <div className="mt-auto flex w-full flex-col items-center gap-2">
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
          onOpenLocalAgent={() => props.onOpenView("localAgent")}
          onOpenAgentManagement={() => props.onOpenView("agentManagement")}
          onOpenSettings={props.onOpenAccountSettings}
          onOpenProfile={props.onOpenProfile}
          onSignOut={props.onSignOut}
          onOpenBilling={props.onOpenBilling}
        />
      </div>
    </aside>
  );
}
