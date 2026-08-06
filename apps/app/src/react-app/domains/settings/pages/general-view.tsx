/** @jsxImportSource react */
/**
 * Settings overview — compact row lists (not a flat 2-col card grid).
 * Rows come from the same tab getters as the sidebar so order never drifts.
 */
import type { ReactNode } from "react";
import { ArrowUpRight, ChevronRight, LifeBuoy } from "lucide-react";

import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  SettingsBlock,
  SettingsBlockRow,
} from "../settings-section";
import {
  getDataSettingsTabs,
  getGlobalSettingsTabs,
  getPersonalMemorySettingsTabs,
  getSettingsTabDescription,
  getSettingsTabIcon,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
} from "../shell/settings-page";

const overviewTextClass = {
  groupLabel: "text-sm font-medium text-dls-secondary",
  cardTitle: "text-sm font-medium leading-5 text-dls-text",
  cardDescription: "text-xs leading-5 text-dls-secondary",
};

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
    <section className="space-y-2.5">
      <h3 className={overviewTextClass.groupLabel}>{props.label}</h3>
      {props.children}
    </section>
  );
}

function OverviewTabList(props: {
  tabs: SettingsTab[];
  onNavigateTab: (tab: SettingsTab) => void;
}) {
  if (props.tabs.length === 0) return null;
  return (
    <SettingsBlock>
      {props.tabs.map((tab) => {
        const Icon = getSettingsTabIcon(tab);
        return (
          <button
            key={tab}
            type="button"
            data-slot="settings-block-row"
            className={cn(
              "flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors",
              "hover:bg-dls-list-hover focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30",
            )}
            onClick={() => props.onNavigateTab(tab)}
          >
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-dls-border bg-dls-surface-muted text-dls-secondary">
              <Icon size={16} aria-hidden />
            </span>
            <span className="min-w-0 flex-1 space-y-0.5">
              <span className={cn("block", overviewTextClass.cardTitle)}>
                {getSettingsTabLabel(tab)}
              </span>
              <span className={cn("block line-clamp-1", overviewTextClass.cardDescription)}>
                {getSettingsTabDescription(tab)}
              </span>
            </span>
            <ChevronRight
              size={16}
              className="shrink-0 text-dls-secondary"
              aria-hidden
            />
          </button>
        );
      })}
    </SettingsBlock>
  );
}

/**
 * Settings overview — list rows generated from the same tab lists as the
 * sidebar so 总览 never drifts.
 */
export function GeneralSettingsView(props: GeneralSettingsViewProps) {
  const workspaceTabs = getWorkspaceSettingsTabs();
  const personalMemoryTabs = getPersonalMemorySettingsTabs();
  const globalTabs = getGlobalSettingsTabs(props.developerMode);
  const dataTabs = getDataSettingsTabs();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-7">
      <OverviewSection label={t("settings.workspace_title")}>
        <OverviewTabList
          tabs={workspaceTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.group_personal_memory")}>
        <OverviewTabList
          tabs={personalMemoryTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.global_title")}>
        <OverviewTabList
          tabs={globalTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.group_data")}>
        <OverviewTabList
          tabs={dataTabs}
          onNavigateTab={props.onNavigateTab}
        />
      </OverviewSection>

      <OverviewSection label={t("settings.help_title")}>
        <SettingsBlock>
          <SettingsBlockRow
            align="start"
            title={
              <span className="inline-flex items-center gap-2">
                <LifeBuoy size={14} className="text-dls-secondary" aria-hidden />
                {t("settings.feedback_title")}
              </span>
            }
            description={t("settings.feedback_desc")}
            actions={
              <Button
                variant="outline"
                size="sm"
                onClick={props.onReportIssue}
              >
                {t("settings.report_issue")}
                <ArrowUpRight size={12} />
              </Button>
            }
          />
        </SettingsBlock>
      </OverviewSection>
    </div>
  );
}
