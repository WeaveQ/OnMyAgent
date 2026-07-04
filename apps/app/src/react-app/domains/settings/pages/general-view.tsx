/** @jsxImportSource react */
import {
  ArrowRight,
  ArrowUpRight,
  Brain,
  Cog,
  FolderLock,
  LifeBuoy,
  MessageCircle,
  RefreshCcw,
  Sparkles,
  Terminal,
} from "lucide-react";

import { t } from "../../../../i18n";
import type { SettingsTab } from "../../../../app/types";
import { ActionRowButton, IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { SettingsCard as SettingsSurfaceCard } from "../settings-section";

const settingsOverviewTextClass = {
  groupLabel: "text-sm font-medium text-dls-secondary",
  cardTitle: "text-sm font-medium leading-5 text-dls-text",
  cardDescription: "line-clamp-1 text-xs leading-5 text-dls-secondary",
};

export type GeneralSettingsViewProps = {
  onNavigateTab: (tab: SettingsTab) => void;
  developerMode: boolean;
  onSendFeedback: () => void;
  onReportIssue: () => void;
};

function SettingsCard(props: {
  icon: typeof Sparkles;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <ActionRowButton
      density="compact"
      type="button"
      onClick={props.onClick}
      className="min-h-18 items-center"
    >
      <IconTile border>
        <props.icon size={16} className="text-dls-secondary" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className={settingsOverviewTextClass.cardTitle}>
          {props.title}
        </div>
        <div className={settingsOverviewTextClass.cardDescription}>{props.desc}</div>
      </div>
      <ArrowRight size={14} className="shrink-0 text-dls-secondary" />
    </ActionRowButton>
  );
}

export function GeneralSettingsView(props: GeneralSettingsViewProps) {
  const workspaceCards: {
    tab: SettingsTab;
    icon: typeof Sparkles;
    title: string;
    desc: string;
  }[] = [
    {
      tab: "preferences",
      icon: Cog,
      title: t("settings.preferences"),
      desc: t("settings.preferences_card_description"),
    },
    {
      tab: "memory",
      icon: Brain,
      title: t("settings.tab_memory"),
      desc: t("settings.tab_description_memory"),
    },
    {
      tab: "permissions",
      icon: FolderLock,
      title: t("settings.permissions"),
      desc: t("settings.permissions_card_description"),
    },
  ];

  const globalCards: {
    tab: SettingsTab;
    icon: typeof Sparkles;
    title: string;
    desc: string;
  }[] = [
    {
      tab: "ai",
      icon: Sparkles,
      title: t("settings.ai_providers"),
      desc: t("settings.ai_providers_card_description"),
    },
    {
      tab: "environment",
      icon: Terminal,
      title: t("settings.tab_environment"),
      desc: t("settings.tab_environment_description"),
    },
    {
      tab: "updates",
      icon: RefreshCcw,
      title: t("settings.tab_updates"),
      desc: t("settings.tab_updates_description"),
    },
  ];

  return (
    <div className="w-full max-w-3xl space-y-6">
      {/* Workspace settings */}
      <div className="space-y-3">
        <div className={settingsOverviewTextClass.groupLabel}>
          {t("settings.workspace_title")}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {workspaceCards.map((card) => (
            <SettingsCard
              key={card.tab}
              icon={card.icon}
              title={card.title}
              desc={card.desc}
              onClick={() => props.onNavigateTab(card.tab)}
            />
          ))}
        </div>
      </div>

      {/* Global settings */}
      <div className="space-y-3">
        <div className={settingsOverviewTextClass.groupLabel}>
          {t("settings.global_title")}
        </div>
        <div className="grid grid-cols-2 gap-4">
          {globalCards.map((card) => (
            <SettingsCard
              key={card.tab}
              icon={card.icon}
              title={card.title}
              desc={card.desc}
              onClick={() => props.onNavigateTab(card.tab)}
            />
          ))}
        </div>
      </div>

      {/* Feedback */}
      <div className="space-y-3">
        <div className={settingsOverviewTextClass.groupLabel}>
          {t("settings.help_title")}
        </div>
        <SettingsSurfaceCard size="compact" tone="surface">
          <div className="space-y-3">
            <div>
              <div className="flex items-center gap-2">
                <LifeBuoy size={14} className="text-dls-secondary" />
                <div className={settingsOverviewTextClass.cardTitle}>
                  {t("settings.feedback_title")}
                </div>
              </div>
              <div className={`mt-1 ${settingsOverviewTextClass.cardDescription}`}>
                {t("settings.feedback_desc")}
              </div>
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
      </div>
    </div>
  );
}
