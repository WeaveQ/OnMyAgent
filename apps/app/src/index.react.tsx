/** @jsxImportSource react */
import * as React from "react";
import ReactDOM from "react-dom/client";

import { getOnMyAgentDeployment } from "./app/lib/onmyagent-deployment";
import "./app/index.css";

const rendererAppPromise = import("./react-app/shell/renderer-app");
const RendererApp = React.lazy(() =>
  rendererAppPromise.then((module) => ({ default: module.RendererApp })),
);
const denBootstrapPromise = import("./app/lib/den").then((module) =>
  module.initializeDenBootstrapConfig(),
);

const root = document.getElementById("root");
const parserBootSurface = document.getElementById("onmyagent-static-boot");

if (!root) {
  throw new Error("Root element not found");
}

root.dataset.onmyagentDeployment = getOnMyAgentDeployment();

function StaticBootHandoff() {
  React.useLayoutEffect(() => {
    // The parser-time surface is a sibling of #root, so createRoot cannot
    // remove it before this first React frame has committed. A layout effect
    // runs before the browser paints that committed frame.
    parserBootSurface?.remove();
  }, []);

  return null;
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

  if (!bootstrapReady) {
    // The parser surface already covers this short desktop-config read. Avoid
    // mounting a second loading page underneath it.
    return null;
  }

  return (
    <React.Suspense fallback={null}>
      <StaticBootHandoff />
      <RendererApp />
    </React.Suspense>
  );
}

ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);
