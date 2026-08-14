/** @jsxImportSource react */
import { QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, HashRouter } from "react-router-dom";

import { TooltipProvider } from "@/components/ui/tooltip";
import { bootstrapTheme } from "../../app/theme";
import { installWindowsTitlebarInset } from "../../app/windows-titlebar-inset";
import { isDesktopRuntime } from "../../app/utils";
import { initLocale } from "../../i18n";
import { getReactQueryClient } from "../infra/query-client";
import {
  createDefaultPlatform,
  PlatformProvider,
} from "../kernel/platform";
import { AppRoot } from "./app-root";
import { installDevSourceInspector } from "./dev-source-inspector";
import { AppProviders } from "./providers";
import { startDeepLinkBridge } from "./startup-deep-links";

// The parser-time splash already resolves the first-frame theme. These fuller
// renderer services intentionally initialize in the deferred shell chunk so
// desktop-config IPC and heavy application parsing can overlap.
bootstrapTheme();
installWindowsTitlebarInset();
initLocale();
startDeepLinkBridge();
installDevSourceInspector();

const platform = createDefaultPlatform();
const queryClient = getReactQueryClient();
const Router = isDesktopRuntime() ? HashRouter : BrowserRouter;

export function RendererApp() {
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
