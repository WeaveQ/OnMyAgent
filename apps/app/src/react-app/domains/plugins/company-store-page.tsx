/** @jsxImportSource react */
/**
 * Store primary tab: Company (OnMyCompany).
 * Sub-sections: overview / skills / experts / connectors — org-mirrored only.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Building2,
  ExternalLink,
  MessageCircle,
  Network,
  Puzzle,
  RefreshCw,
  Settings2,
  UserRound,
} from "lucide-react";

import { NavTabButton, SegmentedTabGroup } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { desktopBridge } from "@/app/lib/desktop";
import { isDesktopRuntime } from "@/app/utils";
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

const GRID =
  "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4";

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
  const [subTab, setSubTab] = useState<CompanyStoreSubTab>("overview");
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
      <div className="flex shrink-0 items-center justify-between gap-2 px-6 pb-1 pt-1">
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
                aria-pressed={active}
                onClick={() => setSubTab(item.id)}
              >
                <Icon className="size-3.5" aria-hidden />
                <span>{item.label}</span>
                {typeof item.count === "number" ? (
                  <span
                    className={cn(
                      "text-xs font-medium tabular-nums",
                      active ? "opacity-70" : "text-dls-secondary",
                    )}
                  >
                    {item.count}
                  </span>
                ) : null}
              </NavTabButton>
            );
          })}
        </SegmentedTabGroup>
        <div className="flex items-center gap-2 mac:titlebar-no-drag">
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={loading}
            onClick={() => void load()}
          >
            <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
            {t("store.company_refresh")}
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={() => props.onOpenCompanySettings?.()}
          >
            <Settings2 className="size-3.5" />
            {t("store.company_connection_settings")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 pb-6 pt-3">
        {error ? (
          <p className="mb-3 text-xs text-red-600">{error}</p>
        ) : null}

        {!connected ? (
          <div className="flex h-full min-h-[240px] flex-col items-center justify-center gap-3 text-center">
            <Building2 className="size-10 text-dls-secondary/60" />
            <p className="text-base font-medium text-dls-text">{t("store.company_not_connected_title")}</p>
            <p className="max-w-sm text-sm text-dls-secondary">
              {t("store.company_not_connected_desc")}
            </p>
            <Button
              type="button"
              size="sm"
              onClick={() => props.onOpenCompanySettings?.()}
            >
              <Settings2 className="size-3.5" />
              {t("store.company_go_connect")}
            </Button>
          </div>
        ) : subTab === "overview" ? (
          <div className="mx-auto grid max-w-3xl gap-4">
            <div className="rounded-xl border border-dls-border bg-dls-surface p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-sm font-medium text-dls-text">
                    {t("store.company_connected_member", { email: catalog?.email || t("store.company_member_fallback") })}
                  </div>
                  <p className="mt-1 text-xs text-dls-secondary">
                    {catalog?.companyBaseUrl || "—"}
                    {catalog?.lastSyncedVersion
                      ? ` · config ${catalog.lastSyncedVersion}`
                      : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {catalog?.adminConsoleUrl ? (
                    <Button type="button" size="sm" variant="outline" onClick={openAdmin}>
                      <ExternalLink className="size-3.5" />
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
              <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { label: t("store.company_subtab_skills"), value: catalog?.skills?.length ?? 0, tab: "skills" as const },
                  { label: t("store.company_subtab_experts"), value: catalog?.experts?.length ?? 0, tab: "experts" as const },
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
                    className="rounded-lg border border-dls-border bg-dls-surface-muted/30 px-3 py-3 text-left hover:bg-dls-list-hover"
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
            <div className="rounded-xl border border-dls-border bg-dls-surface p-4 text-xs text-dls-secondary">
              <div className="mb-2 text-sm font-medium text-dls-text">{t("store.company_policy_title")}</div>
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
            <div className={GRID}>
              {skills.map((skill) => (
                <div
                  key={skill.id}
                  className="rounded-xl border border-dls-border bg-dls-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-dls-text">
                        {skill.name}
                      </div>
                      <p className="mt-1 text-xs text-dls-secondary">
                        {skill.description || t("store.company_org_readonly")}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[10px] text-dls-secondary/80">
                        {skill.id}
                      </p>
                    </div>
                    <StatusBadge tone="neutral" className="shrink-0">
                      {t("store.company_org_badge")}
                    </StatusBadge>
                  </div>
                  {props.onChatWithSkill ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="mt-3"
                      onClick={() =>
                        props.onChatWithSkill?.({
                          name: skill.id,
                          path: skill.id,
                          description: skill.description || skill.name,
                          displayNameZh: skill.name,
                        })
                      }
                    >
                      <MessageCircle className="size-3.5" />
                      {t("store.company_use_in_chat")}
                    </Button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("store.company_no_skills_title")}
              desc={t("store.company_no_skills_desc")}
            />
          )
        ) : subTab === "experts" ? (
          experts.length > 0 ? (
            <div className={GRID}>
              {experts.map((expert) => (
                <div
                  key={expert.id}
                  className="rounded-xl border border-dls-border bg-dls-surface p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-dls-text">
                        {expert.name}
                      </div>
                      <p className="mt-1 text-xs text-dls-secondary">{t("store.company_org_readonly")}</p>
                    </div>
                    <StatusBadge tone="neutral" className="shrink-0">
                      {t("store.company_org_badge")}
                    </StatusBadge>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={t("store.company_no_experts_title")}
              desc={t("store.company_no_experts_desc")}
            />
          )
        ) : connectors.length > 0 || (catalog?.models?.length ?? 0) > 0 ? (
          <div className="space-y-6">
            <section>
              <h3 className="mb-2 text-sm font-medium text-dls-text">{t("store.company_gateway_title")}</h3>
              {connectors.length > 0 ? (
                <div className={GRID}>
                  {connectors.map((c) => (
                    <div
                      key={c.id}
                      className="rounded-xl border border-dls-border bg-dls-surface p-4"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-dls-text">
                            {c.name}
                          </div>
                          <p className="mt-1 text-xs text-dls-secondary">
                            {t("store.company_gateway_card_desc")}
                          </p>
                          <p className="mt-0.5 font-mono text-[10px] text-dls-secondary/80">
                            {c.id}
                          </p>
                        </div>
                        <StatusBadge tone="neutral" className="shrink-0">
                          Gateway
                        </StatusBadge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-dls-secondary">
                  {t("store.company_gateway_empty")}
                </p>
              )}
            </section>
            <section>
              <h3 className="mb-2 text-sm font-medium text-dls-text">{t("store.company_models_title")}</h3>
              {(catalog?.models?.length ?? 0) > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {catalog!.models!.map((m) => (
                    <StatusBadge key={m.id} tone="surface" shape="soft" size="tiny">
                      {m.name || m.id}
                    </StatusBadge>
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
          <EmptyState
            title={t("store.company_no_connectors_title")}
            desc={t("store.company_no_connectors_desc")}
          />
        )}
      </div>
    </div>
  );
}

function EmptyState(props: { title: string; desc: string }) {
  return (
    <div className="flex h-full min-h-[200px] flex-col items-center justify-center gap-2 px-6 text-center text-sm text-dls-secondary">
      <p className="text-base font-medium text-dls-text">{props.title}</p>
      <p className="max-w-sm text-xs leading-5">{props.desc}</p>
    </div>
  );
}
