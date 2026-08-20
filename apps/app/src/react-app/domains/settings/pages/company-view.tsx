/** @jsxImportSource react */
/**
 * Connect company (OnMyCompany) settings panel.
 * Compact connection panel: identity, metrics, actions.
 * All company HTTP goes through Electron IPC (main process).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, LogIn, LogOut, RefreshCw, Server } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { createBrowserStorageRegistry } from "@/react-app/kernel/storage-registry";
import {
  invokeDesktopCommand,
} from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import type {
  CompanyCatalogSnapshot,
  CompanyConnectResult,
  CompanyHealthResult,
  CompanySessionSnapshot,
  CompanySettingsPatch,
  CompanySyncConfigResult,
} from "@onmyagent/types/desktop-ipc";
import { SettingsNotice } from "../settings-section";
import { LayoutStack } from "../settings-layout";

type CompanySettings = CompanySessionSnapshot;

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function parseCompanySettings(value: unknown): CompanySettings {
  const parsed = isRecord(value) ? value : {};
  return {
    companyBaseUrl: typeof parsed.companyBaseUrl === "string" ? parsed.companyBaseUrl : undefined,
    connected: parsed.connected === true,
    memberId: typeof parsed.memberId === "string" ? parsed.memberId : undefined,
    email: typeof parsed.email === "string" ? parsed.email : undefined,
    activeProfile: parsed.activeProfile === "company" || parsed.activeProfile === "local"
      ? parsed.activeProfile
      : undefined,
    lastSyncedVersion: typeof parsed.lastSyncedVersion === "string" ? parsed.lastSyncedVersion : undefined,
    lastSyncedAt: typeof parsed.lastSyncedAt === "string" ? parsed.lastSyncedAt : undefined,
  };
}

const browserStorage = createBrowserStorageRegistry({
  companySettings: {
    key: "onmyagent.companySettings",
    owner: "settings.company",
    schemaVersion: 1,
    sensitivity: "private",
    defaultValue: {},
    parse: parseCompanySettings,
  },
});

function readLocalFallback(): CompanySettings {
  try {
    return browserStorage.read("companySettings");
  } catch {
    return {};
  }
}

function writeLocalFallback(next: CompanySettings): CompanySettings {
  const safe = parseCompanySettings(next);
  try {
    browserStorage.write("companySettings", safe);
  } catch {
    // Browser storage is a fallback only; desktop IPC remains authoritative.
  }
  return safe;
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
      const result = await invokeDesktopCommand("companySettingsRead");
      return result && typeof result === "object" ? result : {};
    } catch {
      return readLocalFallback();
    }
  }
  return readLocalFallback();
}

async function writeDurableSettings(patch: CompanySettingsPatch): Promise<CompanySettings> {
  if (isDesktopRuntime()) {
    try {
      const result = await invokeDesktopCommand("companySettingsWrite", patch);
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
      const result = await invokeDesktopCommand("companySettingsDisconnect");
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

/** Compact metric tile — label + number only (no subtitle). */
function MetricTile(props: { title: string; value: number }) {
  return (
    <div className="rounded-xl border border-dls-border bg-dls-surface px-3 py-2.5">
      <div className="text-lg font-semibold tabular-nums leading-none text-dls-text">
        {props.value}
      </div>
      <div className="mt-1 text-xs text-dls-secondary">{props.title}</div>
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
  const connected = settings.connected === true;

  const refreshCatalog = useCallback(async () => {
    if (!isDesktopRuntime()) {
      setCatalog(null);
      return;
    }
    try {
      const raw = await invokeDesktopCommand("companyCatalog");
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
      if (loaded.connected) await refreshCatalog();
    })();
  }, [refreshCatalog]);

  const applyHealth = useCallback((body: CompanyHealthResult) => {
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
        const body = await invokeDesktopCommand("companyHealth", root);
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
        const body = await invokeDesktopCommand("companyHealth", root);
        applyHealth(body);
        setError(null);
      } catch (err) {
        setHealth(null);
        setError(formatError(err, t("settings.company_error_health")));
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only when session/settings first applied
  }, [settings.companyBaseUrl, settings.connected]);

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

      const result: CompanyConnectResult = await invokeDesktopCommand("companyConnect", {
        companyBaseUrl: root,
        email,
        code,
      });
      const next = result.settings;
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
        const body = await invokeDesktopCommand("companyHealth", root);
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
      const result: CompanySyncConfigResult = await invokeDesktopCommand("companySyncConfig");
      setSettings(result.settings);
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

  const policyLine = useMemo(() => {
    if (!catalog?.policy) return null;
    const parts = [
      allowActions.length
        ? `${t("settings.company_policy_allow")}: ${allowActions.slice(0, 3).join(", ")}`
        : null,
      denyActions.length
        ? `${t("settings.company_policy_deny")}: ${denyActions.slice(0, 3).join(", ")}`
        : null,
      catalog.policy.egress?.mode
        ? `${t("settings.company_policy_egress")}: ${catalog.policy.egress.mode}`
        : null,
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(" · ") : null;
  }, [allowActions, catalog?.policy, denyActions]);

  return (
    <LayoutStack>
      <section className="flex w-full max-w-3xl flex-col gap-3">
        {connected ? (
          <>
            {/* Single identity + actions card */}
            <div className="rounded-xl border border-dls-border bg-dls-surface px-4 py-3.5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-medium text-dls-text">
                      {displayEmail}
                    </span>
                    <StatusBadge tone="success" size="sm" shape="soft">
                      {t("settings.company_status_badge_connected")}
                    </StatusBadge>
                    {health ? (
                      <StatusBadge
                        tone={health.ok ? "success" : "warning"}
                        size="sm"
                        shape="soft"
                      >
                        {health.ok
                          ? t("settings.company_health_ok")
                          : t("settings.company_health_bad")}
                      </StatusBadge>
                    ) : null}
                  </div>
                  <p className="truncate text-xs text-dls-secondary">
                    {[
                      displayBaseUrl,
                      configVersion !== "—"
                        ? t("settings.company_config_version", {
                            version: configVersion,
                          })
                        : null,
                      syncedAtLabel,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  {policyLine ? (
                    <p className="line-clamp-1 text-xs text-dls-secondary">
                      {policyLine}
                    </p>
                  ) : null}
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
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
                </div>
              </div>

              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                <MetricTile
                  title={t("settings.company_metric_skills")}
                  value={skillCount}
                />
                <MetricTile
                  title={t("settings.company_metric_experts")}
                  value={expertCount}
                />
                <MetricTile
                  title={t("settings.company_metric_gateways")}
                  value={gatewayCount}
                />
                <MetricTile
                  title={t("settings.company_metric_models")}
                  value={modelCount}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dls-border bg-dls-surface px-4 py-4">
            <p className="mb-4 text-sm text-dls-secondary">
              {t("settings.company_desc_disconnected_short")}
            </p>
            <div className="grid gap-3">
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
              </Field>

              <div className="grid gap-3 sm:grid-cols-2">
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
                  disabled={
                    busy || !baseUrl.trim() || !email.trim() || !code.trim()
                  }
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
              {connected ? (
                <div className="flex flex-wrap gap-2 px-4 py-3">
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
                </div>
              ) : null}
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
              {health ? (
                <div className="px-4 py-3">
                  {t("settings.company_health_badge", {
                    org: health.orgId,
                    version: health.version || "—",
                  })}
                </div>
              ) : null}
            </div>
          </CollapsibleContent>
        </Collapsible>
      </section>
    </LayoutStack>
  );
}
