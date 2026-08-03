/** @jsxImportSource react */
/**
 * M5ui — Connect company (OnMyCompany) settings panel.
 * Stores BaseUrl/session in localStorage for the renderer; pulls org config via HTTP.
 */
import { useCallback, useEffect, useState } from "react";
import { Building2, LogIn, LogOut, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
};

type CompanyViewProps = {
  busy?: boolean;
};

function readSettings(): CompanySettings {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as CompanySettings;
  } catch {
    return {};
  }
}

function writeSettings(next: CompanySettings): CompanySettings {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  return next;
}

function normalizeBaseUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

export function CompanySettingsView(_props: CompanyViewProps) {
  const [settings, setSettings] = useState<CompanySettings>(() => readSettings());
  const [baseUrl, setBaseUrl] = useState(settings.companyBaseUrl || "http://127.0.0.1:3000");
  const [email, setEmail] = useState(settings.email || "admin@company.internal");
  const [code, setCode] = useState("000000");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [health, setHealth] = useState<string | null>(null);
  const [usage, setUsage] = useState<string | null>(null);

  const refreshHealth = useCallback(async () => {
    const root = normalizeBaseUrl(baseUrl);
    if (!root) return;
    try {
      const res = await fetch(`${root}/api/company/health`);
      if (!res.ok) throw new Error(`health ${res.status}`);
      const body = (await res.json()) as { orgId?: string; version?: string };
      setHealth(`ok · org ${body.orgId || "default"} · ${body.version || ""}`);
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
      const manifestRes = await fetch(`${root}/api/org/config/manifest`, {
        headers: { authorization: `Bearer ${body.token}` },
      });
      const manifest = manifestRes.ok
        ? ((await manifestRes.json()) as { version?: string })
        : {};
      const next = writeSettings({
        companyBaseUrl: root,
        memberToken: body.token,
        memberId: body.member?.id,
        email: body.member?.email || email,
        activeProfile: "company",
        lastSyncedVersion: manifest.version,
      });
      setSettings(next);
      setStatus(`已连接 · member ${next.memberId || ""} · config ${manifest.version || ""}`);
      try {
        const usageRes = await fetch(`${root}/api/company/usage`, {
          headers: { authorization: `Bearer ${body.token}` },
        });
        if (usageRes.ok) {
          const u = (await usageRes.json()) as { totalRuns?: number; failedRuns?: number };
          setUsage(`用量：${u.totalRuns ?? 0} 次运行 · ${u.failedRuns ?? 0} 失败`);
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
      const next = writeSettings({
        companyBaseUrl: normalizeBaseUrl(baseUrl) || settings.companyBaseUrl,
        activeProfile: "local",
      });
      setSettings(next);
      setStatus("已断开，回到 local");
      setUsage(null);
    } finally {
      setLoading(false);
    }
  }

  const connected = Boolean(settings.memberToken && settings.activeProfile === "company");

  return (
    <LayoutStack className="mx-auto w-full max-w-2xl gap-4">
      <SettingsSurfaceCard size="compact" tone="surface" className="p-4">
        <div className="mb-3 flex items-center gap-2">
          <Building2 size={16} className="text-dls-secondary" />
          <div>
            <div className="text-sm font-medium text-dls-text">连接公司 (OnMyCompany)</div>
            <p className="text-xs text-dls-secondary">
              设置 companyBaseUrl，登录后拉取组织配置。未登录保持本机可用。
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
            <div>activeProfile: {settings.activeProfile || "local"}</div>
            <div>memberId: {settings.memberId || "—"}</div>
            <div>lastSyncedVersion: {settings.lastSyncedVersion || "—"}</div>
            <div className="mt-1">
              个人 Skills 在本机 `profiles/local/config/skills/mine`；company 模式默认可叠加（policy.skills.allowPersonal）。
            </div>
          </div>
        </div>
      </SettingsSurfaceCard>
    </LayoutStack>
  );
}
