/** @jsxImportSource react */
import { useCallback, useEffect, useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Globe,
  RefreshCw,
  Terminal,
} from "lucide-react";

import { desktopBridge } from "../../../app/lib/desktop";
import { Button } from "@/components/ui/button";
import { busySpinClass } from "@/components/ui/busy-spin";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { NoticeBox } from "@/components/ui/notice-box";
import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { registerExtensionConfig } from "./extension-registry";

type BrowserSkillStatus = {
  ok: boolean;
  installed: boolean;
  extensionConnected: boolean;
  version: string | null;
  binaryPath?: string | null;
  message: string;
  doctorSummary?: string | null;
  installCliUrl: string;
  chromeWebStoreUrl: string;
  docsUrl: string;
};

function hasDesktopBridge() {
  return (
    typeof window !== "undefined" &&
    Boolean(window.__ONMYAGENT_ELECTRON__?.invokeDesktop)
  );
}

registerExtensionConfig("browser-skill", () => <BrowserSkillConfig />);
registerExtensionConfig("onmyagent.browserSkill.settings", () => (
  <BrowserSkillConfig />
));

export function BrowserSkillConfig() {
  const [status, setStatus] = useState<BrowserSkillStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!hasDesktopBridge()) {
      setStatus(null);
      setError(t("extensions.browser_skill_desktop_only"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const raw = (await desktopBridge.checkBrowserSkillStatus()) as BrowserSkillStatus;
      setStatus(raw);
    } catch (cause) {
      setStatus(null);
      setError(
        cause instanceof Error ? cause.message : t("settings.unreadable_response"),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const openTarget = async (target: "cli" | "extension" | "docs") => {
    if (!hasDesktopBridge()) return;
    try {
      await desktopBridge.openBrowserSkillInstallPage(target);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : t("settings.unreadable_response"),
      );
    }
  };

  const ready = status?.ok === true;

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-dls-text">
            {t("extensions.browser_skill_name")}
          </h3>
          <p className="mt-1 text-sm text-dls-secondary">
            {t("extensions.browser_skill_panel_description")}
          </p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={() => void refresh()}
          disabled={busy}
          aria-label={t("extensions.browser_skill_run_doctor")}
        >
          <RefreshCw className={busySpinClass(busy)} />
        </Button>
      </div>

      {error ? (
        <NoticeBox tone="error" size="content">
          {error}
        </NoticeBox>
      ) : null}

      <div className="grid gap-3">
        <Card variant="outline" size="sm">
          <CardHeader>
            <Terminal className="size-4 text-dls-accent" aria-hidden />
            <CardTitle>{t("extensions.browser_skill_cli_label")}</CardTitle>
            <CardDescription>
              {status?.binaryPath || "bsk"}
              {status?.version ? ` · ${status.version}` : ""}
            </CardDescription>
            <CardAction>
              <StatusBadge
                tone={status?.installed ? "success" : "neutral"}
                shape="soft"
                size="tiny"
              >
                {status?.installed
                  ? t("extensions.browser_skill_status_installed")
                  : t("extensions.browser_skill_status_missing")}
              </StatusBadge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              variant="secondary"
              onClick={() => void openTarget("docs")}
            >
              <ExternalLink className="size-3.5" />
              {t("extensions.browser_skill_open_docs")}
            </Button>
          </CardContent>
        </Card>

        <Card variant="outline" size="sm">
          <CardHeader>
            <Globe className="size-4 text-dls-accent" aria-hidden />
            <CardTitle>{t("extensions.browser_skill_extension_label")}</CardTitle>
            <CardDescription>
              {t("extensions.browser_skill_extension_hint")}
            </CardDescription>
            <CardAction>
              <StatusBadge
                tone={status?.extensionConnected ? "success" : "neutral"}
                shape="soft"
                size="tiny"
              >
                {status?.extensionConnected
                  ? t("extensions.browser_skill_status_connected")
                  : t("extensions.browser_skill_status_disconnected")}
              </StatusBadge>
            </CardAction>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="sm"
              onClick={() => void openTarget("extension")}
            >
              <ExternalLink className="size-3.5" />
              {t("extensions.browser_skill_install_extension")}
            </Button>
          </CardContent>
        </Card>

        <Card variant="outline" size="sm">
          <CardHeader>
            {ready ? (
              <CheckCircle2 className="size-4 text-dls-status-success-fg" aria-hidden />
            ) : (
              <CircleAlert className="size-4 text-dls-secondary" aria-hidden />
            )}
            <CardTitle>{t("extensions.browser_skill_health_title")}</CardTitle>
            <CardDescription>
              {status?.message || t("extensions.browser_skill_health_pending")}
            </CardDescription>
            <CardAction>
              <StatusBadge
                tone={ready ? "success" : "warning"}
                shape="soft"
                size="tiny"
              >
                {ready
                  ? t("extensions.browser_skill_status_ready")
                  : t("extensions.browser_skill_status_setup")}
              </StatusBadge>
            </CardAction>
          </CardHeader>
          {status?.doctorSummary ? (
            <CardContent>
              <pre className="max-h-40 overflow-auto whitespace-pre-wrap rounded-lg bg-dls-surface-muted p-3 text-xs text-dls-secondary">
                {status.doctorSummary}
              </pre>
            </CardContent>
          ) : null}
        </Card>
      </div>

      <NoticeBox tone="info" size="content">
        {t("extensions.browser_skill_vs_in_app")}
      </NoticeBox>

      <div className="rounded-lg border border-dls-border bg-dls-surface-muted p-3 text-xs text-dls-secondary">
        <p className="font-medium text-dls-text">
          {t("extensions.browser_skill_install_cli_title")}
        </p>
        <pre className="mt-2 overflow-x-auto whitespace-pre-wrap break-all">
          {`curl -fsSL https://raw.githubusercontent.com/Tencent/BrowserSkill/main/install.sh | sh\nbsk doctor`}
        </pre>
      </div>
    </div>
  );
}
