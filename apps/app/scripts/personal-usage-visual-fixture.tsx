/** @jsxImportSource react */
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createRoot } from "react-dom/client";

import "../src/app/index.css";
import type { WorkspaceInfo } from "../src/app/lib/desktop";
import { setLocale } from "../src/i18n";
import type { PersonalUsageClient } from "../src/react-app/domains/session/usage/personal-usage-model";
import { PersonalUsagePage } from "../src/react-app/domains/session/usage";

const params = new URLSearchParams(window.location.search);
const fixtureState = params.get("state");
const fixtureMode = params.get("mode") as "daily" | "weekly" | "cumulative" | null;
const locale = params.get("lang");
if (locale === "en" || locale === "zh" || locale === "zh-TW") setLocale(locale);
if (params.get("theme") === "dark") {
  document.documentElement.classList.add("dark");
  document.documentElement.dataset.theme = "dark";
}

const workspaces: WorkspaceInfo[] = [
  { id: "office", name: "Office", displayName: "Office assistant", path: "/fixture/office", preset: "default", workspaceType: "local" },
  { id: "code", name: "Code", displayName: "Code workspace", path: "/fixture/code", preset: "default", workspaceType: "local" },
];

function dateOnly(offset: number) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - offset);
  return date.toISOString().slice(0, 10);
}

const client: PersonalUsageClient = {
  async getSessionArchiveUsageSummary(workspaceId) {
    if (fixtureState === "partial" && workspaceId === "code") {
      throw new Error("Fixture workspace unavailable");
    }
    return {
      daily: Array.from({ length: 365 }, (_, index) => {
        const active = fixtureState !== "empty" && index < 45 && index % (workspaceId === "office" ? 3 : 5) === 0;
        return {
          date: dateOnly(index),
          inputTokens: active ? 12_000 + index * 17 : 0,
          outputTokens: active ? 4_500 + index * 7 : 0,
          cacheCreationTokens: active ? 1_200 : 0,
          cacheReadTokens: active ? 8_000 : 0,
        };
      }),
    };
  },
  async getSessionArchiveTopUsageSessions(workspaceId) {
    if (fixtureState === "empty") return [];
    return [{ totalTokens: workspaceId === "office" ? 187_420 : 92_340 }];
  },
  async getSessionArchiveAnalyticsTopSessions(workspaceId) {
    if (fixtureState === "empty") return { sessions: [] };
    return { sessions: [{ duration_min: workspaceId === "office" ? 142 : 87 }] };
  },
};

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
const longName = params.get("long") === "true";

const root = document.getElementById("root");
if (!root) throw new Error("Missing personal usage fixture root");

createRoot(root).render(
  <QueryClientProvider client={queryClient}>
    <div className="h-screen bg-dls-surface">
      <PersonalUsagePage
        client={client}
        workspaces={workspaces}
        onEdit={() => undefined}
        defaultActivityMode={fixtureMode ?? undefined}
        identity={{
          name: longName ? "Alexandra Very Long Personal Workspace Account Name" : "Alex Morgan",
          email: "alex@example.com",
        }}
      />
    </div>
  </QueryClientProvider>,
);
