import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo, ServerConfig } from "@onmyagent/types/server";

import { openSessionArchiveStore } from "../src/services/session-archive.js";
import { registerWorkspaceSessionArchiveRoutes } from "../src/routes/workspace-session-archive-routes.js";
import type { RequestContext, Route } from "../src/routes/route-core.js";

describe("session-archive archive routes", () => {
  test("list, detail, messages, and search read the workspace runtime-state archive", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession());
        store.replaceSessionMessages("session-1", [
          sampleMessage({ id: 1, ordinal: 0, role: "user", content: "Find archived graph sessions" }),
          sampleMessage({ id: 2, ordinal: 1, role: "assistant", content: "Archived graph sessions are indexed." }),
        ]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);

      const listBody = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions?search=graph", workspace);
      expect(listBody.sessions.map((session: { id: string }) => session.id)).toEqual(["session-1"]);

      const detailBody = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1", workspace, { sessionId: "session-1" });
      expect(detailBody.item).toMatchObject({ id: "session-1", agent: "codex" });

      const messagesBody = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/messages", workspace, { sessionId: "session-1" });
      expect(messagesBody.messages.map((message: { content: string }) => message.content)).toEqual([
        "Find archived graph sessions",
        "Archived graph sessions are indexed.",
      ]);

      const searchBody = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/search?q=archived%20graph", workspace);
      expect(searchBody.results[0]).toMatchObject({ session_id: "session-1", agent: "codex" });
      expect(dbPath.includes(`${workspace.path}/.session-archive`)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves SessionArchive session parity routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession({ total_output_tokens: 8, peak_context_tokens: 64, has_total_output_tokens: true }));
        store.upsertSession(sampleSession({ id: "child-1", parent_session_id: "session-1", started_at: "2026-06-23T01:02:00Z", ended_at: "2026-06-23T01:02:10Z" }));
        store.replaceSessionMessages("session-1", [
          sampleMessage({ id: 1, ordinal: 0, role: "user", content: "Find archive route parity", timestamp: "2026-06-23T01:00:00Z" }),
          sampleMessage({
            id: 2,
            ordinal: 1,
            role: "assistant",
            content: "Using Bash route parity",
            timestamp: "2026-06-23T01:01:00Z",
            has_tool_use: true,
            model: "route-model",
            tool_calls: [{ tool_name: "Bash", category: "Bash", tool_use_id: "tool-route", input_json: JSON.stringify({ command: "bun test" }) }],
          }),
          sampleMessage({ id: 3, ordinal: 2, role: "assistant", content: "Finished parity", timestamp: "2026-06-23T01:02:00Z" }),
        ]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);

      const pagedMessages = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/messages?direction=desc&from=2&limit=2", workspace, { sessionId: "session-1" });
      expect(pagedMessages.messages.map((message: { ordinal: number }) => message.ordinal)).toEqual([2, 1]);

      const toolCalls = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/tool-calls", workspace, { sessionId: "session-1" });
      expect(toolCalls).toMatchObject({ count: 1, tool_calls: [{ tool_name: "Bash", ordinal: 1 }] });

      const children = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/children", workspace, { sessionId: "session-1" });
      expect(children.map((session: { id: string }) => session.id)).toEqual(["child-1"]);

      const activity = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/activity", workspace, { sessionId: "session-1" });
      expect(activity.total_messages).toBe(3);
      expect(activity.buckets[0]).toMatchObject({ first_ordinal: 0 });

      const timing = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/timing", workspace, { sessionId: "session-1" });
      expect(timing).toMatchObject({ session_id: "session-1", turn_count: 1, tool_call_count: 1 });

      const usage = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/usage", workspace, { sessionId: "session-1" });
      expect(usage).toMatchObject({ session_id: "session-1", has_token_data: true, models: ["route-model"] });

      const sessionSearch = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/search?q=route", workspace, { sessionId: "session-1" });
      expect(sessionSearch.ordinals).toEqual([0, 1]);

      const contentSearch = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/search/content?pattern=route&mode=substring", workspace);
      expect(contentSearch.matches.length).toBeGreaterThan(0);

      const watch = await callText(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/watch?max_events=2", workspace, { sessionId: "session-1" });
      expect(watch).toContain("event: session.timing");
      expect(watch).toContain("event: heartbeat");

      const events = await callText(routes, "GET", "/workspace/workspace-routes/session-archive/events?max_events=2", workspace);
      expect(events).toContain("event: data_changed");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves SessionArchive usage summary, comparison, and top sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-usage-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession({ id: "usage-a", project: "alpha", agent: "claude", first_message: "Alpha usage", started_at: "2024-06-01T09:00:00Z", ended_at: "2024-06-01T09:05:00Z" }));
        store.upsertSession(sampleSession({ id: "usage-b", project: "beta", agent: "codex", first_message: "Beta usage", started_at: "2024-06-02T09:00:00Z", ended_at: "2024-06-02T09:05:00Z" }));
        store.upsertSession(sampleSession({ id: "usage-prior", project: "alpha", agent: "claude", first_message: "Prior usage", started_at: "2024-05-31T09:00:00Z", ended_at: "2024-05-31T09:05:00Z" }));
        store.replaceSessionMessages("usage-a", [sampleMessage({ id: 21, session_id: "usage-a", ordinal: 0, role: "assistant", content: "Alpha", timestamp: "2024-06-01T09:01:00Z", model: "model-a", token_usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 20, cost_usd: 0.5 } })]);
        store.replaceSessionMessages("usage-b", [sampleMessage({ id: 22, session_id: "usage-b", ordinal: 0, role: "assistant", content: "Beta", timestamp: "2024-06-02T09:01:00Z", model: "model-b", token_usage: { input_tokens: 200, output_tokens: 80, cost_usd: 0.8 } })]);
        store.replaceSessionMessages("usage-prior", [sampleMessage({ id: 23, session_id: "usage-prior", ordinal: 0, role: "assistant", content: "Prior", timestamp: "2024-05-31T09:01:00Z", model: "model-a", token_usage: { input_tokens: 50, output_tokens: 25, cost_usd: 0.25 } })]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);

      const summary = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/usage/summary?from=2024-06-01&to=2024-06-02&include_one_shot=true", workspace);
      expect(summary.totals).toMatchObject({ inputTokens: 300, outputTokens: 130, totalCost: 1.3 });
      expect(summary.projectTotals.map((entry: { project: string }) => entry.project)).toEqual(["beta", "alpha"]);

      const comparison = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/usage/comparison?from=2024-06-01&to=2024-06-01&include_one_shot=true&current_cost=0.5", workspace);
      expect(comparison).toMatchObject({ priorFrom: "2024-05-31", priorTo: "2024-05-31", priorTotalCost: 0.25, deltaPct: 1 });

      const topSessions = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/usage/top-sessions?from=2024-06-01&to=2024-06-02&include_one_shot=true&limit=1", workspace);
      expect(topSessions).toEqual([{ sessionId: "usage-b", displayName: "Beta usage", agent: "codex", project: "beta", startedAt: "2024-06-02T09:00:00Z", totalTokens: 280, cost: 0.8 }]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("session watch stream emits updates after archived session changes", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-watch-route-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession());
        store.replaceSessionMessages("session-1", [
          sampleMessage({ id: 1, ordinal: 0, role: "user", content: "Initial watch content" }),
        ]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);
      const controller = new AbortController();
      const streamPromise = callText(
        routes,
        "GET",
        "/workspace/workspace-routes/session-archive/sessions/session-1/watch?poll_ms=10&max_events=20",
        workspace,
        { sessionId: "session-1" },
        controller.signal,
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      const reopened = await openSessionArchiveStore({ dbPath });
      try {
        reopened.replaceSessionMessages("session-1", [
          sampleMessage({ id: 1, ordinal: 0, role: "user", content: "Initial watch content" }),
          sampleMessage({ id: 2, ordinal: 1, role: "assistant", content: "Changed watch content" }),
        ]);
      } finally {
        reopened.close();
      }

      const body = await streamPromise;
      controller.abort();
      expect(body).toContain("event: session.timing");
      expect(body).toContain("event: session_updated");
      expect(body).toContain('"message_count":2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("archive events stream emits data_changed after archive stats change", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-events-route-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession());
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);
      const streamPromise = callText(routes, "GET", "/workspace/workspace-routes/session-archive/events?poll_ms=10&max_events=6", workspace);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const reopened = await openSessionArchiveStore({ dbPath });
      try {
        reopened.upsertSession(sampleSession({ id: "session-2", first_message: "Changed archive stats" }));
      } finally {
        reopened.close();
      }

      const body = await streamPromise;
      expect(body.match(/event: data_changed/g)?.length ?? 0).toBeGreaterThanOrEqual(2);
      expect(body).toContain('"session_count":2');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves SessionArchive analytics parity routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-analytics-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession({ id: "analytics-a", project: "alpha", agent: "claude", first_message: "Alpha analytics", started_at: "2024-06-01T09:00:00Z", ended_at: "2024-06-01T09:10:00Z", total_output_tokens: 120, has_total_output_tokens: true, health_score: 0.9, health_grade: "A", outcome: "success", outcome_confidence: "high" }));
        store.upsertSession(sampleSession({ id: "analytics-b", project: "beta", agent: "codex", first_message: "Beta analytics", started_at: "2024-06-02T10:00:00Z", ended_at: "2024-06-02T10:20:00Z", health_score: 0.4, health_grade: "D", outcome: "failed", outcome_confidence: "medium", tool_failure_signal_count: 2 }));
        store.replaceSessionMessages("analytics-a", [
          sampleMessage({ id: 31, session_id: "analytics-a", ordinal: 0, role: "user", content: "Alpha", timestamp: "2024-06-01T09:00:00Z" }),
          sampleMessage({ id: 32, session_id: "analytics-a", ordinal: 1, role: "assistant", content: "Alpha done", timestamp: "2024-06-01T09:01:00Z", has_tool_use: true, tool_calls: [{ tool_name: "Read", category: "File", skill_name: "reader" }] }),
        ]);
        store.replaceSessionMessages("analytics-b", [
          sampleMessage({ id: 33, session_id: "analytics-b", ordinal: 0, role: "user", content: "Beta", timestamp: "2024-06-02T10:00:00Z" }),
          sampleMessage({ id: 34, session_id: "analytics-b", ordinal: 1, role: "assistant", content: "Beta done", timestamp: "2024-06-02T10:01:00Z", has_thinking: true, has_tool_use: true, tool_calls: [{ tool_name: "Bash", category: "Shell" }] }),
        ]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);

      expect(await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/summary", workspace)).toMatchObject({ total_sessions: 2, active_projects: 2 });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/activity", workspace)).series).toHaveLength(2);
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/heatmap?metric=messages", workspace)).entries[0]).toMatchObject({ date: "2024-06-01" });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/projects", workspace)).projects.map((project: { name: string }) => project.name)).toEqual(["alpha", "beta"]);
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/hour-of-week", workspace)).cells).toHaveLength(168);
      expect(await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/sessions", workspace)).toMatchObject({ count: 2 });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/velocity", workspace)).by_agent).toHaveLength(2);
      expect(await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/tools", workspace)).toMatchObject({ total_calls: 2 });
      expect(await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/skills", workspace)).toMatchObject({ total_skill_calls: 1, distinct_skills: 1 });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/top-sessions?metric=messages&limit=1", workspace)).sessions).toHaveLength(1);
      expect(await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/signals", workspace)).toMatchObject({ scored_sessions: 2, grade_distribution: { A: 1, D: 1 } });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/analytics/signal-sessions?signal=tool_failure", workspace)).sessions[0]).toMatchObject({ id: "analytics-b" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves activity, trends, and insight routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-insight-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession({ id: "p27-a", project: "alpha", agent: "claude", first_message: "Alpha seam", started_at: "2024-06-01T09:00:00Z", ended_at: "2024-06-01T09:10:00Z", total_output_tokens: 42, has_total_output_tokens: true }));
        store.replaceSessionMessages("p27-a", [
          sampleMessage({ id: 51, session_id: "p27-a", ordinal: 0, role: "user", content: "Review seam reliability", timestamp: "2024-06-01T09:00:00Z" }),
          sampleMessage({ id: 52, session_id: "p27-a", ordinal: 1, role: "assistant", content: "Seam reliability looks better", timestamp: "2024-06-01T09:01:00Z" }),
        ]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);

      const activity = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/activity/report?preset=custom&from=2024-06-01T00:00:00Z&to=2024-06-02T00:00:00Z&bucket=1d", workspace);
      expect(activity.totals).toMatchObject({ sessions: 1, output_tokens: 42 });

      const trends = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/trends/terms?from=2024-06-01&to=2024-06-02&include_one_shot=true&term=seam&granularity=day", workspace);
      expect(trends.series[0]).toMatchObject({ term: "seam", total: 2 });

      const generatedText = await callInsightGenerate(routes, workspace, {
        type: "daily_activity",
        date_from: "2024-06-01",
        date_to: "2024-06-02",
        prompt: "Summarize",
      });
      expect(generatedText).toContain("event: status");
      expect(generatedText).toContain("event: log");
      expect(generatedText).toContain("event: done");

      const list = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/insights?type=daily_activity", workspace);
      expect(list.insights).toHaveLength(1);
      const id = list.insights[0].id;
      const item = await callJson(routes, "GET", `/workspace/workspace-routes/session-archive/insights/${id}`, workspace, { insightId: String(id) });
      expect(item.id).toBe(id);
      expect(await callJson(routes, "DELETE", `/workspace/workspace-routes/session-archive/insights/${id}`, workspace, { insightId: String(id) })).toEqual({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves session management parity routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-management-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession({ file_path: join(root, "repo", "sessions", "session-1.jsonl"), project: workspace.path }));
        store.upsertSession(sampleSession({ id: "delete-me", first_message: "Delete me" }));
        store.replaceSessionMessages("session-1", [
          sampleMessage({ id: 71, ordinal: 0, role: "user", content: "Pin and export this route" }),
          sampleMessage({ id: 72, ordinal: 1, role: "assistant", content: "Route export ready" }),
        ]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);

      expect(await callJson(routes, "PUT", "/workspace/workspace-routes/session-archive/sessions/session-1/star", workspace, { sessionId: "session-1" })).toEqual({ ok: true });
      expect(await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/starred", workspace)).toEqual({ session_ids: ["session-1"] });
      expect(await callJsonWithBody(routes, "POST", "/workspace/workspace-routes/session-archive/starred/bulk", workspace, {}, { session_ids: ["delete-me"] })).toEqual({ ok: true });

      const pin = await callJsonWithBody(routes, "POST", "/workspace/workspace-routes/session-archive/sessions/session-1/messages/1/pin", workspace, { sessionId: "session-1", messageId: "1" }, { note: "route" }, 201);
      expect(pin.id).toBeGreaterThan(0);
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/pins", workspace, { sessionId: "session-1" })).pins[0]).toMatchObject({ message_id: 1, note: "route" });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/pins", workspace)).pins).toHaveLength(1);

      expect((await callJsonWithBody(routes, "PATCH", "/workspace/workspace-routes/session-archive/sessions/session-1/rename", workspace, { sessionId: "session-1" }, { name: "Route renamed" })).item.display_name).toBe("Route renamed");
      expect(await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/directory", workspace, { sessionId: "session-1" })).toMatchObject({ directory: join(root, "repo", "sessions") });
      expect(await callJson(routes, "POST", "/workspace/workspace-routes/session-archive/sessions/session-1/open", workspace, { sessionId: "session-1" })).toMatchObject({ launched: false });
      expect((await callJsonWithBody(routes, "POST", "/workspace/workspace-routes/session-archive/sessions/session-1/resume", workspace, { sessionId: "session-1" }, { command_only: true })).command).toContain("codex resume session-1");
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/export", workspace, { sessionId: "session-1" })).content).toContain("Route export ready");
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sessions/session-1/md", workspace, { sessionId: "session-1" })).content).toContain("## assistant");
      expect(await callJson(routes, "POST", "/workspace/workspace-routes/session-archive/sessions/session-1/publish", workspace, { sessionId: "session-1" })).toMatchObject({ ok: false, requires_remote: true });

      expect(await callJson(routes, "DELETE", "/workspace/workspace-routes/session-archive/sessions/delete-me", workspace, { sessionId: "delete-me" })).toEqual({ ok: true });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/trash", workspace)).sessions.map((session: { id: string }) => session.id)).toEqual(["delete-me"]);
      expect(await callJson(routes, "POST", "/workspace/workspace-routes/session-archive/sessions/delete-me/restore", workspace, { sessionId: "delete-me" })).toEqual({ ok: true });
      expect(await callJson(routes, "DELETE", "/workspace/workspace-routes/session-archive/sessions/delete-me", workspace, { sessionId: "delete-me" })).toEqual({ ok: true });
      expect(await callJson(routes, "DELETE", "/workspace/workspace-routes/session-archive/trash", workspace)).toEqual({ ok: true, deleted: 1 });
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/trash", workspace)).sessions).toEqual([]);
      const reopened = await openSessionArchiveStore({ dbPath });
      try {
        reopened.upsertSession(sampleSession({ id: "permanent-me", first_message: "Permanent delete me" }));
      } finally {
        reopened.close();
      }
      expect(await callJson(routes, "DELETE", "/workspace/workspace-routes/session-archive/sessions/permanent-me/permanent", workspace, { sessionId: "permanent-me" })).toEqual({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves import and config parity routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-config-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const routes = createRoutes(workspace, dbPath);

      const upload = await callJsonWithBody(routes, "POST", "/workspace/workspace-routes/session-archive/sessions/upload", workspace, {}, {
        filename: "manual.jsonl",
        agent: "codex",
        project: "manual",
        content: JSON.stringify({ session_id: "manual-route", role: "user", content: "Manual import route" }),
      });
      expect(upload).toMatchObject({ imported: 1, errors: 0 });

      const claudeText = await callTextWithBody(routes, "POST", "/workspace/workspace-routes/session-archive/import/claude-ai", workspace, {}, {
        filename: "conversations.json",
        content: JSON.stringify([{ uuid: "claude-route", name: "Claude Route", messages: [{ role: "user", content: "hello" }] }]),
      });
      expect(claudeText).toContain("event: done");

      const config = await callJsonWithBody(routes, "PUT", "/workspace/workspace-routes/session-archive/config", workspace, {}, {
        github_token: "ghp_secret_token_value",
        terminal: { mode: "clipboard" },
        remote: { public_url: "https://viewer.example.test", public_origins: ["https://viewer.example.test"], require_auth: true, auth_token_configured: true },
        postgres: { url: "postgres://agent:super-secret@example.test:5432/session-archive?sslmode=require", schema: "session-archive", machine_name: "route-machine", watch: true },
        duckdb: { path: join(root, "runtime", "sessions.duckdb"), url: "quack:https://duckdb.example.test", token_configured: true, machine_name: "route-machine" },
      });
      expect(config.github).toMatchObject({ configured: true, token_preview: "ghp_...alue" });
      expect(config.terminal).toMatchObject({ mode: "clipboard" });
      expect(config.remote).toMatchObject({ auth_configured: true });
      expect(JSON.stringify(config)).not.toContain("super-secret");
      expect(config.postgres).toMatchObject({ url_configured: true, schema: "session-archive", machine_name: "route-machine", watch: true });
      expect(config.duckdb).toMatchObject({ url_configured: true, token_configured: true, machine_name: "route-machine" });

      const backends = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/backends/status", workspace);
      expect(backends.backends.map((backend: { backend: string }) => backend.backend)).toEqual(["postgres", "duckdb"]);
      expect(backends.backends.every((backend: { status: string; blocker?: string }) => backend.status === "blocked" && backend.blocker)).toBe(true);
      expect(JSON.stringify(backends)).not.toContain("super-secret");

      const logRoot = join(dbPath, "..", "logs");
      await mkdir(logRoot, { recursive: true });
      await writeFile(join(logRoot, "archive.log"), "raw lifecycle log content that must not be returned");
      const lifecycle = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/lifecycle/status", workspace);
      expect(lifecycle).toMatchObject({ healthy: true, mode: "studio-native", db_exists: true });
      expect(lifecycle.version).toBeTruthy();
      expect(lifecycle.runtime_root).toBe(join(dbPath, ".."));
      expect(lifecycle.db_path).toBe(dbPath);
      expect(lifecycle.db_bytes).toBeGreaterThan(0);
      expect(lifecycle.update).toMatchObject({ supported: false, update_available: false });
      expect(lifecycle.logs.files[0]).toMatchObject({ name: "archive.log" });
      expect(lifecycle.logs.files[0].bytes).toBeGreaterThan(0);
      expect(JSON.stringify(lifecycle)).not.toContain("raw lifecycle log content");
      expect(lifecycle.db_path.includes(`${workspace.path}/.session-archive`)).toBe(false);

      const mapping = await callJsonWithBody(routes, "POST", "/workspace/workspace-routes/session-archive/settings/worktree-mappings", workspace, {}, {
        path_prefix: join(root, "repo", "feature"),
        project: "mapped-route",
        enabled: true,
        machine: "local",
      }, 201);
      expect(mapping.project).toBe("mapped-route");
      expect((await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/settings/worktree-mappings", workspace)).mappings).toHaveLength(1);
      expect(await callJson(routes, "POST", "/workspace/workspace-routes/session-archive/settings/worktree-mappings/apply", workspace)).toMatchObject({ updated: 0 });
      expect(await callJson(routes, "DELETE", `/workspace/workspace-routes/session-archive/settings/worktree-mappings/${mapping.id}`, workspace, { mappingId: mapping.id })).toEqual({ ok: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("serves secret scan and redacted findings routes", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-secret-routes-"));
    try {
      const workspace = createWorkspace(root);
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const rawAws = ["AKIA", "7QHWN2DKR4FYPLJM"].join("");
      const rawOpenAi = ["sk", "proj", "abcdefghijklmnopqrstuvwxyzABCDE123456789"].join("-");
      const store = await openSessionArchiveStore({ dbPath });
      try {
        store.upsertSession(sampleSession({ id: "secret-route", project: "security", agent: "codex", first_message: "Secret route" }));
        store.replaceSessionMessages("secret-route", [
          sampleMessage({ id: 81, session_id: "secret-route", ordinal: 0, role: "user", content: `Inspect ${rawAws}` }),
          sampleMessage({
            id: 82,
            session_id: "secret-route",
            ordinal: 1,
            role: "assistant",
            content: "Tool finished",
            has_tool_use: true,
            tool_calls: [{ tool_name: "Bash", category: "Bash", input_json: JSON.stringify({ apiKey: rawOpenAi }) }],
          }),
        ]);
      } finally {
        store.close();
      }
      const routes = createRoutes(workspace, dbPath);

      const summary = await callJson(routes, "POST", "/workspace/workspace-routes/session-archive/secrets/scan", workspace);
      expect(summary).toMatchObject({ scanned: 1, with_secrets: 1, total_findings: 2, definite_findings: 2 });

      const body = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/secrets?confidence=all&limit=10", workspace);
      expect(body.findings).toHaveLength(2);
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(rawAws);
      expect(serialized).not.toContain(rawOpenAi);
      expect(body.findings.map((finding: { location_kind: string }) => finding.location_kind).sort()).toEqual(["message", "tool_input"]);
      expect(body.findings.every((finding: { redacted_match: string }) => finding.redacted_match.includes("…") || finding.redacted_match.includes("redacted"))).toBe(true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("sync smoke parses injected source roots and writes outside the repo tree", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-sync-route-"));
    try {
      const workspace = createWorkspace(root);
      const sourceRoot = join(root, "sources", ".codex", "sessions");
      await mkdir(sourceRoot, { recursive: true });
      await writeFile(join(sourceRoot, "rollout-2026-06-11T12-44-06-abc-123.jsonl"), [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "abc-123", cwd: workspace.path } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "Sync graph archive" }] } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:02Z", payload: { role: "assistant", content: [{ type: "output_text", text: "Synced." }] } }),
      ].join("\n"));
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const routes = createRoutes(workspace, dbPath, [{ agent: "codex", root: sourceRoot }]);

      const syncBody = await callJson(routes, "POST", "/workspace/workspace-routes/session-archive/sync?limit=10", workspace, {}, 202);
      expect(syncBody).toMatchObject({ ok: true, status: "running" });
      expect(syncBody.dbPath).toBe(dbPath);
      await waitForSync(routes, workspace);

      const searchBody = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/search?q=Sync", workspace);
      expect(searchBody.results[0]).toMatchObject({ session_id: "codex:abc-123" });
      expect(await readFile(dbPath)).toBeInstanceOf(Buffer);
      expect(dbPath.startsWith(workspace.path)).toBe(false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("sync route returns quickly while status reports completion", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-sync-status-route-"));
    try {
      const workspace = createWorkspace(root);
      const sourceRoot = join(root, "sources", ".codex", "sessions");
      await mkdir(sourceRoot, { recursive: true });
      for (let index = 0; index < 25; index += 1) {
        await writeFile(join(sourceRoot, `rollout-2026-06-11T12-44-06-${index}.jsonl`), [
          JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: `sync-${index}`, cwd: workspace.path } }),
          JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: `Sync ${index}` }] } }),
        ].join("\n"));
      }
      const dbPath = join(root, "userData", "runtime-state", "session-archive", "workspaces", "workspace-routes", "archive.sqlite");
      const routes = createRoutes(workspace, dbPath, [{ agent: "codex", root: sourceRoot }]);

      const started = await callJson(routes, "POST", "/workspace/workspace-routes/session-archive/sync", workspace, {}, 202);
      expect(started).toMatchObject({ ok: true, status: "running", stats: null });
      const finished = await waitForSync(routes, workspace);
      expect(finished).toMatchObject({ ok: true, status: "completed", stats: { synced: 25, failed: 0 } });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

function createRoutes(workspace: WorkspaceInfo, dbPath: string, sourceRoots = []) {
  const routes: Route[] = [];
  registerWorkspaceSessionArchiveRoutes({
    routes,
    config: createConfig(workspace),
    resolveWorkspace: async () => workspace,
    resolveArchivePaths: () => ({ root: join(dbPath, ".."), dbPath }),
    sourceRoots,
  });
  return routes;
}

async function callJson(
  routes: Route[],
  method: string,
  path: string,
  workspace: WorkspaceInfo,
  params: Record<string, string> = {},
  expectedStatus = 200,
) {
  const url = new URL(`http://localhost${path}`);
  const route = routes.find((item) => item.method === method && item.regex.test(url.pathname));
  expect(route).toBeTruthy();
  if (!route) throw new Error(`missing route ${method} ${path}`);
  const response = await route.handler({
    request: new Request(url, { method }),
    url,
    params: { id: workspace.id, ...params },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "viewer" },
  } satisfies RequestContext);
  expect(response.status).toBe(expectedStatus);
  return response.json();
}

async function waitForSync(routes: Route[], workspace: WorkspaceInfo) {
  const deadline = Date.now() + 5_000;
  let latest: unknown = null;
  while (Date.now() < deadline) {
    latest = await callJson(routes, "GET", "/workspace/workspace-routes/session-archive/sync/status", workspace);
    if (latest && typeof latest === "object" && "status" in latest && latest.status !== "running") return latest;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`timed out waiting for route sync: ${JSON.stringify(latest)}`);
}

async function callJsonWithBody(
  routes: Route[],
  method: string,
  path: string,
  workspace: WorkspaceInfo,
  params: Record<string, string>,
  body: unknown,
  expectedStatus = 200,
) {
  const url = new URL(`http://localhost${path}`);
  const route = routes.find((item) => item.method === method && item.regex.test(url.pathname));
  expect(route).toBeTruthy();
  if (!route) throw new Error(`missing route ${method} ${path}`);
  const response = await route.handler({
    request: new Request(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    url,
    params: { id: workspace.id, ...params },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "viewer" },
  } satisfies RequestContext);
  expect(response.status).toBe(expectedStatus);
  return response.json();
}

async function callText(
  routes: Route[],
  method: string,
  path: string,
  workspace: WorkspaceInfo,
  params: Record<string, string> = {},
  signal?: AbortSignal,
) {
  const url = new URL(`http://localhost${path}`);
  const route = routes.find((item) => item.method === method && item.regex.test(url.pathname));
  expect(route).toBeTruthy();
  if (!route) throw new Error(`missing route ${method} ${path}`);
  const response = await route.handler({
    request: new Request(url, { method, signal }),
    url,
    params: { id: workspace.id, ...params },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "viewer" },
  } satisfies RequestContext);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  return response.text();
}

async function callTextWithBody(
  routes: Route[],
  method: string,
  path: string,
  workspace: WorkspaceInfo,
  params: Record<string, string>,
  body: unknown,
) {
  const url = new URL(`http://localhost${path}`);
  const route = routes.find((item) => item.method === method && item.regex.test(url.pathname));
  expect(route).toBeTruthy();
  if (!route) throw new Error(`missing route ${method} ${path}`);
  const response = await route.handler({
    request: new Request(url, { method, body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    url,
    params: { id: workspace.id, ...params },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "viewer" },
  } satisfies RequestContext);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  return response.text();
}

async function callInsightGenerate(routes: Route[], workspace: WorkspaceInfo, body: unknown) {
  const url = new URL("http://localhost/workspace/workspace-routes/session-archive/insights/generate");
  const route = routes.find((item) => item.method === "POST" && item.regex.test(url.pathname));
  expect(route).toBeTruthy();
  if (!route) throw new Error("missing insight generate route");
  const response = await route.handler({
    request: new Request(url, { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } }),
    url,
    params: { id: workspace.id },
    config: createConfig(workspace),
    approvals: null,
    reloadEvents: null,
    tokens: null,
    actor: { type: "remote", scope: "viewer" },
  } satisfies RequestContext);
  expect(response.status).toBe(200);
  expect(response.headers.get("Content-Type")).toBe("text/event-stream");
  return response.text();
}

function createWorkspace(root: string): WorkspaceInfo {
  return {
    id: "workspace-routes",
    name: "Workspace Routes",
    path: join(root, "repo"),
    preset: "default",
    workspaceType: "local",
  };
}

function createConfig(workspace: WorkspaceInfo): ServerConfig {
  return {
    host: "127.0.0.1",
    port: 0,
    token: "token",
    hostToken: "host-token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: [],
    workspaces: [workspace],
    authorizedRoots: [workspace.path],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "generated",
    hostTokenSource: "generated",
    logFormat: "pretty",
    logRequests: false,
  };
}

function sampleSession(input = {}) {
  return {
    id: "session-1",
    project: "studio",
    machine: "local",
    agent: "codex",
    first_message: "Find archived graph sessions",
    started_at: "2026-06-23T01:00:00Z",
    ended_at: "2026-06-23T01:05:00Z",
    message_count: 0,
    user_message_count: 0,
    total_output_tokens: 0,
    peak_context_tokens: 0,
    is_automated: false,
    created_at: "2026-06-23T01:00:00Z",
    ...input,
  };
}

function sampleMessage(input: { id: number; ordinal: number; role: string; content: string; session_id?: string; timestamp?: string; has_thinking?: boolean; has_tool_use?: boolean; model?: string; tool_calls?: unknown[]; token_usage?: Record<string, number> }) {
  return {
    id: input.id,
    session_id: input.session_id ?? "session-1",
    ordinal: input.ordinal,
    role: input.role,
    content: input.content,
    timestamp: input.timestamp ?? "2026-06-23T01:00:01Z",
    has_thinking: input.has_thinking ?? false,
    thinking_text: "",
    has_tool_use: input.has_tool_use ?? false,
    content_length: input.content.length,
    model: input.model ?? "",
    context_tokens: 0,
    output_tokens: 0,
    is_system: false,
    ...(input.tool_calls ? { tool_calls: input.tool_calls } : {}),
    ...(input.token_usage ? { token_usage: input.token_usage } : {}),
  };
}
