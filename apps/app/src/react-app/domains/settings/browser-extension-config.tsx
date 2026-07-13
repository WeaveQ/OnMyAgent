/** @jsxImportSource react */
import { MonitorSmartphone } from "lucide-react";

import { t } from "@/i18n";
import { surfaceCardClass } from "../../design-system/modal-styles";
import { registerExtensionConfig } from "./extension-registry";

const openWorkBrowserConfigFactory = () => <OnMyAgentBrowserConfig />;

registerExtensionConfig(
  "onmyagent.browser.settings",
  openWorkBrowserConfigFactory,
);
registerExtensionConfig("onmyagent-browser", openWorkBrowserConfigFactory);

function OnMyAgentBrowserConfig() {
  return (
    <div className={`${surfaceCardClass} space-y-3 p-4`}>
      <div className="flex items-start gap-3">
        <MonitorSmartphone aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-dls-accent" />
        <div className="min-w-0 flex-1 space-y-1 text-sm leading-relaxed text-dls-secondary">
          <div className="font-medium text-dls-text">{t("settings.browser_use_title")}</div>
          <div>{t("settings.browser_use_description")}</div>
        </div>
      </div>
    </div>
  );
}
