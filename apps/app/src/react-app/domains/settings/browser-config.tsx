/** @jsxImportSource react */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Globe, RefreshCw, ShieldCheck, SquareMousePointer } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { registerExtensionConfig } from "./extension-registry";

type BrowserDiagnostics = {
  protocolVersion: number;
  inAppBrowser: boolean;
  rpcListening: boolean;
  backend: "in-app";
  platform: "darwin" | "linux" | "windows";
  openTabs: number;
  agentTabs: number;
};

const browserConfigFactory = () => <BrowserConfig />;

registerExtensionConfig("onmyagent.browser.settings", browserConfigFactory);
registerExtensionConfig("onmyagent-browser", browserConfigFactory);

function CapabilityCard(props: {
  icon: typeof SquareMousePointer;
  title: string;
  description: string;
  status: string;
  ready: boolean;
  children?: ReactNode;
}) {
  const Icon = props.icon;
  return (
    <Card variant="outline" size="sm">
      <CardHeader>
        <Icon className="size-4 text-dls-accent" aria-hidden="true" />
        <CardTitle>{props.title}</CardTitle>
        <CardDescription>{props.description}</CardDescription>
        <CardAction>
          <StatusBadge tone={props.ready ? "success" : "neutral"} shape="soft" size="tiny">
            {props.status}
          </StatusBadge>
        </CardAction>
      </CardHeader>
      {props.children ? <CardContent>{props.children}</CardContent> : null}
    </Card>
  );
}

export function BrowserConfig() {
  const [diagnostics, setDiagnostics] = useState<BrowserDiagnostics | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setBusy(true);
    try {
      const result = await window.__ONMYAGENT_ELECTRON__?.browser?.diagnostics?.();
      setDiagnostics(result ?? null);
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const ready = diagnostics?.inAppBrowser === true && diagnostics.rpcListening;
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-dls-text">{t("settings.browser.title")}</h3>
          <p className="mt-1 text-sm text-dls-secondary">{t("settings.browser.description")}</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={() => void refresh()} disabled={busy} aria-label={t("settings.browser.refresh")}>
          <RefreshCw className={busy ? "animate-spin" : ""} />
        </Button>
      </div>
      <CapabilityCard
        icon={SquareMousePointer}
        title={t("settings.browser.in_app_title")}
        description={t("settings.browser.in_app_description")}
        status={ready ? t("settings.browser.ready") : t("settings.browser.unavailable")}
        ready={ready}
      />
      <CapabilityCard
        icon={Globe}
        title={t("settings.browser.chrome_title")}
        description={t("settings.browser.chrome_description")}
        status={t("settings.browser.local_package")}
        ready={false}
      />
      <CapabilityCard
        icon={ShieldCheck}
        title={t("settings.browser.security_title")}
        description={t("settings.browser.security_description")}
        status={t("settings.browser.enforced")}
        ready={ready}
      />
      <CapabilityCard
        icon={RefreshCw}
        title={t("settings.browser.diagnostics_title")}
        description={t("settings.browser.diagnostics_description")}
        status={diagnostics ? t("settings.browser.connected") : t("settings.browser.unavailable")}
        ready={diagnostics !== null}
      >
        <div className="grid gap-2 text-sm text-dls-secondary sm:grid-cols-3">
          <span>{t("settings.browser.protocol", { value: diagnostics?.protocolVersion ?? "—" })}</span>
          <span>{t("settings.browser.tabs", { value: diagnostics?.openTabs ?? 0 })}</span>
          <span>{t("settings.browser.agent_tabs", { value: diagnostics?.agentTabs ?? 0 })}</span>
        </div>
      </CapabilityCard>
    </div>
  );
}
