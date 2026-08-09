/** @jsxImportSource react */
/**
 * Settings overview — same 2-column card grid as System “应用选项”
 * (IconTile + title/desc + chevron). Tab lists stay shared with the sidebar.
 */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import { ArrowUpRight, ChevronRight, LifeBuoy } from "lucide-react";

import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import { IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  getDataSettingsTabs,
  getGlobalSettingsTabs,
  getPersonalMemorySettingsTabs,
  getSettingsTabDescription,
  getSettingsTabIcon,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
} from "../shell/settings-page";

export type GeneralSettingsViewProps = {
  onNavigateTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  onReportIssue: () => void;
};

function OverviewSection(props: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-3">
      <h3 className="text-lg font-medium leading-7 text-dls-text">{props.label}</h3>
      {props.children}
    </section>
  );
}

/** Match SystemOptionCard chrome: one row, 2 cols on sm+. */
function OverviewNavCard(props: {
  icon: LucideIcon;
  title: string;
  description: string;
  onClick: () => void;
  className?: string;
}) {
  const Icon = props.icon;
  return (
    <button
      type="button"
      onClick={props.onClick}
      className={cn(
        "flex min-h-[4.75rem] w-full items-center gap-3 rounded-xl border border-dls-border",
        "bg-dls-surface px-3.5 py-3 text-left transition-colors",
        "hover:bg-dls-list-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
        props.className,
      )}
    >
      {/* Soft plate only — no stroke (avoids double-frame with card border). */}
      <IconTile className="size-9 shrink-0">
        <Icon size={16} className="text-dls-secondary" aria-hidden />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-dls-text">
          {props.title}
        </div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
          {props.description}
        </p>
      </div>
      <ChevronRight
        size={16}
        className="shrink-0 text-dls-secondary"
        aria-hidden
      />
    </button>
  );
}

function OverviewTabGrid(props: {
  tabs: SettingsTab[];
  onNavigateTab: (tab: SettingsTab) => void;
}) {
  if (props.tabs.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {props.tabs.map((tab) => (
        <OverviewNavCard
          key={tab}
          icon={getSettingsTabIcon(tab)}
          title={getSettingsTabLabel(tab)}
          description={getSettingsTabDescription(tab)}
          onClick={() => props.onNavigateTab(tab)}
        />
      ))}
    </div>
  );
}

/**
 * Settings overview — 2-up cards from the same tab getters as the sidebar.
 */
export function GeneralSettingsView(props: GeneralSettingsViewProps) {
  const workspaceTabs = getWorkspaceSettingsTabs();
  const personalMemoryTabs = getPersonalMemorySettingsTabs();
  const globalTabs = getGlobalSettingsTabs(props.developerMode);
  const dataTabs = getDataSettingsTabs();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <OverviewSection label={t("settings.workspace_title")}>
        <OverviewTabGrid
          tabs={workspaceTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.group_personal_memory")}>
        <OverviewTabGrid
          tabs={personalMemoryTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.global_title")}>
        <OverviewTabGrid
          tabs={globalTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.group_data")}>
        <OverviewTabGrid
          tabs={dataTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.help_title")}>
        <div
          className={cn(
            "flex min-h-[4.75rem] flex-wrap items-center gap-3 rounded-xl border border-dls-border",
            "bg-dls-surface px-3.5 py-3",
          )}
        >
          <IconTile className="size-9 shrink-0">
            <LifeBuoy size={16} className="text-dls-secondary" aria-hidden />
          </IconTile>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-medium leading-5 text-dls-text">
              {t("settings.feedback_title")}
            </div>
            <p className="mt-0.5 line-clamp-2 max-w-[52ch] text-xs leading-5 text-dls-secondary">
              {t("settings.feedback_desc")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="shrink-0"
            onClick={props.onReportIssue}
          >
            {t("settings.report_issue")}
            <ArrowUpRight size={12} />
          </Button>
        </div>
      </OverviewSection>
    </div>
  );
}
