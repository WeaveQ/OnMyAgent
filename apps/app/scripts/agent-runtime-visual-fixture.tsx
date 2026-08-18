/** @jsxImportSource react */
import { QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";
import { Bot, Settings2 } from "lucide-react";

import "../src/app/index.css";
import { createOnMyAgentServerClient } from "../src/app/lib/onmyagent-server";
import { setLocale } from "../src/i18n";
import { Button } from "../src/components/ui/button";
import { NoticeBox } from "../src/components/ui/notice-box";
import { AgentRuntimeSettingsSection } from "../src/react-app/capabilities/agent-runtime/settings-section";
import { SessionSurfaceHeader } from "../src/react-app/domains/session/surface/chrome/session-surface-header";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { createDefaultPlatform, PlatformProvider } from "../src/react-app/kernel/platform";

const workspaceId = "workspace-fixture";

function applyDisplayOptions() {
  const params = new URLSearchParams(window.location.search);
  const locale = params.get("lang");
  if (locale === "en" || locale === "zh" || locale === "zh-TW") {
    setLocale(locale);
    document.documentElement.lang = locale;
  }
  const dark = params.get("theme") === "dark";
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

function fixtureFetch(input: RequestInfo | URL): Promise<Response> {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (url.pathname === "/agent-runtime/selection") {
    return Promise.resolve(json({
      state: "ok",
      complete: true,
      config: {
        version: 1,
        revision: 7,
        defaultRuntimeKind: "opencode",
        workspaceOverrides: { [workspaceId]: "grok-build" },
        grokBuild: { profileId: "system", homeMode: "system", binaryMode: "system" },
      },
      availableRuntimeKinds: ["opencode", "grok-build"],
      selectableDefaultRuntimeKinds: ["opencode", "grok-build"],
      selectableWorkspaceRuntimeKinds: ["opencode", "grok-build"],
      health: [
        {
          health: { runtimeKind: "opencode", health: "ready", checkedAt: 1 },
          capabilities: { protocolVersion: "http", nativeVersion: "1.17.20", features: ["session.create", "turn.prompt", "turn.cancel"] },
        },
        {
          health: { runtimeKind: "grok-build", health: "ready", checkedAt: 1 },
          capabilities: { protocolVersion: "1", nativeVersion: "1.0.3", features: ["session.create", "session.load", "session.resume", "session.close", "turn.prompt", "turn.cancel", "event.subscribe", "permission.respond", "question.respond", "config.set_model", "config.set_mode"] },
        },
      ],
      rollout: {
        version: 1,
        generatedAt: 1,
        sessionCount: 3,
        runtimeCounts: [
          { runtimeKind: "opencode", count: 2 },
          { runtimeKind: "grok-build", count: 1 },
        ],
        bindingSetHash: "fixture-hash",
        complete: true,
        failureCount: 0,
      },
    }));
  }
  if (url.pathname.endsWith("/runtime-models")) {
    return Promise.resolve(json({
      runtimeKind: "grok-build",
      profileId: "system",
      workspaceId,
      models: [{
        ref: { modelId: "grok-4.5", variant: "low" },
        displayName: "Grok 4.5 · Low",
        available: true,
        capabilities: { text: true, imageInput: true, tools: true, reasoning: true },
      }],
      defaultModelRef: { modelId: "grok-4.5", variant: "low" },
      auth: { state: "ready", methods: [{ id: "cached_token", label: "Grok account" }] },
      complete: true,
    }));
  }
  if (url.pathname.endsWith("/runtime-connectors")) {
    return Promise.resolve(json({
      runtimeKind: "grok-build",
      workspaceId,
      complete: true,
      items: [
        { connectorId: "tencent-docs", accountConnected: true, toolAvailable: true, reason: "available" },
        { connectorId: "baidu-drive", accountConnected: true, toolAvailable: true, reason: "available" },
        { connectorId: "kdocs", accountConnected: false, toolAvailable: false, reason: "account_not_connected" },
        { connectorId: "dingtalk", accountConnected: true, toolAvailable: true, reason: "available" },
        { connectorId: "tencent-meeting", accountConnected: true, toolAvailable: false, reason: "runtime_projection_unavailable" },
      ],
    }));
  }
  return Promise.resolve(new Response(JSON.stringify({ error: { code: "fixture_not_found" } }), {
    status: 404,
    headers: { "content-type": "application/json" },
  }));
}

function RuntimeFixture() {
  const client = createOnMyAgentServerClient({ baseUrl: "http://fixture.invalid" });
  return (
    <main
      className="min-h-screen bg-dls-background text-dls-text"
      data-agent-runtime-fixture="true"
      data-fixture-theme={document.documentElement.dataset.theme}
    >
      <div className="mx-auto flex min-h-screen max-w-[1180px] flex-col gap-5 px-6 py-6">
        <NoticeBox tone="info" size="content" data-testid="fixture-source-note">
          Production runtime settings and session header rendered against a deterministic server fixture. No runtime, login, session, or model mutation is performed.
        </NoticeBox>
        <section className="overflow-hidden rounded-xl border border-dls-border bg-dls-surface" aria-label="Runtime-bound session header">
          <SessionSurfaceHeader
            agent={{ name: "Fulfillment Expert", avatarUrl: null, avatarBackground: null }}
            runtimeKind="grok-build"
            codeSceneToolbar={null}
            headerActions={(
              <Button type="button" size="sm" variant="outline">
                <Settings2 data-icon="inline-start" /> Runtime settings
              </Button>
            )}
          />
          <div className="flex items-center gap-3 px-5 py-5 text-sm text-dls-secondary">
            <Bot className="size-5 text-dls-accent" />
            This durable session remains bound to Grok Build when the workspace default changes.
          </div>
        </section>
        <section className="rounded-xl border border-dls-border bg-dls-surface px-5 py-2" aria-label="Agent runtime settings">
          <AgentRuntimeSettingsSection client={client} workspaceId={workspaceId} />
        </section>
      </div>
    </main>
  );
}

applyDisplayOptions();
globalThis.fetch = fixtureFetch;
const root = document.getElementById("root");
if (!root) throw new Error("Missing agent runtime fixture root");
createRoot(root).render(
  <PlatformProvider value={createDefaultPlatform()}>
    <QueryClientProvider client={getReactQueryClient()}>
      <RuntimeFixture />
    </QueryClientProvider>
  </PlatformProvider>,
);
