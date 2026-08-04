/** @jsxImportSource react */
/**
 * Connect company (OnMyCompany) settings panel.
 * All company HTTP goes through Electron IPC (main process).
 * Renderer must not fetch OMC directly — Vite origin → :3100 hits CORS → "Failed to fetch".
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, ExternalLink, LogIn, LogOut, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { SettingsCard as SettingsSurfaceCard } from "../settings-section";
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
      // Local clear even if IPC fails so UI is not stuck "connected"
      const current = readLocalFallback();
      const cleared = writeLocalFallback({
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

export function CompanySettingsView(props: CompanyViewProps) {
  const hostBusy = props.busy === true;
  const [settings, setSettings] = useState<CompanySettings>({});
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:3100");
  const [email, setEmail] = useState("admin@company.internal");
  const [code, setCode] = useState("000000");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<string | null>(null);
  const [storeMode, setStoreMode] = useState<"desktop" | "local">("local");
  const [catalog, setCatalog] = useState<CompanyCatalogSnapshot | null>(null);

  const busy = loading || hostBusy;

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

  const refreshHealth = useCallback(async () => {
    const root = normalizeBaseUrl(baseUrl);
    if (!root) {
      setError("请先填写 Company Base URL");
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
        setHealth(`ok · org ${body.orgId || "default"} · ${body.version || ""}`);
      } else {
        // Browser-only fallback (may fail CORS against local OMC)
        const res = await fetch(`${root}/api/company/health`);
        if (!res.ok) throw new Error(`health ${res.status}`);
        const body = (await res.json()) as { orgId?: string; version?: string };
        setHealth(`ok · org ${body.orgId || "default"} · ${body.version || ""}`);
      }
      setStatus(null);
    } catch (err) {
      setHealth(null);
      setError(formatError(err, "探活失败"));
    } finally {
      setLoading(false);
    }
  }, [baseUrl]);

  // One-shot health after durable settings load (not on every keystroke).
  useEffect(() => {
    if (!settings.companyBaseUrl && !baseUrl.trim()) return;
    void (async () => {
      const root = normalizeBaseUrl(settings.companyBaseUrl || baseUrl);
      if (!root || !isDesktopRuntime()) return;
      try {
        const body = (await desktopBridge.companyHealth(root)) as {
          orgId?: string;
          version?: string;
        };
        setHealth(`ok · org ${body.orgId || "default"} · ${body.version || ""}`);
        setError(null);
      } catch (err) {
        setHealth(null);
        setError(formatError(err, "探活失败"));
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
      if (!root) throw new Error("Company Base URL required");
      await writeDurableSettings({ companyBaseUrl: root });

      if (!isDesktopRuntime()) {
        throw new Error("请在桌面端连接公司（浏览器无法安全拉取配置）");
      }

      const result = (await desktopBridge.companyConnect({
        companyBaseUrl: root,
        email,
        code,
      })) as {
        settings?: CompanySettings;
        pulled?: { version?: string };
      };
      const next = result.settings ?? (await readDurableSettings());
      setSettings(next);
      const packagesWritten =
        result.pulled &&
        typeof (result.pulled as { packagesWritten?: number }).packagesWritten ===
          "number"
          ? (result.pulled as { packagesWritten: number }).packagesWritten
          : undefined;
      setStatus(
        `已连接 · ${next.email || email} · 配置 ${result.pulled?.version || next.lastSyncedVersion || ""}${
          packagesWritten != null ? ` · 技能包 ${packagesWritten}` : ""
        }`,
      );
      try {
        const body = (await desktopBridge.companyHealth(root)) as {
          orgId?: string;
          version?: string;
        };
        setHealth(`ok · org ${body.orgId || "default"} · ${body.version || ""}`);
      } catch {
        // non-fatal
      }
      await refreshCatalog();
    } catch (err) {
      setError(formatError(err, "连接失败"));
    } finally {
      setLoading(false);
    }
  }

  async function syncConfig(): Promise<void> {
    if (!isDesktopRuntime()) {
      setError("同步配置仅桌面端可用");
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
        `已同步配置 · ${result.pulled?.version || result.settings?.lastSyncedVersion || ""}`,
      );
      await refreshCatalog();
    } catch (err) {
      setError(formatError(err, "同步失败"));
    } finally {
      setLoading(false);
    }
  }

  async function disconnect(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      // Persist BaseUrl before session clear
      await writeDurableSettings({
        companyBaseUrl: normalizeBaseUrl(baseUrl) || settings.companyBaseUrl,
      });
      const next = await disconnectDurable();
      setSettings(next);
      setStatus("已断开（BaseUrl 保留）");
      setHealth(null);
      setCatalog(null);
    } catch (err) {
      // Still try to reflect local clear
      const loaded = await readDurableSettings();
      setSettings(loaded);
      setError(formatError(err, "断开失败"));
    } finally {
      setLoading(false);
    }
  }

  const connected = Boolean(settings.memberToken);

  return (
    <LayoutStack className="mx-auto w-full max-w-2xl gap-4">
      <SettingsSurfaceCard size="compact" tone="surface" className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Building2 size={16} className="text-dls-secondary" />
          <div>
            <div className="text-sm font-medium text-dls-text">连接公司 (OnMyCompany)</div>
            <p className="text-xs text-dls-secondary">
              填写内网服务地址并登录后，组织技能/专家会出现在「技能 / 专家」页的
              <span className="text-dls-text"> 公司 </span>
              栏目（本机配置不变，不切换整站模式）。
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          <div className="grid gap-1.5">
            <Label htmlFor="company-base-url">Company Base URL</Label>
            <Input
              id="company-base-url"
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="http://127.0.0.1:3100"
              disabled={busy}
            />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="company-email">邮箱</Label>
              <Input
                id="company-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={connected || busy}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-otp">OTP</Label>
              <Input
                id="company-otp"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={connected || busy}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <Button size="sm" disabled={busy} onClick={() => void connect()}>
                <LogIn size={14} />
                {loading ? "连接中…" : "登录并连接"}
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void disconnect()}
              >
                <LogOut size={14} />
                {loading ? "处理中…" : "断开"}
              </Button>
            )}
            {connected && isDesktopRuntime() ? (
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => void syncConfig()}
              >
                <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
                同步配置
              </Button>
            ) : null}
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void refreshHealth()}
            >
              <RefreshCw size={14} className={loading ? "animate-spin" : undefined} />
              探活
            </Button>
          </div>

          {health ? <p className="text-xs text-dls-secondary">Health: {health}</p> : null}
          {status ? (
            <p className="text-xs text-emerald-700 dark:text-emerald-400">{status}</p>
          ) : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <div className="rounded-lg border border-dls-border bg-dls-surface-muted/40 px-3 py-2 text-xs text-dls-secondary">
            <div>状态：{connected ? "已连接 · 公司栏目可用" : "未连接 · 仅本机"}</div>
            <div>store: {storeMode === "desktop" ? "company-settings.json (IPC)" : "localStorage"}</div>
            <div>memberId: {settings.memberId || "—"}</div>
            <div>config version: {settings.lastSyncedVersion || "—"}</div>
            <div className="mt-1">
              请求经桌面主进程转发。本机技能不变；公司技能/专家在商店页「公司」入口。
            </div>
          </div>

          {connected && catalog ? (
            <div className="grid gap-2 rounded-lg border border-dls-border bg-dls-surface px-3 py-3 text-xs text-dls-secondary">
              <div className="text-sm font-medium text-dls-text">组织能力摘要</div>
              <div>
                技能 {catalog.skills?.length ?? 0} · 专家 {catalog.experts?.length ?? 0} ·
                模型 {catalog.models?.length ?? 0} · Gateway 服务{" "}
                {catalog.gatewayServices?.length ?? 0}
              </div>
              {catalog.policy ? (
                <div>
                  策略：allow{" "}
                  {Array.isArray(catalog.policy.allowedActions)
                    ? catalog.policy.allowedActions.join(", ")
                    : "—"}
                  {Array.isArray(catalog.policy.blockedActions) &&
                  catalog.policy.blockedActions.length
                    ? ` · deny ${catalog.policy.blockedActions.join(", ")}`
                    : ""}
                  {catalog.policy.egress?.mode
                    ? ` · egress ${catalog.policy.egress.mode}`
                    : ""}
                </div>
              ) : null}
              {catalog.gatewayServices && catalog.gatewayServices.length > 0 ? (
                <div>
                  Gateway：
                  {catalog.gatewayServices.map((s) => s.name || s.id).join(" · ")}
                </div>
              ) : (
                <div>Gateway：暂无组织连接（在 OMC 管理台配置应用连接后同步）</div>
              )}
              {catalog.models && catalog.models.length > 0 ? (
                <div>
                  模型目录：
                  {catalog.models
                    .slice(0, 6)
                    .map((m) => m.name || m.id)
                    .join(" · ")}
                  {catalog.models.length > 6 ? " …" : ""}
                </div>
              ) : (
                <div>模型目录：空（仍使用本机已连接模型）</div>
              )}
              {catalog.adminConsoleUrl ? (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  className="mt-1 w-fit"
                  onClick={() => {
                    const url = catalog.adminConsoleUrl!;
                    const openExternal =
                      window.__ONMYAGENT_ELECTRON__?.shell?.openExternal;
                    if (openExternal) {
                      void openExternal(url);
                      return;
                    }
                    window.open(url, "_blank", "noopener,noreferrer");
                  }}
                >
                  <ExternalLink size={14} />
                  打开管理台
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
      </SettingsSurfaceCard>
    </LayoutStack>
  );
}
