/** @jsxImportSource react */
import { MonitorSmartphone } from "lucide-react";

import { surfaceCardClass } from "../shared/modal-styles";
import { registerExtensionConfig } from "./extension-registry";
import { APP_NAME } from "../../../i18n/locales/brand";

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
        <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-dls-accent" />
        <div className="space-y-1 text-sm leading-relaxed text-dls-secondary">
          <div className="font-medium text-dls-text">Ready by default</div>
          <div>
            The {APP_NAME} Browser runs inside the app, opens visibly for
            browser tasks, and is the supported browser automation path in
            {APP_NAME}.
          </div>
        </div>
      </div>
    </div>
  );
}
