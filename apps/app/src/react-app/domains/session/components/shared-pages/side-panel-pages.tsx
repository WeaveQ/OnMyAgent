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
  Upload,
  Zap,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import type { OpenworkServerClient } from "../../../../../app/lib/onmyagent-server";
import { t } from "../../../../../i18n";
import { cn } from "@/lib/utils";
import type { SidebarPrimaryView } from "../../sidebar/app-sidebar";
import {
  ExpertMarketplacePage,
  type ExpertMarketplaceView,
} from "../../expert-marketplace/expert-marketplace-dialog";
import type { ExpertMarketplaceEntry } from "../../expert-marketplace/types";
import { SkillsMarketplacePage } from "../../skills-marketplace/skills-marketplace-page";
import { useStatusToasts } from "../../../shared/status-toasts";
import { FeaturePreviewPlaceholder } from "../feature-preview-placeholder";

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
        <div className="flex size-14 items-center justify-center rounded-2xl border border-dls-border bg-dls-hover text-dls-secondary">
          <Icon className="size-6" />
        </div>
        <h2 className={sidePanelTextClass.emptyTitle}>{label}</h2>
        <p className={sidePanelTextClass.emptyDescription}>开发中，敬请期待</p>
      </div>
    </div>
  );
}

type BillingTab = "usage" | "bill";

const BILLING_USAGE_RECORDS = [
  {
    time: "2026/6/2 18:42:54~2026/6/2 18:42:57",
    scene: "AccioWork任务",
    session: "你是谁?",
    credits: "2.40",
  },
  {
    time: "2026/5/29 16:51:55~2026/6/2 16:31:27",
    scene: "AccioWork任务",
    session: "打个招呼",
    credits: "1.58",
  },
  {
    time: "2026/6/2 16:10:16~2026/6/2 16:11:07",
    scene: "AccioWork任务",
    session: "查看文件目录结构",
    credits: "8.59",
  },
  {
    time: "2026/6/2 16:09:32~2026/6/2 16:09:50",
    scene: "AccioWork任务",
    session: "查看目录下的文件",
    credits: "3.85",
  },
  {
    time: "2026/6/2 16:06:43~2026/6/2 16:06:59",
    scene: "AccioWork任务",
    session: "查看目录文件",
    credits: "4.18",
  },
  {
    time: "2026/6/2 16:02:28~2026/6/2 16:02:52",
    scene: "AccioWork任务",
    session: "打个招呼",
    credits: "7.77",
  },
  {
    time: "2026/6/2 15:54:22~2026/6/2 15:54:58",
    scene: "AccioWork任务",
    session: "打个招呼",
    credits: "10.30",
  },
];

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
                已用5%
              </span>
            </div>
            <span className="text-xs text-dls-secondary">
              2026年5月27日-2026年6月26日
            </span>
          </div>
          <div className="mb-3 h-1 overflow-hidden rounded-full bg-muted">
            <div className="h-full w-[5%] rounded-full bg-dls-accent" />
          </div>
          <div className="space-y-2 text-sm">
            <BillingMetric
              color="bg-dls-accent"
              label="今日基础积分"
              value="1 / 20"
            />
            <BillingMetric color="bg-dls-signal" label="限时积分" value="0" />
            <BillingMetric color="bg-dls-status-warning" label="补充积分" value="0" />
          </div>
        </section>
        <section className="rounded-xl border border-dls-border bg-dls-surface p-4">
          <h3 className={`mb-4 ${sidePanelTextClass.sectionTitle}`}>近14天消耗</h3>
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
        <h3 className={`mb-3 ${sidePanelTextClass.sectionTitle}`}>用量记录 (20)</h3>
        <div className="overflow-hidden border-t border-dls-border">
          <div className="grid grid-cols-[1.25fr_0.75fr_1.1fr_0.55fr_0.5fr] border-b border-dls-border py-3 text-sm font-medium">
            <div>时间区间</div>
            <div>场景</div>
            <div>会话</div>
            <div>积分</div>
            <div />
          </div>
          {BILLING_USAGE_RECORDS.map((record) => (
            <div
              key={`${record.time}-${record.session}`}
              className="grid grid-cols-[1.25fr_0.75fr_1.1fr_0.55fr_0.5fr] border-b border-dls-border/70 py-4 text-sm last:border-b-0"
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
                查看详情
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
      暂无账单记录
    </section>
  );
}

export function BillingPage() {
  const [activeTab, setActiveTab] = useState<BillingTab>("usage");
  return (
    <div className="h-full overflow-auto bg-dls-surface px-6 py-6 text-dls-text">
      <div className="mx-auto max-w-7xl space-y-5">
        <section className="flex min-h-16 items-center justify-between rounded-xl border border-dls-border bg-dls-surface px-4">
          <h2 className={sidePanelTextClass.panelTitle}>免费版套餐</h2>
          <Button size="lg"
            type="button"
            className="bg-dls-accent hover:bg-dls-decision-hover"
          >
            升级
          </Button>
        </section>
        <div className="flex gap-5 border-b border-dls-border">
          <BillingTabButton
            active={activeTab === "usage"}
            onClick={() => setActiveTab("usage")}
          >
            使用详情
          </BillingTabButton>
          <BillingTabButton
            active={activeTab === "bill"}
            onClick={() => setActiveTab("bill")}
          >
            账单
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

export type StorePrimaryTab = "experts" | "skills";

const storeTabButtonClass =
  "relative z-10 inline-flex h-7 min-w-24 items-center justify-center rounded-md px-3 text-sm font-medium transition-colors mac:titlebar-no-drag";

function StorePrimaryTabs(props: {
  value: StorePrimaryTab;
  onChange: (tab: StorePrimaryTab) => void;
}) {
  const items: Array<{ id: StorePrimaryTab; label: string }> = [
    { id: "experts", label: t("store.experts_marketplace") },
    { id: "skills", label: t("store.skills_marketplace") },
  ];
  const activeIndex = items.findIndex((item) => item.id === props.value);
  const indicatorTransform =
    activeIndex === 1
        ? "translateX(6.125rem)"
        : "translateX(0)";

  return (
    <div className="relative grid w-fit grid-cols-2 items-center gap-0.5 rounded-md bg-dls-surface-muted p-0.5 mac:titlebar-no-drag">
      <span
        className="pointer-events-none absolute bottom-0.5 left-0.5 top-0.5 w-24 rounded-sm bg-dls-surface transition-transform duration-200 ease-out"
        style={{ transform: indicatorTransform }}
        aria-hidden
      />
      {items.map((item) => {
        const active = props.value === item.id;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => props.onChange(item.id)}
            className={cn(
              storeTabButtonClass,
              active
                ? "text-dls-text"
                : "text-dls-secondary hover:bg-dls-hover hover:text-dls-text",
            )}
            aria-pressed={active}
          >
            <span className="truncate">{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function StorePage(props: {
  workspaceId: string;
  workspaceRoot?: string | null;
  client?: OpenworkServerClient | null;
  activeTab?: StorePrimaryTab;
  myExperts?: ExpertMarketplaceEntry[];
  onActiveTabChange?: (tab: StorePrimaryTab) => void;
  onSummonMarketplaceExpert?: (expert: ExpertMarketplaceEntry) => void;
  onCreateExpert?: () => void;
}) {
  const { showToast } = useStatusToasts();
  const skillUploadInputRef = useRef<HTMLInputElement>(null);
  const [uncontrolledActiveTab, setUncontrolledActiveTab] =
    useState<StorePrimaryTab>(props.activeTab ?? "experts");
  const [expertView, setExpertView] = useState<ExpertMarketplaceView>("market");
  const [query, setQuery] = useState("");
  const activeTab = props.activeTab ?? uncontrolledActiveTab;

  useEffect(() => {
    if (props.activeTab) setUncontrolledActiveTab(props.activeTab);
  }, [props.activeTab]);

  const handleTabChange = (tab: StorePrimaryTab) => {
    setUncontrolledActiveTab(tab);
    props.onActiveTabChange?.(tab);
    if (tab !== "experts") setExpertView("market");
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
      <div className="flex h-12 shrink-0 items-center justify-between gap-4 border-b border-dls-border bg-dls-surface/80 px-6 mac:titlebar-drag">
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
        ) : (
          <StorePrimaryTabs value={activeTab} onChange={handleTabChange} />
        )}
        <div className="flex min-w-0 items-center gap-2.5 mac:titlebar-no-drag">
          {expertView === "market" ? (
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
              className="rounded-md mac:titlebar-no-drag"
            >
              {t("session.my_experts")}
            </Button>
          ) : activeTab === "skills" ? (
            <>
              <input
                ref={skillUploadInputRef}
                type="file"
                className="hidden"
                accept=".md,.json,.zip,.tar,.tgz,.gz"
                onChange={(event) => {
                  event.currentTarget.value = "";
                }}
              />
              <Button
                type="button"
                size="sm"
                onClick={() => skillUploadInputRef.current?.click()}
                className="rounded-md mac:titlebar-no-drag"
              >
                <Upload data-icon="inline-start" className="size-4" />
                {t("store.add_skill")}
              </Button>
            </>
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
            workspaceRoot={props.workspaceRoot}
            query={query}
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
        <div className={sidePanelTextClass.panelTitle}>开发中</div>
        <div className="text-sm text-dls-secondary">敬请期待</div>
      </div>
    </div>
  );
}
