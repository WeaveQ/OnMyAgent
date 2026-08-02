/** @jsxImportSource react */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowUpRight,
  LifeBuoy,
} from "lucide-react";

import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsCard as SettingsSurfaceCard } from "../settings-section";
import {
  getDataSettingsTabs,
  getGlobalSettingsTabs,
  getPersonalMemorySettingsTabs,
  getSettingsTabDescription,
  getSettingsTabIcon,
  getSettingsTabLabel,
  getWorkspaceSettingsTabs,
} from "../shell/settings-page";

const settingsOverviewTextClass = {
  groupLabel: "text-sm font-medium text-dls-secondary",
  cardTitle: "text-sm font-medium leading-5 text-dls-text",
  cardDescription: "line-clamp-2 text-xs leading-5 text-dls-secondary",
};

export type GeneralSettingsViewProps = {
  onNavigateTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  onReportIssue: () => void;
};

function OverviewNavCard(props: {
  icon: LucideIcon;
  title: string;
  desc: string;
  onClick: () => void;
  className?: string;
}) {
  const Icon = props.icon;
  return (
    <ActionRowButton
      density="settingsCard"
      type="button"
      onClick={props.onClick}
      className={cn(
        "h-auto min-h-[4.5rem] items-center gap-3 hover:bg-dls-surface-muted/60",
        props.className,
      )}
    >
      <IconTile border className="size-9 shrink-0">
        <Icon size={16} className="text-dls-secondary" />
      </IconTile>
      <div className="min-w-0 flex-1 text-left">
        <div className={settingsOverviewTextClass.cardTitle}>{props.title}</div>
        <div className={settingsOverviewTextClass.cardDescription}>
          {props.desc}
        </div>
      </div>
      <ArrowRight size={14} className="shrink-0 text-dls-secondary" />
    </ActionRowButton>
  );
}

function OverviewSection(props: {
  label: string;
  children: ReactNode;
}) {
  return (
    <section className="space-y-2.5">
      <h3 className={settingsOverviewTextClass.groupLabel}>{props.label}</h3>
      {props.children}
    </section>
  );
}

function OverviewTabGrid(props: {
  tabs: SettingsTab[];
  onNavigateTab: (tab: SettingsTab) => void;
}) {
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {props.tabs.map((tab, index) => {
        const isLastOdd =
          props.tabs.length % 2 === 1 && index === props.tabs.length - 1;
        return (
          <OverviewNavCard
            key={tab}
            icon={getSettingsTabIcon(tab)}
            title={getSettingsTabLabel(tab)}
            desc={getSettingsTabDescription(tab)}
            onClick={() => props.onNavigateTab(tab)}
            className={isLastOdd ? "sm:col-span-2" : undefined}
          />
        );
      })}
    </div>
  );
}

/**
 * Settings overview — cards are generated from the same tab lists as the
 * sidebar so 总览 never drifts (e.g. after fusing permissions / moving usage).
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
        <OverviewTabGrid tabs={dataTabs} onNavigateTab={props.onNavigateTab} />
      </OverviewSection>

      <OverviewSection label={t("settings.help_title")}>
        <SettingsSurfaceCard size="compact" tone="surface" className="p-4">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              <LifeBuoy size={14} className="shrink-0 text-dls-secondary" />
              <div className="min-w-0">
                <div className={settingsOverviewTextClass.cardTitle}>
                  {t("settings.feedback_title")}
                </div>
                <p
                  className={cn(
                    "mt-0.5 max-w-[52ch]",
                    settingsOverviewTextClass.cardDescription,
                    "line-clamp-2",
                  )}
                >
                  {t("settings.feedback_desc")}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={props.onReportIssue}
              >
                {t("settings.report_issue")}
                <ArrowUpRight size={12} />
              </Button>
            </div>
          </div>
        </SettingsSurfaceCard>
      </OverviewSection>
    </div>
  );
}
