/** @jsxImportSource react */
/**
 * M5ui — Connect company (OnMyCompany) settings panel.
 * Durable store: Electron IPC → company-client company-settings.json.
 * Non-desktop fallback: localStorage (dev/browser only).
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, LogIn, LogOut, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { desktopBridge } from "../../../../app/lib/desktop";
import { isDesktopRuntime } from "../../../../app/utils";
import { SettingsCard as SettingsSurfaceCard } from "../settings-section";
import { LayoutStack } from "../settings-layout";

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
      // Mirror to localStorage for same-session UI consistency
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
    } catch {
      const current = readLocalFallback();
      return writeLocalFallback({
        companyBaseUrl: current.companyBaseUrl,
        activeProfile: "local",
      });
    }
  }
  const current = readLocalFallback();
  return writeLocalFallback({
    companyBaseUrl: current.companyBaseUrl,
    activeProfile: "local",
  });
}

export function CompanySettingsView(_props: CompanyViewProps) {
  const [settings, setSettings] = useState<CompanySettings>({});
  // Default matches common local OMC; override via health probe / saved settings.
  const [baseUrl, setBaseUrl] = useState("http://127.0.0.1:3100");
  const [email, setEmail] = useState("admin@company.internal");
  const [code, setCode] = useState("000000");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);
  const [storeMode, setStoreMode] = useState<"desktop" | "local">("local");

  useEffect(() => {
    void (async () => {
      const loaded = await readDurableSettings();
      setSettings(loaded);
      if (loaded.companyBaseUrl) setBaseUrl(loaded.companyBaseUrl);
      if (loaded.email) setEmail(loaded.email);
      setStoreMode(isDesktopRuntime() ? "desktop" : "local");
    })();
  }, []);

  const refreshHealth = useCallback(async () => {
    const root = normalizeBaseUrl(baseUrl);
    if (!root) return;
    try {
      const res = await fetch(`${root}/api/company/health`);
      if (!res.ok) throw new Error(`health ${res.status}`);
      const body = (await res.json()) as { orgId?: string; version?: string };
      setHealth(`ok · org ${body.orgId || "default"} · ${body.version || ""}`);
      setError(null);
    } catch (err) {
      setHealth(null);
      setError(err instanceof Error ? err.message : "Health check failed");
    }
  }, [baseUrl]);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  async function connect(): Promise<void> {
    setLoading(true);
    setError(null);
    setStatus(null);
    try {
      const root = normalizeBaseUrl(baseUrl);
      // Persist BaseUrl first so disconnect keeps it.
      await writeDurableSettings({ companyBaseUrl: root });

      if (isDesktopRuntime()) {
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
        setStatus(
          `已连接 · ${next.email || email} · 配置 ${result.pulled?.version || next.lastSyncedVersion || ""} · 技能/专家见「公司」栏目`,
        );
      } else {
        // Browser fallback: login only (no disk mirror).
        await fetch(`${root}/api/company/auth/email/start`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email }),
        });
        const verify = await fetch(`${root}/api/company/auth/email/verify`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email, code }),
        });
        if (!verify.ok) throw new Error(`login ${verify.status}: ${await verify.text()}`);
        const body = (await verify.json()) as {
          token: string;
          member?: { id?: string; email?: string };
        };
        const next = await writeDurableSettings({
          companyBaseUrl: root,
          memberToken: body.token,
          memberId: body.member?.id,
          email: body.member?.email || email,
          activeProfile: "company",
          lastSyncedAt: new Date().toISOString(),
        });
        setSettings(next);
        setStatus(`已连接 · ${next.email || email}（浏览器无磁盘镜像）`);
      }
      try {
        const token = (await readDurableSettings()).memberToken;
        if (token) {
          const usageRes = await fetch(`${root}/api/company/usage`, {
            headers: { authorization: `Bearer ${token}` },
          });
          if (usageRes.ok) {
            const u = (await usageRes.json()) as { totalRuns?: number; failedRuns?: number };
            setUsage(`用量：${u.totalRuns ?? 0} 次运行 · ${u.failedRuns ?? 0} 失败`);
          }
        }
      } catch {
        setUsage(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Connect failed");
    } finally {
      setLoading(false);
    }
  }

  async function syncConfig(): Promise<void> {
    if (!isDesktopRuntime()) return;
    setLoading(true);
    setError(null);
    try {
      const result = (await desktopBridge.companySyncConfig()) as {
        settings?: CompanySettings;
        pulled?: { version?: string };
      };
      if (result.settings) setSettings(result.settings);
      setStatus(`已同步配置 · ${result.pulled?.version || result.settings?.lastSyncedVersion || ""}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setLoading(false);
    }
  }

  async function disconnect(): Promise<void> {
    setLoading(true);
    setError(null);
    try {
      const root = normalizeBaseUrl(settings.companyBaseUrl || baseUrl);
      if (root && settings.memberToken) {
        await fetch(`${root}/api/company/auth/logout`, {
          method: "POST",
          headers: { authorization: `Bearer ${settings.memberToken}` },
        }).catch(() => undefined);
      }
      // Ensure BaseUrl is persisted before disconnect clears session
      await writeDurableSettings({
        companyBaseUrl: normalizeBaseUrl(baseUrl) || settings.companyBaseUrl,
      });
      const next = await disconnectDurable();
      setSettings(next);
      setStatus("已断开，回到 local（BaseUrl 保留）");
      setUsage(null);
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
              placeholder="http://127.0.0.1:3000"
            />
          </div>
          <div className="grid gap-1.5 sm:grid-cols-2 sm:gap-3">
            <div className="grid gap-1.5">
              <Label htmlFor="company-email">邮箱</Label>
              <Input
                id="company-email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={connected}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="company-otp">OTP</Label>
              <Input
                id="company-otp"
                value={code}
                onChange={(e) => setCode(e.target.value)}
                disabled={connected}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {!connected ? (
              <Button size="sm" disabled={loading} onClick={() => void connect()}>
                <LogIn size={14} />
                登录并连接
              </Button>
            ) : (
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void disconnect()}>
                <LogOut size={14} />
                断开
              </Button>
            )}
            {connected && isDesktopRuntime() ? (
              <Button size="sm" variant="outline" disabled={loading} onClick={() => void syncConfig()}>
                <RefreshCw size={14} />
                同步配置
              </Button>
            ) : null}
            <Button size="sm" variant="outline" disabled={loading} onClick={() => void refreshHealth()}>
              <RefreshCw size={14} />
              探活
            </Button>
          </div>

          {health ? <p className="text-xs text-dls-secondary">Health: {health}</p> : null}
          {status ? <p className="text-xs text-emerald-700 dark:text-emerald-400">{status}</p> : null}
          {usage ? <p className="text-xs text-dls-secondary">{usage}</p> : null}
          {error ? <p className="text-xs text-red-600">{error}</p> : null}

          <div className="rounded-lg border border-dls-border bg-dls-surface-muted/40 px-3 py-2 text-xs text-dls-secondary">
            <div>状态：{connected ? "已连接 · 公司栏目可用" : "未连接 · 仅本机"}</div>
            <div>store: {storeMode === "desktop" ? "company-settings.json" : "localStorage"}</div>
            <div>memberId: {settings.memberId || "—"}</div>
            <div>config version: {settings.lastSyncedVersion || "—"}</div>
            <div className="mt-1">
              本机技能/专家不变；公司下发写入 profiles/company/config，在列表「公司」Tab 展示。
            </div>
          </div>
        </div>
      </SettingsSurfaceCard>
    </LayoutStack>
  );
}
