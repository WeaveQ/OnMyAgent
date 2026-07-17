/** @jsxImportSource react */
import {
  Bot,
  ChevronLeft,
  Clock3,
  FileText,
  LayoutDashboard,
  MonitorSmartphone,
  Network,
  Search,
  Sparkles,
  Plus,
  Zap,
} from "lucide-react";
import { useEffect, useState } from "react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { CountBadge } from "@/components/ui/status-badge";
import type { OnMyAgentServerClient } from "../../../../../app/lib/onmyagent-server";
import { t } from "../../../../../i18n";
import { cn } from "@/lib/utils";
import type { SidebarPrimaryView } from "../../sidebar/app-sidebar";
import {
  ExpertMarketplacePage,
  type ExpertMarketplaceView,
} from "../../expert-marketplace/expert-marketplace-dialog";
import type { ExpertMarketplaceEntry } from "../../expert-marketplace/types";
import { SkillsMarketplacePage } from "../../skills-marketplace/skills-marketplace-page";
import { useStatusToasts } from "../../../shell-feedback";
import { FeaturePreviewPlaceholder } from "../feature-preview-placeholder";
import {
  PluginsPage,
  type ArtifactPluginPromptSelection,
} from "@/react-app/domains/plugins";

const sidePanelTextClass = {
  emptyTitle: "mt-5 text-base font-medium text-dls-text",
  emptyDescription: "mt-2 text-sm text-dls-secondary",
  pageTitle: "text-lg font-medium text-dls-text",
  panelTitle: "text-base font-medium text-dls-text",
  sectionTitle: "text-sm font-medium uppercase tracking-[0.08em] text-dls-secondary",
};

export const SIDEBAR_VIEW_LABELS: Record<
  Exclude<SidebarPrimaryView, "chat">,
  string
> = {
  get billing() { return t("nav.billing"); },
  get agents() { return t("nav.agents"); },
  get skills() { return t("nav.skills"); },
  get connectors() { return t("nav.connectors"); },
  get devices() { return t("nav.devices"); },
  get scheduledTasks() { return t("nav.scheduled_tasks"); },
  get channels() { return t("nav.channels"); },
  get personalAssistant() { return t("nav.assistant"); },
};

export const SIDEBAR_VIEW_ICONS: Record<
  Exclude<SidebarPrimaryView, "chat">,
  typeof Bot
> = {
  billing: Sparkles,
  agents: Bot,
  skills: FileText,
  connectors: Zap,
  devices: MonitorSmartphone,
  scheduledTasks: Clock3,
  channels: Network,
  personalAssistant: LayoutDashboard,
};

export function SidebarFeaturePlaceholder(props: {
  view: Exclude<SidebarPrimaryView, "chat">;
}) {
  if (props.view === "scheduledTasks") {
    return <FeaturePreviewPlaceholder kind="scheduledTasks" />;
  }

  const Icon = SIDEBAR_VIEW_ICONS[props.view];
  const label = SIDEBAR_VIEW_LABELS[props.view];

  return (
    <div className="flex h-full min-h-0 items-center justify-center px-6 py-16">
      <div className="flex max-w-sm flex-col items-center text-center">
        <div className="flex size-14 items-center justify-center rounded-xl border border-dls-border bg-dls-hover text-dls-secondary">
          <Icon className="size-6" />
        </div>
        <h2 className={sidePanelTextClass.emptyTitle}>{label}</h2>
        <p className={sidePanelTextClass.emptyDescription}>{t("session.feature_placeholder_coming_soon")}</p>
      </div>
    </div>
  );
}

type BillingTab = "usage" | "bill";

function getBillingUsageRecords(): ReadonlyArray<{ time: string; scene: string; session: string; credits: string }> {
  const scene = t("session.billing_mock_scene");
  return [
    { time: "2026/6/2 18:42:54~2026/6/2 18:42:57", scene, session: t("session.billing_mock_session_who"), credits: "2.40" },
    { time: "2026/5/29 16:51:55~2026/6/2 16:31:27", scene, session: t("session.billing_mock_session_hello"), credits: "1.58" },
    { time: "2026/6/2 16:10:16~2026/6/2 16:11:07", scene, session: t("session.billing_mock_session_list_tree"), credits: "8.59" },
    { time: "2026/6/2 16:09:32~2026/6/2 16:09:50", scene, session: t("session.billing_mock_session_list_files"), credits: "3.85" },
    { time: "2026/6/2 16:06:43~2026/6/2 16:06:59", scene, session: t("session.billing_mock_session_list_dir"), credits: "4.18" },
    { time: "2026/6/2 16:02:28~2026/6/2 16:02:52", scene, session: t("session.billing_mock_session_hello"), credits: "7.77" },
    { time: "2026/6/2 15:54:22~2026/6/2 15:54:58", scene, session: t("session.billing_mock_session_hello"), credits: "10.30" },
  ];
}

const BILLING_CHART_BARS = [0, 0, 0, 0, 0, 0, 12, 64, 10, 0, 0, 22, 0];

function BillingTabButton(props: {
  active: boolean;
  children: string;
  onClick: () => void;
}) {
  return (
    <NavTabButton
      type="button"
      onClick={props.onClick}
      active={props.active}
      size="underline"
      shape="underline"
    >
      {props.children}
    </NavTabButton>
  );
}

function BillingMetric(props: { color: string; label: string; value: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={cn("size-1.5 rounded-full", props.color)} />
      <span className="flex-1">{props.label}</span>
      <span className="font-medium">{props.value}</span>
    </div>
  );
}

function BillingUsagePanel() {
  return (
    <div className="space-y-5">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-dls-border bg-dls-surface p-4">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <span className="text-2xl font-medium leading-none">1</span>
              <span className="ml-1 text-sm font-medium">/ 20</span>
              <span className="ml-2 text-xs text-dls-secondary">
                {t("session.billing_used_percent", { percent: 5 })}
              </span>
            </div>
            <span className="text-xs text-dls-secondary">
              {t("session.billing_period_placeholder")}
            </span>
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[5%] rounded-full bg-dls-accent" />
          </div>
          <div className="space-y-2 text-sm">
            <BillingMetric
              color="bg-dls-accent"
              label={t("session.billing_daily_credits")}
              value="1 / 20"
            />
            <BillingMetric color="bg-dls-signal" label={t("session.billing_promo_credits")} value="0" />
            <BillingMetric color="bg-dls-status-warning" label={t("session.billing_addon_credits")} value="0" />
          </div>
        </section>
        <section className="rounded-xl border border-dls-border bg-dls-surface p-4">
          <h3 className={`mb-4 ${sidePanelTextClass.sectionTitle}`}>{t("session.billing_last_14_days")}</h3>
          <div className="flex h-[116px] items-end gap-6 px-2">
            {BILLING_CHART_BARS.map((height, index) => (
              <div
                key={index}
                className="flex flex-1 flex-col items-center justify-end gap-2"
              >
                <div
                  className="w-full max-w-8 rounded-t-sm bg-dls-accent"
                  style={{ height: `${height}px` }}
                />
                <span className="text-xs text-dls-secondary">
                  {String(21 + index > 31 ? index - 10 : 21 + index).padStart(
                    2,
                    "0",
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>
      <section className="rounded-xl border border-dls-border bg-dls-surface p-4">
        <h3 className={`mb-3 ${sidePanelTextClass.sectionTitle}`}>{t("session.billing_usage_records", { count: 20 })}</h3>
        <div className="overflow-hidden border-t border-dls-border">
          <div className="grid grid-cols-[1.25fr_0.75fr_1.1fr_0.55fr_0.5fr] border-b border-dls-border py-3 text-sm font-medium">
            <div>{t("session.billing_col_time")}</div>
            <div>{t("session.billing_col_scene")}</div>
            <div>{t("session.billing_col_session")}</div>
            <div>{t("session.billing_col_credits")}</div>
            <div />
          </div>
          {getBillingUsageRecords().map((record) => (
            <div
              key={`${record.time}-${record.session}`}
              className="grid grid-cols-[1.25fr_0.75fr_1.1fr_0.55fr_0.5fr] border-b border-dls-mist py-4 text-sm last:border-b-0"
            >
              <div className="text-dls-secondary">{record.time}</div>
              <div className="text-dls-secondary">{record.scene}</div>
              <div>{record.session}</div>
              <div className="font-medium">{record.credits}</div>
              <Button
                type="button"
                variant="link"
                size="xs"
                className="justify-start p-0 text-left text-dls-secondary hover:text-dls-text"
              >
                {t("session.billing_view_details")}
              </Button>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function BillingBillPanel() {
  return (
    <section className="flex h-[220px] items-center justify-center rounded-xl border border-dls-border bg-dls-surface text-sm text-dls-secondary">
      {t("session.billing_no_records")}
    </section>
  );
}

export function BillingPage() {
  const [activeTab, setActiveTab] = useState<BillingTab>("usage");
  return (
    <div className="h-full overflow-auto bg-dls-surface px-6 py-6 text-dls-text">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="flex min-h-16 items-center justify-between rounded-xl border border-dls-border bg-dls-surface px-4">
          <h2 className={sidePanelTextClass.panelTitle}>{t("session.billing_free_plan")}</h2>
          <Button size="lg"
            type="button"
            className="bg-dls-accent hover:bg-dls-decision-hover"
          >
            {t("session.billing_upgrade")}
          </Button>
        </section>
        <div className="flex gap-5 border-b border-dls-border">
          <BillingTabButton
            active={activeTab === "usage"}
            onClick={() => setActiveTab("usage")}
          >
            {t("session.billing_tab_usage")}
          </BillingTabButton>
          <BillingTabButton
            active={activeTab === "bill"}
            onClick={() => setActiveTab("bill")}
          >
            {t("session.billing_tab_bill")}
          </BillingTabButton>
        </div>
        {activeTab === "usage" ? <BillingUsagePanel /> : <BillingBillPanel />}
      </div>
    </div>
  );
}

export function DevicesPage() {
  return (
    <div className="flex h-full items-center justify-center text-center">
      <FeaturePreviewPlaceholder kind="devices" />
    </div>
  );
}

export type StorePrimaryTab = "experts" | "skills" | "plugins";

function StorePrimaryTabs(props: {
  value: StorePrimaryTab;
  onChange: (tab: StorePrimaryTab) => void;
}) {
  const items: Array<{ id: StorePrimaryTab; label: string }> = [
    { id: "experts", label: t("store.experts_marketplace") },
    { id: "skills", label: t("store.skills_marketplace") },
    { id: "plugins", label: t("plugins.artifact_title") },
  ];

  return (
    <SegmentedTabGroup className="mac:titlebar-no-drag">
      {items.map((item) => {
        const active = props.value === item.id;
        return (
          <NavTabButton
            key={item.id}
            type="button"
            onClick={() => props.onChange(item.id)}
            active={active}
            size="tab"
            shape="tab"
            className="mac:titlebar-no-drag"
            aria-pressed={active}
          >
            <span className="truncate">{item.label}</span>
          </NavTabButton>
        );
      })}
    </SegmentedTabGroup>
  );
}

export function StorePage(props: {
  workspaceId: string;
  workspaceRoot?: string | null;
  client?: OnMyAgentServerClient | null;
  activeTab?: StorePrimaryTab;
  myExperts?: ExpertMarketplaceEntry[];
  onActiveTabChange?: (tab: StorePrimaryTab) => void;
  onSummonMarketplaceExpert?: (expert: ExpertMarketplaceEntry) => void;
  onCreateExpert?: () => void;
  onSelectArtifactPrompt?: (selection: ArtifactPluginPromptSelection) => void;
}) {
  const { showToast } = useStatusToasts();
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<StorePrimaryTab>(props.activeTab ?? "experts");
  const [expertView, setExpertView] = useState<ExpertMarketplaceView>("market");
  const [skillView, setSkillView] = useState<"market" | "installed">("market");
  const [installedSkillCount, setInstalledSkillCount] = useState(0);
  const [query, setQuery] = useState("");
  const [skillImportOpen, setSkillImportOpen] = useState(false);
  const activeTab = props.activeTab ?? uncontrolledActiveTab;

  useEffect(() => {
    if (props.activeTab) setUncontrolledActiveTab(props.activeTab);
  }, [props.activeTab]);

  const handleTabChange = (tab: StorePrimaryTab) => {
    setUncontrolledActiveTab(tab);
    props.onActiveTabChange?.(tab);
    if (tab !== "experts") setExpertView("market");
    if (tab !== "skills") setSkillView("market");
    setQuery("");
  };

  const showComingSoonToast = () => {
    showToast({
      title: t("common.coming_soon"),
      tone: "info",
    });
  };

  const searchPlaceholder =
    activeTab === "skills"
      ? t("store.search_skills")
      : t("session.search_experts_placeholder");

  return (
    <div className="flex h-full min-h-0 flex-col bg-dls-background">
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-dls-border bg-dls-surface px-6 mac:titlebar-drag">
        {activeTab === "experts" && expertView === "mine" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setExpertView("market")}
            className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
          >
            <ChevronLeft data-icon="inline-start" className="size-4" />
            {t("store.all_experts")}
          </Button>
        ) : activeTab === "skills" && skillView === "installed" ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSkillView("market")}
            className="text-dls-secondary hover:bg-dls-hover hover:text-dls-text mac:titlebar-no-drag"
          >
            <ChevronLeft data-icon="inline-start" className="size-4" />
            {t("store.skills_marketplace")}
          </Button>
        ) : (
          <StorePrimaryTabs value={activeTab} onChange={handleTabChange} />
        )}
        <div className="flex min-w-0 items-center gap-2.5 mac:titlebar-no-drag">
          {activeTab !== "plugins" && expertView === "market" && skillView === "market" ? (
            <InputGroup controlSize="sm" radius="md" tone="surface" className="w-72 mac:titlebar-no-drag">
              <InputGroupAddon align="inline-start">
                <Search className="size-3.5" />
              </InputGroupAddon>
              <InputGroupInput
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder={searchPlaceholder}
                className="text-sm text-dls-text placeholder:text-dls-secondary/70"
              />
            </InputGroup>
          ) : null}
          {activeTab === "experts" && expertView === "market" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setExpertView("mine")}
              className="mac:titlebar-no-drag"
            >
              {t("session.my_experts")}
            </Button>
          ) : activeTab === "skills" ? (
            <Button
              type="button"
              size="sm"
              onClick={() => setSkillImportOpen(true)}
              className="mac:titlebar-no-drag"
            >
              <Plus data-icon="inline-start" className="size-4" />
              {t("store.add_skill")}
            </Button>
          ) : null}
          {activeTab === "skills" && skillView === "market" ? (
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                setSkillView("installed");
                setQuery("");
              }}
              className="rounded-md mac:titlebar-no-drag"
            >
              {t("skills_marketplace.installed")}
              <CountBadge size="dot" className="ml-1.5">
                {installedSkillCount}
              </CountBadge>
            </Button>
          ) : null}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {activeTab === "experts" ? (
          <ExpertMarketplacePage
            view={expertView}
            query={query}
            myExperts={props.myExperts ?? []}
            onSummonMarketplaceExpert={(expert) => {
              props.onSummonMarketplaceExpert?.(expert);
            }}
            onCreateExpert={props.onCreateExpert ?? showComingSoonToast}
          />
        ) : activeTab === "skills" ? (
          <SkillsMarketplacePage
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            client={props.client}
            query={query}
            view={skillView}
            importOpen={skillImportOpen}
            onImportOpenChange={setSkillImportOpen}
            onInstalledCountChange={setInstalledSkillCount}
          />
        ) : activeTab === "plugins" ? (
          <PluginsPage
            workspaceId={props.workspaceId}
            workspaceRoot={props.workspaceRoot}
            client={props.client}
            onSelectArtifactPrompt={props.onSelectArtifactPrompt}
          />
        ) : null}
      </div>
    </div>
  );
}

export function ProjectsComingSoonPage() {
  return (
    <div className="flex h-full items-center justify-center bg-dls-background px-6 text-center">
      <div className="space-y-2">
        <div className={sidePanelTextClass.panelTitle}>{t("session.projects_coming_soon_title")}</div>
        <div className="text-sm text-dls-secondary">{t("session.projects_coming_soon_body")}</div>
      </div>
    </div>
  );
}
