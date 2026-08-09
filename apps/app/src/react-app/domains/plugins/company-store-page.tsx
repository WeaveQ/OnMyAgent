/** @jsxImportSource react */
/**
 * Store primary tab: Company (OnMyCompany).
 * Visual chrome aligned with Market (shell header, SkillMarketplaceCard grid).
 * Sub-sections: overview / skills / experts / connectors — org-mirrored only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  ExternalLink,
  Network,
  Puzzle,
  RefreshCw,
  Settings2,
  UserRound,
} from "lucide-react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { CountBadge, StatusBadge } from "@/components/ui/status-badge";
import {
  MARKETPLACE_CARD_GRID,
  SkillMarketplaceCard,
} from "@/components/ui/skill-marketplace-card";
import { EmptyStateBox, NoticeBox } from "@/components/ui/notice-box";
import { desktopBridge } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
import { COMPANY_EMPTY_STATE_ASSET } from "@/react-app/design-system/empty-state-assets";
import { EmptyStateIllustration } from "@/react-app/design-system/empty-state-illustration";
import { shellChrome } from "@/react-app/design-system/type-scale";
import { cn } from "@/lib/utils";
import { t } from "@/i18n";

export type CompanyStoreSubTab = "overview" | "skills" | "experts" | "connectors";

type CompanyCatalog = {
  connected?: boolean;
  email?: string;
  memberId?: string;
  companyBaseUrl?: string;
  adminConsoleUrl?: string;
  lastSyncedVersion?: string;
  lastSyncedAt?: string;
  skills?: Array<{ id: string; name: string; description?: string }>;
  experts?: Array<{ id: string; name: string }>;
  models?: Array<{ id: string; name: string }>;
  gatewayServices?: Array<{ id: string; name: string }>;
  policy?: {
    allowedActions?: string[];
    blockedActions?: string[];
    egress?: { mode?: string };
  } | null;
};

function OrgBadge() {
  return (
    <StatusBadge tone="neutral" size="sm" className="shrink-0">
      {t("store.company_org_badge")}
    </StatusBadge>
  );
}

function CompanyEmptyState(props: { title: string; desc: string }) {
  return (
    <EmptyStateBox
      size="spacious"
      tone="muted"
      className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-6"
    >
      <EmptyStateIllustration
        src={COMPANY_EMPTY_STATE_ASSET}
        size="compact"
        className="mb-1"
      />
      <p className="text-base font-medium text-dls-text">{props.title}</p>
      <p className="max-w-sm text-xs leading-5">{props.desc}</p>
    </EmptyStateBox>
  );
}

function CompanyExpertCard(props: { expert: { id: string; name: string } }) {
  return (
    <SkillMarketplaceCard
      skill={{
        id: props.expert.id,
        displayName: props.expert.name,
        packageName: props.expert.id !== props.expert.name ? props.expert.id : undefined,
        description: t("store.company_org_readonly"),
        chips: [t("store.company_org_badge")],
      }}
      ariaLabel={props.expert.name}
      action={<OrgBadge />}
    />
  );
}

function CompanyGatewayCard(props: { id: string; name: string }) {
  return (
    <SkillMarketplaceCard
      skill={{
        id: props.id,
        displayName: props.name,
        packageName: props.id !== props.name ? props.id : undefined,
        description: t("store.company_gateway_card_desc"),
        chips: [t("store.company_badge_gateway")],
      }}
      ariaLabel={props.name}
      action={
        <StatusBadge tone="surface" size="sm" className="shrink-0">
          {t("store.company_badge_gateway")}
        </StatusBadge>
      }
    />
  );
}

function CompanyModelCard(props: { id: string; name: string }) {
  return (
    <SkillMarketplaceCard
      skill={{
        id: props.id,
        displayName: props.name,
        packageName: props.id !== props.name ? props.id : undefined,
        description: t("store.company_model_desc"),
        chips: [t("store.company_badge_model")],
      }}
      ariaLabel={props.name}
      action={
        <StatusBadge tone="surface" size="sm" className="shrink-0">
          {t("store.company_badge_model")}
        </StatusBadge>
      }
    />
  );
}

export function CompanyStorePage(props: {
  query?: string;
  className?: string;
  onOpenCompanySettings?: () => void;
  onChatWithSkill?: (skill: {
    name: string;
    path?: string;
    description?: string;
    displayNameZh?: string;
  }) => void;
}) {
  // Default skills (primary use), not overview — matches market-first usage.
  const [subTab, setSubTab] = useState<CompanyStoreSubTab>("skills");
  const [catalog, setCatalog] = useState<CompanyCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setCatalog({ connected: false });
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const raw = (await desktopBridge.companyCatalog()) as CompanyCatalog;
      setCatalog(raw && typeof raw === "object" ? raw : { connected: false });
    } catch (err) {
      setCatalog({ connected: false });
      setError(err instanceof Error ? err.message : t("store.company_load_failed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const connected = Boolean(catalog?.connected);
  const q = (props.query ?? "").trim().toLowerCase();

  const skills = useMemo(() => {
    const list = catalog?.skills ?? [];
    if (!q) return list;
    return list.filter((s) =>
      `${s.name} ${s.id} ${s.description ?? ""}`.toLowerCase().includes(q),
    );
  }, [catalog?.skills, q]);

  const experts = useMemo(() => {
    const list = catalog?.experts ?? [];
    if (!q) return list;
    return list.filter((e) => `${e.name} ${e.id}`.toLowerCase().includes(q));
  }, [catalog?.experts, q]);

  const connectors = useMemo(() => {
    const list = catalog?.gatewayServices ?? [];
    if (!q) return list;
    return list.filter((c) => `${c.name} ${c.id}`.toLowerCase().includes(q));
  }, [catalog?.gatewayServices, q]);

  const models = useMemo(() => {
    const list = catalog?.models ?? [];
    if (!q) return list;
    return list.filter((m) => `${m.name} ${m.id}`.toLowerCase().includes(q));
  }, [catalog?.models, q]);

  const openAdmin = () => {
    const url = catalog?.adminConsoleUrl;
    if (!url) return;
    const openExternal = window.__ONMYAGENT_ELECTRON__?.shell?.openExternal;
    if (openExternal) {
      void openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  };

  const subItems: Array<{
    id: CompanyStoreSubTab;
    label: string;
    icon: typeof Puzzle;
    count?: number;
  }> = [
    { id: "overview", label: t("store.company_subtab_overview"), icon: Building2 },
    {
      id: "skills",
      label: t("store.company_subtab_skills"),
      icon: Puzzle,
      count: catalog?.skills?.length ?? 0,
    },
    {
      id: "experts",
      label: t("store.company_subtab_experts"),
      icon: UserRound,
      count: catalog?.experts?.length ?? 0,
    },
    {
      id: "connectors",
      label: t("store.company_subtab_connectors"),
      icon: Network,
      count: catalog?.gatewayServices?.length ?? 0,
    },
  ];

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden bg-dls-background",
        props.className,
      )}
    >
      <div className={cn(shellChrome.pageHeader, "border-b-0 mac:titlebar-drag")}>
        <SegmentedTabGroup density="bare" className="mac:titlebar-no-drag">
          {subItems.map((item) => {
            const Icon = item.icon;
            const active = subTab === item.id;
            return (
              <NavTabButton
                key={item.id}
                type="button"
                active={active}
                size="tab"
                shape="tab"
                className="mac:titlebar-no-drag"
                aria-pressed={active}
                aria-current={active ? "page" : undefined}
                onClick={() => setSubTab(item.id)}
              >
                <Icon aria-hidden />
                <span>{item.label}</span>
                {typeof item.count === "number" && item.id !== "overview" ? (
                  <CountBadge size="dot" className="ml-1">
                    {item.count}
                  </CountBadge>
                ) : null}
              </NavTabButton>
            );
          })}
        </SegmentedTabGroup>
        <div className="flex min-w-0 items-center gap-2 mac:titlebar-no-drag">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
            className="mac:titlebar-no-drag"
          >
            <RefreshCw
              data-icon="inline-start"
              className={cn("size-3.5", loading && "animate-spin")}
            />
            {t("store.company_refresh")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onOpenCompanySettings?.()}
            className="mac:titlebar-no-drag"
          >
            <Settings2 data-icon="inline-start" className="size-3.5" />
            {t("store.company_connection_settings")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        {error ? (
          <NoticeBox tone="error" className="mb-3">
            {error}
          </NoticeBox>
        ) : null}

        {!connected ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center">
            <EmptyStateIllustration
              src={COMPANY_EMPTY_STATE_ASSET}
              size="compact"
              className="mb-0"
            />
            <p className="text-base font-medium text-dls-text">
              {t("store.company_not_connected_title")}
            </p>
            <p className="max-w-sm text-sm text-dls-secondary">
              {t("store.company_not_connected_desc")}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => props.onOpenCompanySettings?.()}
            >
              <Settings2 data-icon="inline-start" className="size-3.5" />
              {t("store.company_go_connect")}
            </Button>
          </div>
        ) : subTab === "overview" ? (
          <div className="mx-auto grid max-w-3xl gap-4">
            <div className="rounded-2xl border border-dls-border bg-dls-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-dls-text">
                    {t("store.company_connected_member", {
                      email: catalog?.email || t("store.company_member_fallback"),
                    })}
                  </div>
                  <p className="mt-1 truncate text-xs text-dls-secondary">
                    {catalog?.companyBaseUrl || "—"}
                    {catalog?.lastSyncedVersion
                      ? ` · config ${catalog.lastSyncedVersion}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {catalog?.adminConsoleUrl ? (
                    <Button type="button" size="sm" variant="outline" onClick={openAdmin}>
                      <ExternalLink data-icon="inline-start" className="size-3.5" />
                      {t("store.company_admin_console")}
                    </Button>
                  ) : null}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => props.onOpenCompanySettings?.()}
                  >
                    {t("store.company_connection_settings")}
                  </Button>
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {[
                  {
                    label: t("store.company_subtab_skills"),
                    value: catalog?.skills?.length ?? 0,
                    tab: "skills" as const,
                  },
                  {
                    label: t("store.company_subtab_experts"),
                    value: catalog?.experts?.length ?? 0,
                    tab: "experts" as const,
                  },
                  {
                    label: t("store.company_subtab_connectors"),
                    value: catalog?.gatewayServices?.length ?? 0,
                    tab: "connectors" as const,
                  },
                  {
                    label: t("store.company_metric_models"),
                    value: catalog?.models?.length ?? 0,
                    tab: "connectors" as const,
                  },
                ].map((card) => (
                  <button
                    key={card.label}
                    type="button"
                    className="rounded-2xl border border-transparent bg-dls-surface-muted/40 px-3 py-3 text-left transition-colors hover:border-dls-border hover:bg-dls-list-selected"
                    onClick={() => setSubTab(card.tab)}
                  >
                    <div className="text-lg font-semibold tabular-nums text-dls-text">
                      {card.value}
                    </div>
                    <div className="text-xs text-dls-secondary">{card.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <div className="rounded-2xl border border-dls-border bg-dls-surface p-4 text-xs text-dls-secondary">
              <div className="mb-2 text-sm font-semibold text-dls-text">
                {t("store.company_policy_title")}
              </div>
              {catalog?.policy ? (
                <div className="space-y-1">
                  <div>
                    allow:{" "}
                    {Array.isArray(catalog.policy.allowedActions)
                      ? catalog.policy.allowedActions.join(", ")
                      : "—"}
                  </div>
                  <div>
                    deny:{" "}
                    {Array.isArray(catalog.policy.blockedActions)
                      ? catalog.policy.blockedActions.join(", ")
                      : "—"}
                  </div>
                  {catalog.policy.egress?.mode ? (
                    <div>egress: {catalog.policy.egress.mode}</div>
                  ) : null}
                </div>
              ) : (
                <p>{t("store.company_policy_empty")}</p>
              )}
            </div>
          </div>
        ) : subTab === "skills" ? (
          skills.length > 0 ? (
            <div className={MARKETPLACE_CARD_GRID}>
              {skills.map((skill) => (
                <SkillMarketplaceCard
                  key={skill.id}
                  skill={{
                    id: skill.id,
                    displayName: skill.name,
                    packageName: skill.id !== skill.name ? skill.id : undefined,
                    description:
                      skill.description?.trim() || t("store.company_org_readonly"),
                    chips: [t("store.company_org_badge")],
                  }}
                  ariaLabel={skill.name}
                  action={<OrgBadge />}
                  onClick={
                    props.onChatWithSkill
                      ? () =>
                          props.onChatWithSkill?.({
                            name: skill.id,
                            path: skill.id,
                            description: skill.description || skill.name,
                            displayNameZh: skill.name,
                          })
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <CompanyEmptyState
              title={t("store.company_no_skills_title")}
              desc={t("store.company_no_skills_desc")}
            />
          )
        ) : subTab === "experts" ? (
          experts.length > 0 ? (
            <div className={MARKETPLACE_CARD_GRID}>
              {experts.map((expert) => (
                <CompanyExpertCard key={expert.id} expert={expert} />
              ))}
            </div>
          ) : (
            <CompanyEmptyState
              title={t("store.company_no_experts_title")}
              desc={t("store.company_no_experts_desc")}
            />
          )
        ) : connectors.length > 0 || models.length > 0 ? (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2.5 text-sm font-semibold text-dls-text">
                {t("store.company_gateway_title")}
              </h3>
              {connectors.length > 0 ? (
                <div className={MARKETPLACE_CARD_GRID}>
                  {connectors.map((c) => (
                    <CompanyGatewayCard key={c.id} id={c.id} name={c.name} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dls-secondary">
                  {t("store.company_gateway_empty")}
                </p>
              )}
            </section>
            <section>
              <h3 className="mb-2.5 text-sm font-semibold text-dls-text">
                {t("store.company_models_title")}
              </h3>
              {models.length > 0 ? (
                <div className={MARKETPLACE_CARD_GRID}>
                  {models.map((m) => (
                    <CompanyModelCard key={m.id} id={m.id} name={m.name || m.id} />
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dls-secondary">
                  {t("store.company_models_empty")}
                </p>
              )}
            </section>
          </div>
        ) : (
          <CompanyEmptyState
            title={t("store.company_no_connectors_title")}
            desc={t("store.company_no_connectors_desc")}
          />
        )}
      </div>
    </div>
  );
}
