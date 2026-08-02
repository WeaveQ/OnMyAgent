/** @jsxImportSource react */
import { createRoot } from "react-dom/client";

import "../src/app/index.css";
import { setLocale } from "../src/i18n";
import { ExpertCreationPage } from "../src/react-app/domains/agents/expert-creation-page";
import { createDefaultAgentRegistry } from "../src/react-app/domains/agents/agent-registry";
import { createOnMyAgentServerClient } from "../src/app/lib/onmyagent-server";

const params = new URLSearchParams(window.location.search);
const locale = params.get("lang");
if (locale === "en" || locale === "zh" || locale === "zh-TW") {
  setLocale(locale);
  document.documentElement.lang = locale;
}
if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
}

const registry = createDefaultAgentRegistry();
registry.skills = [
  {
    id: "research",
    category: "marketplace",
    group: "analysis",
    name: "research",
    displayNameEn: "Research",
    description: "Find, compare, and synthesize evidence.",
    enabled: true,
  },
  {
    id: "writing",
    category: "marketplace",
    group: "content",
    name: "writing",
    displayNameEn: "Writing",
    description: "Plan and draft clear written content.",
    enabled: true,
  },
];

const fixtureClient = params.get("skillState") === "error"
  ? createOnMyAgentServerClient({ baseUrl: "http://127.0.0.1:1" })
  : null;
const fixtureId = params.get("fixture")?.replace(/[^A-Za-z0-9_-]/g, "-") || "default";

const fixtureOnDone = async () => {
  if (params.get("saveState") === "slow") {
    await new Promise((resolve) => setTimeout(resolve, 1_200));
  }
  if (params.get("saveState") === "error") return Promise.reject();
};

const root = document.getElementById("root");
if (!root) throw new Error("Missing expert creation visual fixture root");

createRoot(root).render(
  <ExpertCreationPage
    workspaceId={`visual-fixture-${fixtureId}`}
    workspaceRoot="/tmp/onmyagent-expert-fixture"
    opencodeBaseUrl={null}
    onmyagentServerToken={null}
    client={fixtureClient}
    registry={registry}
    skills={registry.skills}
    selectedModel={null}
    renderComposer={() => null}
    onClose={() => undefined}
    onDone={fixtureOnDone}
  />,
);
