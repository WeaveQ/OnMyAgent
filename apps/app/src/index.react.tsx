/** @jsxImportSource react */
import * as React from "react";
import ReactDOM from "react-dom/client";
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { initializeDenBootstrapConfig } from "./app/lib/den";
import { getOnMyAgentDeployment } from "./app/lib/onmyagent-deployment";
import { bootstrapTheme } from "./app/theme";
import { isDesktopRuntime } from "./app/utils";
import { initLocale } from "./i18n";
import { getReactQueryClient } from "./react-app/infra/query-client";
import {
  createDefaultPlatform,
  PlatformProvider,
} from "./react-app/kernel/platform";
import { AppProviders } from "./react-app/shell/providers";
import { AppRoot } from "./react-app/shell/app-root";
import { installDevSourceInspector } from "./react-app/shell/dev-source-inspector";
import { startDeepLinkBridge } from "./react-app/shell/startup-deep-links";
import "./app/index.css";

bootstrapTheme();
initLocale();
startDeepLinkBridge();
installDevSourceInspector();
const denBootstrapPromise = initializeDenBootstrapConfig();

const root = document.getElementById("root");

if (!root) {
  throw new Error("Root element not found");
}

root.dataset.onmyagentDeployment = getOnMyAgentDeployment();

const platform = createDefaultPlatform();
const queryClient = getReactQueryClient();
const Router = isDesktopRuntime() ? HashRouter : BrowserRouter;

function BootstrapFallback() {
  // i18n is not ready yet — keep English only so check:i18n:cjk stays clean.
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-dls-surface text-xs text-dls-secondary">
      Starting OnMyAgent…
    </div>
  );
}

function Root() {
  const [bootstrapReady, setBootstrapReady] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    void denBootstrapPromise.finally(() => {
      if (!cancelled) setBootstrapReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!bootstrapReady) return <BootstrapFallback />;

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <PlatformProvider value={platform}>
          <AppProviders>
            <Router>
              <AppRoot />
            </Router>
          </AppProviders>
        </PlatformProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
