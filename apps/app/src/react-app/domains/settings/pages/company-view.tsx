/** @jsxImportSource react */
/**
 * Connect company (OnMyCompany) settings panel.
 * Layout aligned with System settings: LayoutStack max-w-3xl, section chrome,
 * IconTile rows, 2-col metric cards, divided list surfaces.
 * All company HTTP goes through Electron IPC (main process).
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Building2,
  ExternalLink,
  LogIn,
  LogOut,
  RefreshCw,
  Server,
  Bot,
  Boxes,
  Cable,
  Cpu,
} from "lucide-react";

import { IconTile } from "@/components/ui/action-row";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { SettingsNotice } from "../settings-section";
import { LayoutStack } from "../settings-layout";

type CompanyCatalogSnapshot = {
  connected?: boolean;
  email?: string;
  memberId?: string;
  lastSyncedVersion?: string;
  lastSyncedAt?: string;
  companyBaseUrl?: string;
  adminConsoleUrl?: string;
  skills?: Array<{ id: string; name: string }>;
  experts?: Array<{ id: string; name: string }>;
  models?: Array<{ id: string; name: string }>;
  gatewayServices?: Array<{ id: string; name: string }>;
  policy?: {
    allowedActions?: string[];
    blockedActions?: string[];
    egress?: { mode?: string };
  } | null;
};

const STORAGE_KEY = "onmyagent.companySettings";

type CompanySettings = {
  companyBaseUrl?: string;
  memberToken?: string;
  memberId?: string;
  email?: string;
  activeProfile?: "local" | "company";
  lastSyncedVersion?: string;
  lastSyncedAt?: string;
};

type CompanyViewProps = {
  busy?: boolean;
};

type HealthInfo = {
  ok: boolean;
  orgId: string;
  version: string;
};

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

function readLocalFallback(): CompanySettings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as CompanySettings;
  } catch {
    return {};
  }
}

function writeLocalFallback(next: CompanySettings): CompanySettings {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function formatError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  if (typeof err === "string" && err.trim()) return err;
  return fallback;
}

function formatRelativeTime(iso?: string): string | null {
  if (!iso) return null;
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return iso;
  const delta = Date.now() - ts;
  if (delta < 60_000) return t("settings.company_synced_just_now");
  if (delta < 3_600_000) {
    return t("settings.company_synced_minutes", {
      count: Math.max(1, Math.floor(delta / 60_000)),
    });
  }
  if (delta < 86_400_000) {
    return t("settings.company_synced_hours", {
      count: Math.max(1, Math.floor(delta / 3_600_000)),
    });
  }
  return t("settings.company_synced_days", {
    count: Math.max(1, Math.floor(delta / 86_400_000)),
  });
}

function isJsonishAction(value: string): boolean {
  const trimmed = value.trim();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function summarizePolicyActions(actions: string[] | undefined): string[] {
  if (!Array.isArray(actions) || actions.length === 0) return [];
  const out: string[] = [];
  for (const raw of actions) {
    const item = String(raw ?? "").trim();
    if (!item) continue;
    if (item === "*") {
      out.push(t("settings.company_policy_allow_all"));
      continue;
    }
    if (isJsonishAction(item)) {
      out.push(t("settings.company_policy_structured"));
      continue;
    }
    out.push(item);
  }
  return Array.from(new Set(out));
}

async function readDurableSettings(): Promise<CompanySettings> {
  if (isDesktopRuntime()) {
    try {
      const result = (await desktopBridge.companySettingsRead()) as CompanySettings;
      return result && typeof result === "object" ? result : {};
    } catch {
      return readLocalFallback();
    }
  }
  return readLocalFallback();
}

async function writeDurableSettings(patch: CompanySettings): Promise<CompanySettings> {
  if (isDesktopRuntime()) {
    try {
      const result = (await desktopBridge.companySettingsWrite(patch)) as CompanySettings;
      writeLocalFallback(result);
      return result;
    } catch {
      return writeLocalFallback({ ...readLocalFallback(), ...patch });
    }
  }
  return writeLocalFallback({ ...readLocalFallback(), ...patch });
}

async function disconnectDurable(): Promise<CompanySettings> {
  if (isDesktopRuntime()) {
    try {
      const result = (await desktopBridge.companySettingsDisconnect()) as CompanySettings;
      writeLocalFallback(result);
      return result;
    } catch (err) {
      const current = readLocalFallback();
      writeLocalFallback({
        companyBaseUrl: current.companyBaseUrl,
        activeProfile: "local",
      });
      throw err instanceof Error ? err : new Error("disconnect failed");
    }
  }
  const current = readLocalFallback();
  return writeLocalFallback({
    companyBaseUrl: current.companyBaseUrl,
    activeProfile: "local",
  });
}

/** Match SystemOptionCard surface: IconTile + title/desc + trailing. */
function MetricCard(props: {
  icon: LucideIcon;
  title: string;
  description: string;
  value: number;
}) {
  const Icon = props.icon;
  return (
    <div
      className={cn(
        "flex min-h-[4.75rem] items-center gap-3 rounded-xl border border-dls-border",
        "bg-dls-surface px-3.5 py-3",
      )}
    >
      <IconTile border className="size-9 shrink-0">
        <Icon size={16} className="text-dls-secondary" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-dls-text">{props.title}</div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
          {props.description}
        </p>
      </div>
      <div className="shrink-0 text-lg font-semibold tabular-nums leading-none text-dls-text">
        {props.value}
      </div>
    </div>
  );
}

function ListRow(props: {
  icon: LucideIcon;
  title: string;
  description: string;
  trailing?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <div className="flex items-center gap-3 px-4 py-3.5">
      <IconTile border className="size-9 shrink-0">
        <Icon size={16} className="text-dls-secondary" />
      </IconTile>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium leading-5 text-dls-text">{props.title}</div>
        <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-dls-secondary">
          {props.description}
        </p>
      </div>
      {props.trailing ? (
        <div className="flex shrink-0 items-center gap-2">{props.trailing}</div>
      ) : null}
    </div>
  );
}

export function CompanySettingsView(props: CompanyViewProps) {
  const hostBusy = props.busy === true;
  const [settings, setSettings] = useState<CompanySettings>({});
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:3100");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [storeMode, setStoreMode] = useState<"desktop" | "local">("local");
  const [catalog, setCatalog] = useState<CompanyCatalogSnapshot | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const busy = loading || hostBusy;
  const connected = Boolean(settings.memberToken);

  const refreshCatalog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setCatalog(null);
      return;
    }
    try {
      const raw = (await desktopBridge.companyCatalog()) as CompanyCatalogSnapshot;
      setCatalog(raw && typeof raw === "object" ? raw : null);
    } catch {
      setCatalog(null);
    }
  }, []);

  useEffect(() => {
    void (async () => {
      const loaded = await readDurableSettings();
      setSettings(loaded);
      if (loaded.companyBaseUrl) setBaseUrl(loaded.companyBaseUrl);
      if (loaded.email) setEmail(loaded.email);
      setStoreMode(isDesktopRuntime() ? "desktop" : "local");
      if (loaded.memberToken) await refreshCatalog();
    })();
  }, [refreshCatalog]);

  const applyHealth = useCallback((body: { orgId?: string; version?: string; ok?: boolean }) => {
    setHealth({
      ok: body.ok !== false,
      orgId: body.orgId || "default",
      version: body.version || "",
    });
  }, []);

  const refreshHealth = useCallback(async () => {
    const root = normalizeBaseUrl(baseUrl);
    if (!root) {
      setError(t("settings.company_error_base_url_required"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      if (isDesktopRuntime()) {
        const body = (await desktopBridge.companyHealth(root)) as {
          orgId?: string;
          version?: string;
          ok?: boolean;
        };
        applyHealth(body);
      } else {
        const res = await fetch(`${root}/api/company/health`);
        if (!res.ok) throw new Error(`health ${res.status}`);
        const body = (await res.json()) as { orgId?: string; version?: string };
        applyHealth(body);
      }
      setStatus(null);
    } catch (err) {
      setHealth(null);
      setError(formatError(err, t("settings.company_error_health")));
    } finally {
      setLoading(false);
    }
  }, [applyHealth, baseUrl]);

  useEffect(() => {
    if (!settings.companyBaseUrl && !baseUrl.trim()) return;
    void (async () => {
      const root = normalizeBaseUrl(settings.companyBaseUrl || baseUrl);
      if (!root || !isDesktopRuntime()) return;
      try {
        const body = (await desktopBridge.companyHealth(root)) as {
          orgId?: string;
          version?: string;
          ok?: boolean;
        };
        applyHealth(body);
        setError(null);
      } catch (err) {
        setHealth(null);
        setError(formatError(err, t("settings.company_error_health")));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when session/settings first applied
  }, [settings.companyBaseUrl, settings.memberToken]);

  async function connect(): Promise<void> {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const root = normalizeBaseUrl(baseUrl);
      if (!root) throw new Error(t("settings.company_error_base_url_required"));
      await writeDurableSettings({ companyBaseUrl: root });

      if (!isDesktopRuntime()) {
        throw new Error(t("settings.company_error_desktop_only"));
      }

      const result = (await desktopBridge.companyConnect({
        companyBaseUrl: root,
        email,
        code,
      })) as {
        settings?: CompanySettings;
        pulled?: { version?: string; packagesWritten?: number };
      };
      const next = result.settings ?? (await readDurableSettings());
      setSettings(next);
      const packagesWritten =
        typeof result.pulled?.packagesWritten === "number"
          ? result.pulled.packagesWritten
          : undefined;
      setStatus(
        t("settings.company_status_connected", {
          email: next.email || email,
          version: result.pulled?.version || next.lastSyncedVersion || "—",
          packages:
            packagesWritten != null
              ? t("settings.company_status_packages", { count: packagesWritten })
              : "",
        }),
      );
      try {
        const body = (await desktopBridge.companyHealth(root)) as {
          orgId?: string;
          version?: string;
          ok?: boolean;
        };
        applyHealth(body);
      } catch {
        // non-fatal
      }
      await refreshCatalog();
    } catch (err) {
      setError(formatError(err, t("settings.company_error_connect")));
    } finally {
      setLoading(false);
    }
  }

  async function syncConfig(): Promise<void> {
    if (!isDesktopRuntime()) {
      setError(t("settings.company_error_sync_desktop_only"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = (await desktopBridge.companySyncConfig()) as {
        settings?: CompanySettings;
        pulled?: { version?: string };
      };
      if (result.settings) setSettings(result.settings);
      setStatus(
        t("settings.company_status_synced", {
          version:
            result.pulled?.version || result.settings?.lastSyncedVersion || "—",
        }),
      );
      await refreshCatalog();
    } catch (err) {
      setError(formatError(err, t("settings.company_error_sync")));
    } finally {
      setLoading(false);
    }
  }

  async function disconnect(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      await writeDurableSettings({
        companyBaseUrl: normalizeBaseUrl(baseUrl) || settings.companyBaseUrl,
      });
      const next = await disconnectDurable();
      setSettings(next);
      setStatus(t("settings.company_status_disconnected"));
      setHealth(null);
      setCatalog(null);
    } catch (err) {
      const loaded = await readDurableSettings();
      setSettings(loaded);
      setError(formatError(err, t("settings.company_error_disconnect")));
    } finally {
      setLoading(false);
    }
  }

  function openAdminConsole(url: string): void {
    const openExternal = window.__ONMYAGENT_ELECTRON__?.shell?.openExternal;
    if (openExternal) {
      void openExternal(url);
      return;
    }
    window.open(url, "_blank", "noopener,noreferrer");
  }

  const displayEmail = catalog?.email || settings.email || email || "—";
  const displayBaseUrl =
    catalog?.companyBaseUrl || settings.companyBaseUrl || baseUrl || "—";
  const configVersion =
    catalog?.lastSyncedVersion || settings.lastSyncedVersion || "—";
  const syncedAtLabel = formatRelativeTime(
    catalog?.lastSyncedAt || settings.lastSyncedAt,
  );

  const allowActions = useMemo(
    () => summarizePolicyActions(catalog?.policy?.allowedActions),
    [catalog?.policy?.allowedActions],
  );
  const denyActions = useMemo(
    () => summarizePolicyActions(catalog?.policy?.blockedActions),
    [catalog?.policy?.blockedActions],
  );

  const skillCount = catalog?.skills?.length ?? 0;
  const expertCount = catalog?.experts?.length ?? 0;
  const modelCount = catalog?.models?.length ?? 0;
  const gatewayCount = catalog?.gatewayServices?.length ?? 0;

  const gatewayNames =
    catalog?.gatewayServices
      ?.map((s) => s.name || s.id)
      .filter(Boolean)
      .slice(0, 4) ?? [];
  const modelNames =
    catalog?.models
      ?.map((m) => m.name || m.id)
      .filter(Boolean)
      .slice(0, 6) ?? [];

  return (
    <LayoutStack>
      {/* Connection section — same chrome as System options */}
      <section className="flex w-full max-w-3xl flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <h3 className="flex flex-wrap items-center gap-2 text-lg font-medium leading-7 text-dls-text">
              {t("settings.company_connection_section_title")}
              <StatusBadge
                tone={connected ? "success" : "neutral"}
                size="sm"
                shape="soft"
              >
                {connected
                  ? t("settings.company_status_badge_connected")
                  : t("settings.company_status_badge_disconnected")}
              </StatusBadge>
              {health ? (
                <StatusBadge
                  tone={health.ok ? "success" : "warning"}
                  size="sm"
                  shape="soft"
                >
                  {t("settings.company_health_badge", {
                    org: health.orgId,
                    version: health.version || "—",
                  })}
                </StatusBadge>
              ) : null}
            </h3>
            <p className="max-w-[52ch] text-sm leading-5 text-dls-secondary">
              {connected
                ? t("settings.company_desc_connected")
                : t("settings.company_desc_disconnected")}
            </p>
          </div>
          {connected ? (
            <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
              {catalog?.adminConsoleUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => openAdminConsole(catalog.adminConsoleUrl!)}
                >
                  <ExternalLink data-icon="inline-start" className="size-3.5" />
                  {t("settings.company_open_admin")}
                </Button>
              ) : null}
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void refreshHealth()}
              >
                <Server data-icon="inline-start" className="size-3.5" />
                {t("settings.company_probe")}
              </Button>
              {isDesktopRuntime() ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => void syncConfig()}
                >
                  <RefreshCw
                    data-icon="inline-start"
                    className={cn("size-3.5", loading && "animate-spin")}
                  />
                  {t("settings.company_sync")}
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {connected ? (
          <>
            {/* Identity row — same divided list surface as system authorizations */}
            <div
              className={cn(
                "overflow-hidden rounded-xl border border-dls-border bg-dls-surface",
                "divide-y divide-dls-border",
              )}
            >
              <ListRow
                icon={Building2}
                title={t("settings.company_connected_as", { email: displayEmail })}
                description={[
                  displayBaseUrl,
                  t("settings.company_config_version", { version: configVersion }),
                  syncedAtLabel,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                trailing={
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                    onClick={() => void disconnect()}
                  >
                    <LogOut data-icon="inline-start" className="size-3.5" />
                    {loading
                      ? t("settings.company_working")
                      : t("settings.company_disconnect")}
                  </Button>
                }
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <MetricCard
                icon={Boxes}
                title={t("settings.company_metric_skills")}
                description={t("settings.company_metric_skills_desc")}
                value={skillCount}
              />
              <MetricCard
                icon={Bot}
                title={t("settings.company_metric_experts")}
                description={t("settings.company_metric_experts_desc")}
                value={expertCount}
              />
              <MetricCard
                icon={Cable}
                title={t("settings.company_metric_gateways")}
                description={t("settings.company_metric_gateways_desc")}
                value={gatewayCount}
              />
              <MetricCard
                icon={Cpu}
                title={t("settings.company_metric_models")}
                description={t("settings.company_metric_models_desc")}
                value={modelCount}
              />
            </div>
          </>
        ) : (
          <div
            className={cn(
              "rounded-xl border border-dls-border bg-dls-surface",
              "px-4 py-4",
            )}
          >
            <div className="grid gap-4">
              <Field>
                <FieldLabel htmlFor="company-base-url">
                  {t("settings.company_base_url")}
                </FieldLabel>
                <Input
                  id="company-base-url"
                  value={baseUrl}
                  onChange={(e) => setBaseUrl(e.target.value)}
                  placeholder="http://127.0.0.1:3100"
                  disabled={busy}
                  autoComplete="url"
                />
                <FieldDescription className="text-xs">
                  {t("settings.company_base_url_hint")}
                </FieldDescription>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="company-email">
                    {t("settings.company_email")}
                  </FieldLabel>
                  <Input
                    id="company-email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder={t("settings.company_email_placeholder")}
                    disabled={busy}
                    autoComplete="email"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="company-otp">
                    {t("settings.company_otp")}
                  </FieldLabel>
                  <Input
                    id="company-otp"
                    value={code}
                    onChange={(e) => setCode(e.target.value)}
                    placeholder={t("settings.company_otp_placeholder")}
                    disabled={busy}
                    autoComplete="one-time-code"
                    inputMode="numeric"
                  />
                </Field>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  size="sm"
                  disabled={busy || !baseUrl.trim() || !email.trim() || !code.trim()}
                  onClick={() => void connect()}
                >
                  <LogIn data-icon="inline-start" className="size-3.5" />
                  {loading
                    ? t("settings.company_connecting")
                    : t("settings.company_connect")}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={busy || !baseUrl.trim()}
                  onClick={() => void refreshHealth()}
                >
                  <Server data-icon="inline-start" className="size-3.5" />
                  {t("settings.company_probe")}
                </Button>
              </div>
            </div>
          </div>
        )}

        {status ? <SettingsNotice tone="success">{status}</SettingsNotice> : null}
        {error ? <SettingsNotice tone="error">{error}</SettingsNotice> : null}
      </section>

      {/* Capability section — same second-section pattern as System permissions */}
      {connected ? (
        <section className="flex w-full max-w-3xl flex-col gap-3">
          <div className="space-y-1">
            <h3 className="text-lg font-medium leading-7 text-dls-text">
              {t("settings.company_capability_title")}
            </h3>
            <p className="max-w-[52ch] text-sm leading-5 text-dls-secondary">
              {t("settings.company_capability_desc")}
            </p>
          </div>

          <div
            className={cn(
              "overflow-hidden rounded-xl border border-dls-border bg-dls-surface",
              "divide-y divide-dls-border",
            )}
          >
            <ListRow
              icon={Cable}
              title={t("settings.company_gateway_section")}
              description={
                gatewayNames.length > 0
                  ? gatewayNames.join(" · ") +
                    (gatewayCount > gatewayNames.length
                      ? t("settings.company_list_more", {
                          count: gatewayCount - gatewayNames.length,
                        })
                      : "")
                  : t("settings.company_gateway_empty")
              }
              trailing={
                <StatusBadge tone="neutral" size="sm">
                  {gatewayCount}
                </StatusBadge>
              }
            />
            <ListRow
              icon={Cpu}
              title={t("settings.company_models_section")}
              description={
                modelNames.length > 0
                  ? modelNames.join(" · ") +
                    (modelCount > modelNames.length
                      ? t("settings.company_list_more", {
                          count: modelCount - modelNames.length,
                        })
                      : "")
                  : t("settings.company_models_empty")
              }
              trailing={
                <StatusBadge tone="neutral" size="sm">
                  {modelCount}
                </StatusBadge>
              }
            />
            <ListRow
              icon={Server}
              title={t("settings.company_policy_title")}
              description={
                catalog?.policy
                  ? [
                      allowActions.length
                        ? `${t("settings.company_policy_allow")}: ${allowActions.slice(0, 4).join(", ")}`
                        : null,
                      denyActions.length
                        ? `${t("settings.company_policy_deny")}: ${denyActions.slice(0, 4).join(", ")}`
                        : null,
                      catalog.policy.egress?.mode
                        ? `${t("settings.company_policy_egress")}: ${catalog.policy.egress.mode}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || t("settings.company_policy_empty")
                  : t("settings.company_policy_empty")
              }
            />
          </div>
        </section>
      ) : null}

      <section className="flex w-full max-w-3xl flex-col gap-2">
        <Collapsible open={advancedOpen} onOpenChange={setAdvancedOpen}>
          <CollapsibleTrigger
            render={
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="w-fit self-start text-dls-secondary"
              />
            }
          >
            {advancedOpen
              ? t("settings.company_advanced_hide")
              : t("settings.company_advanced_show")}
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div
              className={cn(
                "mt-2 overflow-hidden rounded-xl border border-dls-border bg-dls-surface",
                "divide-y divide-dls-border text-xs text-dls-secondary",
              )}
            >
              <div className="px-4 py-3">
                {t("settings.company_adv_store")}:{" "}
                {storeMode === "desktop"
                  ? t("settings.company_adv_store_desktop")
                  : t("settings.company_adv_store_local")}
              </div>
              <div className="px-4 py-3">
                {t("settings.company_adv_member")}: {settings.memberId || "—"}
              </div>
              <div className="px-4 py-3">
                {t("settings.company_adv_base_url")}: {displayBaseUrl}
              </div>
              <div className="px-4 py-3 text-dls-secondary/90">
                {t("settings.company_adv_hint")}
              </div>
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </LayoutStack>
  );
}
