/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { MonitorSmartphone } from "lucide-react";

import { StatusBadge } from "@/components/ui/status-badge";
import { t } from "@/i18n";
import { surfaceCardClass } from "../../design-system/modal-styles";
import { registerExtensionConfig } from "./extension-registry";

type BrowserUseStatus = {
  ready: boolean;
  browserUseVersion: string | null;
  browserHarnessVersion: string | null;
};

function normalizeBrowserUseStatus(value: unknown): BrowserUseStatus {
  if (typeof value !== "object" || value === null) {
    return { ready: false, browserUseVersion: null, browserHarnessVersion: null };
  }
  return {
    ready: "ready" in value && value.ready === true,
    browserUseVersion:
      "browserUseVersion" in value && typeof value.browserUseVersion === "string"
        ? value.browserUseVersion
        : null,
    browserHarnessVersion:
      "browserHarnessVersion" in value && typeof value.browserHarnessVersion === "string"
        ? value.browserHarnessVersion
        : null,
  };
}

const openWorkBrowserConfigFactory = () => <OnMyAgentBrowserConfig />;

registerExtensionConfig(
  "onmyagent.browser.settings",
  openWorkBrowserConfigFactory,
);
registerExtensionConfig("onmyagent-browser", openWorkBrowserConfigFactory);

function OnMyAgentBrowserConfig() {
  const [status, setStatus] = useState<BrowserUseStatus | null>(null);

  useEffect(() => {
    let active = true;
    void window.__ONMYAGENT_ELECTRON__?.invokeDesktop?.("browserUseStatus")
      .then((value) => {
        if (active) setStatus(normalizeBrowserUseStatus(value));
      })
      .catch(() => {
        if (active) setStatus(normalizeBrowserUseStatus(null));
      });
    return () => {
      active = false;
    };
  }, []);

  const version = status?.browserUseVersion;
  const badgeLabel = status === null
    ? t("settings.browser_use_checking")
    : status.ready
      ? t("settings.browser_use_ready")
      : t("settings.browser_use_unavailable");

  return (
    <div className={`${surfaceCardClass} space-y-3 p-4`}>
      <div className="flex items-start gap-3">
        <MonitorSmartphone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-dls-accent" />
        <div className="min-w-0 flex-1 space-y-1 text-sm leading-relaxed text-dls-secondary">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-medium text-dls-text">
              {t("settings.browser_use_title")}
            </div>
            <StatusBadge
              role="status"
              tone={status?.ready ? "success" : status === null ? "neutral" : "danger"}
            >
              {badgeLabel}
            </StatusBadge>
          </div>
          <div>{t("settings.browser_use_description")}</div>
          {version ? (
            <div className="text-xs text-dls-text-tertiary">
              {t("settings.browser_use_version", { version })}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
