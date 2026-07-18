/** @jsxImportSource react */
import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  ArrowRight,
  ArrowUpRight,
  LifeBuoy,
  MessageCircle,
} from "lucide-react";

import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SettingsCard as SettingsSurfaceCard } from "../settings-section";
import { getSettingsTabIcon } from "../shell/settings-page";

const settingsOverviewTextClass = {
  groupLabel: "text-sm font-medium text-dls-secondary",
  cardTitle: "text-sm font-medium leading-5 text-dls-text",
  cardDescription: "line-clamp-2 text-xs leading-5 text-dls-secondary",
};

export type GeneralSettingsViewProps = {
  onNavigateTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  onSendFeedback: () => void;
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

export function GeneralSettingsView(props: GeneralSettingsViewProps) {
  const workspaceCards: Array<{
    tab: SettingsTab;
    title: string;
    desc: string;
  }> = [
    {
      tab: "preferences",
      title: t("settings.preferences"),
      desc: t("settings.preferences_card_description"),
    },
    {
      tab: "memory",
      title: t("settings.tab_memory"),
      desc: t("settings.tab_description_memory"),
    },
    {
      tab: "conversation-memory",
      title: t("settings.tab_conversation_memory"),
      desc: t("settings.tab_description_conversation_memory"),
    },
    {
      tab: "permissions",
      title: t("settings.permissions"),
      desc: t("settings.permissions_card_description"),
    },
  ];

  const globalCards: Array<{
    tab: SettingsTab;
    title: string;
    desc: string;
  }> = [
    {
      tab: "ai",
      title: t("settings.ai_providers"),
      desc: t("settings.ai_providers_card_description"),
    },
    {
      tab: "environment",
      title: t("settings.tab_environment"),
      desc: t("settings.tab_environment_description"),
    },
    {
      tab: "updates",
      title: t("settings.tab_updates"),
      desc: t("settings.tab_updates_description"),
    },
  ];

  const archivedCards: Array<{
    tab: SettingsTab;
    title: string;
    desc: string;
  }> = [
    {
      tab: "archived-tasks",
      title: t("settings.tab_archived_tasks"),
      desc: t("settings.tab_description_archived_tasks"),
    },
  ];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-8">
      <OverviewSection label={t("settings.workspace_title")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {workspaceCards.map((card) => (
            <OverviewNavCard
              key={card.tab}
              icon={getSettingsTabIcon(card.tab)}
              title={card.title}
              desc={card.desc}
              onClick={() => props.onNavigateTab(card.tab)}
            />
          ))}
        </div>
      </OverviewSection>

      <OverviewSection label={t("settings.global_title")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {globalCards.map((card, index) => {
            const isLastOdd =
              globalCards.length % 2 === 1 && index === globalCards.length - 1;
            return (
              <OverviewNavCard
                key={card.tab}
                icon={getSettingsTabIcon(card.tab)}
                title={card.title}
                desc={card.desc}
                onClick={() => props.onNavigateTab(card.tab)}
                className={isLastOdd ? "sm:col-span-2" : undefined}
              />
            );
          })}
        </div>
      </OverviewSection>

      <OverviewSection label={t("settings.group_archived")}>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {archivedCards.map((card) => (
            <OverviewNavCard
              key={card.tab}
              icon={getSettingsTabIcon(card.tab)}
              title={card.title}
              desc={card.desc}
              onClick={() => props.onNavigateTab(card.tab)}
              className="sm:col-span-2"
            />
          ))}
        </div>
      </OverviewSection>

      <OverviewSection label={t("settings.help_title")}>
        <SettingsSurfaceCard size="compact" tone="surface" className="p-4">
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <LifeBuoy size={14} className="shrink-0 text-dls-secondary" />
                <div className={settingsOverviewTextClass.cardTitle}>
                  {t("settings.feedback_title")}
                </div>
              </div>
              <p
                className={cn(
                  "mt-1.5 max-w-[52ch]",
                  settingsOverviewTextClass.cardDescription,
                  "line-clamp-none",
                )}
              >
                {t("settings.feedback_desc")}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={props.onSendFeedback}
              >
                <MessageCircle size={12} />
                {t("settings.send_feedback")}
                <ArrowUpRight size={12} />
              </Button>
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
