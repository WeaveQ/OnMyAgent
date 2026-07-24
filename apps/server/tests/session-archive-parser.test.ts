import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  sessionArchiveSources,
  sessionArchiveParserForAgent,
  sessionArchiveDedicatedParserAgents,
  sessionArchiveGenericParserAgents,
  discoverSessionArchiveSessionFiles,
} from "../src/services/session-archive-parser.js";
import {
  sessionArchiveRegistry,
  resolveSessionArchiveSourceRoots,
  resolveSessionArchiveWatchRoots,
} from "../src/services/session-archive-registry.js";

describe("session-archive parser registry", () => {
  test("matches the full SessionArchive registry metadata", () => {
    expect(sessionArchiveRegistry.map((entry) => entry.agent)).toEqual([
      "claude",
      "cowork",
      "codex",
      "copilot",
      "gemini",
      "mimocode",
      "opencode",
      "kilo",
      "openhands",
      "cursor",
      "amp",
      "zencoder",
      "iflow",
      "vscode-copilot",
      "visualstudio-copilot",
      "pi",
      "omp",
      "qwen",
      "commandcode",
      "deepseek-tui",
      "openclaw",
      "qclaw",
      "kimi",
      "claude-ai",
      "chatgpt",
      "kiro",
      "kiro-ide",
      "cortex",
      "hermes",
      "onmyagent",
      "grok",
      "workbuddy",
      "forge",
      "piebald",
      "warp",
      "positron",
      "zed",
      "antigravity",
      "antigravity-cli",
      "qwenpaw",
      "gptme",
      "shelley",
      "vibe",
      "aider",
      "reasonix",
    ]);
    expect(sessionArchiveSources).toContainEqual({
      agent: "claude",
      displayName: "Claude Code",
      envVar: "CLAUDE_PROJECTS_DIR",
      configKey: "claude_project_dirs",
      idPrefix: "",
      defaultDirs: [".claude/projects"],
      fileBased: true,
      enabled: true,
    });
    expect(sessionArchiveSources).toContainEqual({
      agent: "codex",
      displayName: "Codex",
      envVar: "CODEX_SESSIONS_DIR",
      configKey: "codex_sessions_dirs",
      idPrefix: "codex:",
      defaultDirs: [".codex/sessions", ".codex/archived_sessions"],
      fileBased: true,
      enabled: true,
    });
    expect(sessionArchiveSources).toContainEqual({
      agent: "opencode",
      displayName: "OpenCode",
      envVar: "OPENCODE_DIR",
      configKey: "opencode_dirs",
      idPrefix: "opencode:",
      defaultDirs: [".local/share/opencode"],
      watchSubdirs: ["storage/session", "storage/message", "storage/part"],
      fileBased: true,
      enabled: true,
    });
    expect(sessionArchiveRegistry.find((entry) => entry.agent === "aider")).toMatchObject({ defaultDirs: [".aider"], shallowWatch: true });
    expect(sessionArchiveRegistry.filter((entry) => !entry.fileBased).map((entry) => entry.agent)).toEqual(["claude-ai", "chatgpt", "forge", "piebald", "warp"]);
  });

  test("resolves defaults, config, env override precedence, and home-relative dirs", async () => {
    const home = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-roots-"));
    try {
      const configCodex = join(home, "configured-codex");
      const envCodex = join(home, "env-codex");
      const openCode = join(home, ".local", "share", "opencode");
      await mkdir(envCodex, { recursive: true });
      await mkdir(openCode, { recursive: true });

      const roots = resolveSessionArchiveSourceRoots({
        homeDir: home,
        env: { CODEX_SESSIONS_DIR: envCodex },
        config: { codex_sessions_dirs: [configCodex], opencode_dirs: [openCode] },
      });

      expect(roots).toContainEqual({ agent: "codex", root: envCodex, source: "env", configured: true });
      expect(roots).not.toContainEqual({ agent: "codex", root: configCodex, source: "config", configured: true });
      expect(roots).toContainEqual({ agent: "opencode", root: openCode, source: "config", configured: true });
    } finally {
      await rm(home, { recursive: true, force: true });
    }
  });

  test("resolves watch roots for static, shallow, dynamic, and Codex sidecar layouts", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-watch-"));
    try {
      const opencode = join(root, "opencode");
      await mkdir(join(opencode, "storage", "session", "project"), { recursive: true });
      expect(resolveSessionArchiveWatchRoots({ agent: "opencode", root: opencode })).toEqual([
        { agent: "opencode", root: join(opencode, "storage"), recursive: true, sourceRoot: opencode },
      ]);
      await writeFile(join(opencode, "opencode.db"), "");
      expect(resolveSessionArchiveWatchRoots({ agent: "opencode", root: opencode })).toEqual([
        { agent: "opencode", root: opencode, recursive: true, sourceRoot: opencode },
      ]);

      const codex = join(root, ".codex", "sessions");
      await mkdir(codex, { recursive: true });
      expect(resolveSessionArchiveWatchRoots({ agent: "codex", root: codex })).toEqual([
        { agent: "codex", root: codex, recursive: true, sourceRoot: codex },
        { agent: "codex", root: join(root, ".codex"), recursive: false, sourceRoot: codex },
      ]);

      const copilot = join(root, ".copilot");
      expect(resolveSessionArchiveWatchRoots({ agent: "copilot", root: copilot })).toEqual([
        { agent: "copilot", root: join(copilot, "session-state"), recursive: true, sourceRoot: copilot },
      ]);

      const aider = join(root, "code");
      expect(resolveSessionArchiveWatchRoots({ agent: "aider", root: aider })).toEqual([
        { agent: "aider", root: aider, recursive: false, sourceRoot: aider },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("session-archive parser initial slice", () => {
  test("tracks dedicated and generic parser coverage separately", () => {
    expect(sessionArchiveDedicatedParserAgents).toEqual([
      "claude",
      "codex",
      "opencode",
      "kilo",
      "mimocode",
      "hermes",
      "openclaw",
      "qclaw",
      "gemini",
      "kiro",
      "kimi",
      "qwen",
      "pi",
      "omp",
      "qwenpaw",
      "reasonix",
      "aider",
      "grok",
      "workbuddy",
    ]);
    expect(sessionArchiveGenericParserAgents).toEqual([
      "cowork",
      "copilot",
      "openhands",
      "cursor",
      "amp",
      "zencoder",
      "iflow",
      "vscode-copilot",
      "visualstudio-copilot",
      "commandcode",
      "deepseek-tui",
      "kiro-ide",
      "cortex",
      "onmyagent",
      "positron",
      "zed",
      "antigravity",
      "antigravity-cli",
      "gptme",
      "shelley",
      "vibe",
    ]);

    const fileBackedAgents = sessionArchiveRegistry.filter((entry) => entry.fileBased).map((entry) => entry.agent).sort();
    const classifiedAgents = [...sessionArchiveDedicatedParserAgents, ...sessionArchiveGenericParserAgents].sort();
    expect(classifiedAgents).toEqual(fileBackedAgents);
  });

  test("keeps parser entrypoints from being treated as dedicated parser parity", () => {
    for (const entry of sessionArchiveRegistry) {
      if (entry.fileBased) expect(sessionArchiveParserForAgent(entry.agent)).not.toBeNull();
      else expect(sessionArchiveParserForAgent(entry.agent)).toBeNull();
    }
    for (const agent of sessionArchiveGenericParserAgents) {
      expect(sessionArchiveParserForAgent(agent)).not.toBeNull();
      expect(sessionArchiveDedicatedParserAgents).not.toContain(agent);
    }
  });

  test("parses Claude JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "test.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "user", uuid: "uuid-user", timestamp: "2024-01-01T10:00:00Z", cwd: "/Users/alice/code/my-app", message: { content: "Fix the login bug" } }),
        JSON.stringify({ type: "assistant", uuid: "uuid-assistant", parentUuid: "uuid-user", requestId: "req-1", isSidechain: true, timestamp: "2024-01-01T10:00:05Z", message: { id: "msg-1", model: "claude-sonnet", content: [{ type: "text", text: "Looking" }, { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "src/auth.ts" } }], usage: { input_tokens: 10, output_tokens: 5 } } }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("claude")?.parseFile(path, {
        machine: "local",
        sourceMtimeMs: 1717243200000,
        sourceHash: "hash-claude",
        sourceInode: 100,
        sourceDevice: 200,
      });

      expect(result?.session).toMatchObject({
        id: "test",
        agent: "claude",
        project: "my-app",
        first_message: "Fix the login bug",
        file_hash: "hash-claude",
        file_inode: 100,
        file_device: 200,
        cwd: "/Users/alice/code/my-app",
        source_session_id: "test",
        source_version: "studio-session-archive-v1",
        parser_malformed_lines: 0,
        is_truncated: false,
      });
      expect(result?.messages).toHaveLength(2);
      expect(result?.messages[1]?.tool_calls?.[0]).toMatchObject({ tool_name: "Read", category: "Read" });
      expect(result?.messages[1]).toMatchObject({
        claude_message_id: "msg-1",
        claude_request_id: "req-1",
        source_type: "assistant",
        source_uuid: "uuid-assistant",
        source_parent_uuid: "uuid-user",
        is_sidechain: true,
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("renders tool-only assistant messages with visible content", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "tool-only.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "user", timestamp: "2024-01-01T10:00:00Z", message: { content: "Inspect files" } }),
        JSON.stringify({ type: "assistant", timestamp: "2024-01-01T10:00:01Z", message: { content: [{ type: "tool_use", id: "toolu_read", name: "Read", input: { file_path: "README.md" } }] } }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("claude")?.parseFile(path, { machine: "local" });

      expect(result?.messages).toHaveLength(2);
      expect(result?.messages[1]).toMatchObject({ role: "assistant", content: "Tool: Read", has_tool_use: true });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses Codex JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "rollout-2026-06-11T12-44-06-abc-123.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "abc-123", cwd: "/Users/alice/code/my-api" } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "Add rate limiting" }] } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:05Z", payload: { role: "assistant", content: [{ type: "output_text", text: "Done" }] } }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("codex")?.parseFile(path);

      expect(result?.session).toMatchObject({ id: "codex:abc-123", agent: "codex", project: "my-api", first_message: "Add rate limiting" });
      expect(result?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("does not discover Codex session_index sidecar as a session file", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const sessionDir = join(root, "sessions");
      await mkdir(sessionDir, { recursive: true });
      const sessionPath = join(sessionDir, "rollout-2026-06-11T12-44-06-sidecar-1.jsonl");
      await writeFile(join(root, "session_index.jsonl"), JSON.stringify({ id: "sidecar-1", thread_name: "Sidecar title" }));
      await writeFile(sessionPath, [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "sidecar-1", cwd: "/tmp/project" } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "real session" }] } }),
      ].join("\n"));

      await expect(discoverSessionArchiveSessionFiles({ agent: "codex", root })).resolves.toEqual([sessionPath]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("discovers only Aider history files and skips vendor JSON noise", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-aider-"));
    try {
      const repo = join(root, "repo");
      await mkdir(join(repo, "node_modules", "pkg"), { recursive: true });
      await mkdir(join(repo, "src"), { recursive: true });
      const historyPath = join(repo, ".aider.chat.history.md");
      await writeFile(historyPath, "# aider chat started at 2026-06-09 14:01:00\n#### fix bug\nDone\n");
      await writeFile(join(repo, "src", "config.json"), "{not valid json");
      await writeFile(join(repo, "node_modules", "pkg", ".aider.chat.history.md"), "# aider chat started at 2026-06-09 14:01:00\n#### hidden\n");

      await expect(discoverSessionArchiveSessionFiles({ agent: "aider", root })).resolves.toEqual([historyPath]);
      const result = await sessionArchiveParserForAgent("aider")?.parseFile(historyPath);
      expect(result?.session).toMatchObject({ agent: "aider", first_message: "fix bug", message_count: 2 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses Codex thread title from session_index", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const sessionDir = join(root, "archived_sessions");
      await mkdir(sessionDir, { recursive: true });
      const path = join(sessionDir, "rollout-2026-06-11T12-44-06-abc-indexed.jsonl");
      await writeFile(join(root, "session_index.jsonl"), [
        JSON.stringify({ id: "abc-indexed", thread_name: "修复飞书通道回复" }),
      ].join("\n"));
      await writeFile(path, [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "abc-indexed", cwd: "/Users/alice/code/studio" } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nproject rules\n</INSTRUCTIONS>" }] } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:02Z", payload: { role: "user", content: [{ type: "input_text", text: "飞书还是坏的" }] } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:05Z", payload: { role: "assistant", content: [{ type: "output_text", text: "我来检查" }] } }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("codex")?.parseFile(path);

      expect(result?.session).toMatchObject({
        id: "codex:abc-indexed",
        display_name: "修复飞书通道回复",
        first_message: "飞书还是坏的",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("skips Codex AGENTS bootstrap prompt when deriving first message", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "sessions", "2026", "06", "11", "rollout-2026-06-11T12-44-06-abc-bootstrap.jsonl");
      await mkdir(join(root, "sessions", "2026", "06", "11"), { recursive: true });
      await writeFile(path, [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "abc-bootstrap", cwd: "/Users/alice/code/studio" } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "# AGENTS.md instructions\n\n<INSTRUCTIONS>\nproject rules\n</INSTRUCTIONS>" }] } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:02Z", payload: { role: "user", content: [{ type: "input_text", text: "这个会话归档标题不对" }] } }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("codex")?.parseFile(path);

      expect(result?.session).toMatchObject({
        id: "codex:abc-bootstrap",
        first_message: "这个会话归档标题不对",
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses Codex token count events as hidden usage rows", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "rollout-2026-06-11T12-44-06-abc-usage.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "session_meta", timestamp: "2024-01-01T10:00:00Z", payload: { id: "abc-usage", cwd: "/Users/alice/code/my-api" } }),
        JSON.stringify({ type: "turn_context", timestamp: "2024-01-01T10:00:00Z", payload: { model: "gpt-5.5" } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:01Z", payload: { role: "user", content: [{ type: "input_text", text: "Add usage" }] } }),
        JSON.stringify({ type: "event_msg", timestamp: "2024-01-01T10:00:02Z", payload: { type: "token_count", info: { last_token_usage: { input_tokens: 1000, cached_input_tokens: 500, output_tokens: 100, reasoning_output_tokens: 20, total_tokens: 1620 } } } }),
        JSON.stringify({ type: "response_item", timestamp: "2024-01-01T10:00:05Z", payload: { role: "assistant", content: [{ type: "output_text", text: "Done" }] } }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("codex")?.parseFile(path);

      expect(result?.session).toMatchObject({ id: "codex:abc-usage", message_count: 2, total_output_tokens: 100, peak_context_tokens: 1000 });
      expect(result?.messages.map((message) => message.role)).toEqual(["user", "system", "assistant"]);
      expect(result?.messages[1]).toMatchObject({
        is_system: true,
        source_subtype: "token_count",
        model: "gpt-5.5",
        context_tokens: 1000,
        output_tokens: 100,
      });
      expect(result?.messages[1]?.token_usage).toMatchObject({ cache_read_input_tokens: 500, reasoning_output_tokens: 20 });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses OpenCode storage JSON and discovery", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const dir = join(root, "storage", "session", "-Users-alice-code-app");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "ses.json");
      await writeFile(path, JSON.stringify({
        id: "ses",
        messages: [
          { role: "user", content: "hello", time: 1710000000000 },
          { role: "assistant", content: [{ type: "text", text: "hi" }], time: 1710000001000 },
        ],
      }));

      expect(await discoverSessionArchiveSessionFiles({ agent: "opencode", root })).toEqual([path]);
      const result = await sessionArchiveParserForAgent("opencode")?.parseFile(path);

      expect(result?.session).toMatchObject({ id: "opencode:ses", agent: "opencode" });
      expect(result?.messages.map((message) => message.content)).toEqual(["hello", "hi"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("uses source file mtime instead of Unix epoch when messages have no timestamps", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const dir = join(root, "storage", "session", "project");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "missing-time.json");
      await writeFile(path, JSON.stringify({
        id: "missing-time",
        messages: [
          { role: "user", content: "no timestamp user" },
          { role: "assistant", content: "no timestamp assistant" },
        ],
      }));
      const sourceMtimeMs = Date.UTC(2026, 5, 23, 8, 30, 0);

      const result = await sessionArchiveParserForAgent("opencode")?.parseFile(path, { sourceMtimeMs });

      expect(result?.session.started_at).toBe("2026-06-23T08:30:00.000Z");
      expect(result?.session.created_at).toBe("2026-06-23T08:30:00.000Z");
      expect(result?.session.file_mtime).toBe(sourceMtimeMs);
      expect(result?.messages.map((message) => message.timestamp)).toEqual([
        "2026-06-23T08:30:00.000Z",
        "2026-06-23T08:30:00.000Z",
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses OpenCode-like Kilo and MiMoCode storage JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const kiloDir = join(root, "kilo", "storage", "session", "project");
      const mimoDir = join(root, "mimo", "storage", "session_diff", "project");
      await mkdir(kiloDir, { recursive: true });
      await mkdir(mimoDir, { recursive: true });
      const payload = JSON.stringify({ id: "abc", messages: [{ role: "user", content: "u" }, { role: "assistant", content: "a" }] });
      const kiloPath = join(kiloDir, "abc.json");
      const mimoPath = join(mimoDir, "abc.json");
      await writeFile(kiloPath, payload);
      await writeFile(mimoPath, payload);

      expect(await discoverSessionArchiveSessionFiles({ agent: "kilo", root: join(root, "kilo") })).toEqual([kiloPath]);
      expect(await discoverSessionArchiveSessionFiles({ agent: "mimocode", root: join(root, "mimo") })).toEqual([mimoPath]);

      expect((await sessionArchiveParserForAgent("kilo")?.parseFile(kiloPath))?.session).toMatchObject({ id: "kilo:abc", agent: "kilo" });
      expect((await sessionArchiveParserForAgent("mimocode")?.parseFile(mimoPath))?.session).toMatchObject({ id: "mimocode:abc", agent: "mimocode" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses Hermes JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "20260403_153620_5a3e2ff1.jsonl");
      await writeFile(path, [
        JSON.stringify({ role: "session_meta", timestamp: "2026-04-03T15:36:20Z" }),
        JSON.stringify({ role: "user", content: "hello hermes", timestamp: "2026-04-03T15:36:21Z" }),
        JSON.stringify({ role: "assistant", content: "reply", timestamp: "2026-04-03T15:36:22Z" }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("hermes")?.parseFile(path);

      expect(result?.session).toMatchObject({ id: "hermes:20260403_153620_5a3e2ff1", agent: "hermes", first_message: "hello hermes" });
      expect(result?.messages).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("discovers and parses Grok Build chat_history.jsonl", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const sessionDir = join(root, "%2FUsers%2Fwork%2Fcode", "019f-session-id");
      await mkdir(sessionDir, { recursive: true });
      const path = join(sessionDir, "chat_history.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "system", content: "You are Grok" }),
        JSON.stringify({ type: "user", content: [{ type: "text", text: "hello grok" }] }),
        JSON.stringify({ type: "assistant", content: [{ type: "text", text: "hi" }] }),
      ].join("\n"));

      expect(await discoverSessionArchiveSessionFiles({ agent: "grok", root })).toEqual([path]);
      const result = await sessionArchiveParserForAgent("grok")?.parseFile(path);
      expect(result?.session).toMatchObject({ id: "grok:019f-session-id", agent: "grok", first_message: "hello grok" });
      expect(result?.messages).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("Grok first_message prefers user_query over standalone user_info row", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const sessionDir = join(root, "%2FUsers%2Fwork", "019f-session-query");
      await mkdir(sessionDir, { recursive: true });
      const path = join(sessionDir, "chat_history.jsonl");
      await writeFile(path, [
        JSON.stringify({
          type: "user",
          content: [{
            type: "text",
            text: "<user_info>\nOS Version: macos\nShell: /bin/zsh\nWorkspace Path: /Users/work\n</user_info>",
          }],
        }),
        JSON.stringify({
          type: "user",
          content: [{
            type: "text",
            text: "\n\n<system-reminder>\nAs you answer the user's questions, you can use the following context...\n</system-reminder>\n",
          }],
        }),
        JSON.stringify({
          type: "user",
          content: [{ type: "text", text: "<user_query>\n就是我在输入中的时候 点发送\n</user_query>" }],
        }),
        JSON.stringify({
          type: "assistant",
          content: [{ type: "text", text: "ok" }],
        }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("grok")?.parseFile(path);
      expect(result?.session.first_message).toBe("就是我在输入中的时候 点发送");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("discovers and parses WorkBuddy project JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const projectDir = join(root, "Users-work-demo");
      await mkdir(projectDir, { recursive: true });
      const path = join(projectDir, "sess-abc.jsonl");
      await writeFile(path, [
        JSON.stringify({
          type: "message",
          role: "user",
          sessionId: "sess-abc",
          timestamp: 1_700_000_000_000,
          content: [{ type: "input_text", text: "what can you do" }],
        }),
        JSON.stringify({
          type: "message",
          role: "assistant",
          sessionId: "sess-abc",
          timestamp: 1_700_000_001_000,
          content: [{ type: "output_text", text: "I can help code" }],
        }),
      ].join("\n"));

      expect(await discoverSessionArchiveSessionFiles({ agent: "workbuddy", root })).toEqual([path]);
      const result = await sessionArchiveParserForAgent("workbuddy")?.parseFile(path);
      expect(result?.session).toMatchObject({ id: "workbuddy:sess-abc", agent: "workbuddy", first_message: "what can you do" });
      expect(result?.messages).toHaveLength(2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses OpenClaw JSONL", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const dir = join(root, "main", "sessions");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "test-session.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "session", id: "abc-123", timestamp: "2026-02-25T10:00:00Z", cwd: "/home/user/project" }),
        JSON.stringify({ type: "message", timestamp: "2026-02-25T10:00:01Z", message: { role: "user", content: [{ type: "text", text: "Hello" }], timestamp: "2026-02-25T10:00:01Z" } }),
        JSON.stringify({ type: "message", timestamp: "2026-02-25T10:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "Hi" }], timestamp: "2026-02-25T10:00:02Z" } }),
      ].join("\n"));

      expect(await discoverSessionArchiveSessionFiles({ agent: "openclaw", root })).toEqual([path]);
      const result = await sessionArchiveParserForAgent("openclaw")?.parseFile(path);

      expect(result?.session).toMatchObject({ id: "openclaw:main:abc-123", agent: "openclaw", project: "project", first_message: "Hello" });
      expect(result?.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses QClaw with the OpenClaw-compatible layout", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const dir = join(root, "agent-a", "sessions");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "session.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "session", id: "q1", cwd: "/tmp/qclaw-project" }),
        JSON.stringify({ type: "message", message: { role: "user", content: "hello", timestamp: "2026-01-01T00:00:00Z" } }),
      ].join("\n"));

      expect(await discoverSessionArchiveSessionFiles({ agent: "qclaw", root })).toEqual([path]);
      expect((await sessionArchiveParserForAgent("qclaw")?.parseFile(path))?.session).toMatchObject({ id: "qclaw:agent-a:q1", agent: "qclaw" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses representative Gemini, Kiro, Kimi, Qwen, and generic file-backed sessions", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const geminiPath = join(root, "gemini.json");
      await writeFile(geminiPath, JSON.stringify({ sessionId: "g1", messages: [{ type: "user", content: "hello" }, { type: "gemini", content: [{ type: "text", text: "hi" }] }] }));
      expect((await sessionArchiveParserForAgent("gemini")?.parseFile(geminiPath))?.session).toMatchObject({ id: "gemini:g1", agent: "gemini" });

      const kiroPath = join(root, "k1.jsonl");
      await writeFile(kiroPath, [
        JSON.stringify({ kind: "Prompt", data: { content: "build" } }),
        JSON.stringify({ kind: "AssistantMessage", data: { content: "done" } }),
      ].join("\n"));
      expect((await sessionArchiveParserForAgent("kiro")?.parseFile(kiroPath))?.session).toMatchObject({ id: "kiro:k1", agent: "kiro" });

      const kimiDir = join(root, "wd_demo_abcdef123456", "session_1", "agents", "main");
      await mkdir(kimiDir, { recursive: true });
      const kimiPath = join(kimiDir, "wire.jsonl");
      await writeFile(kimiPath, JSON.stringify({ role: "user", content: "kimi hi" }));
      expect(await discoverSessionArchiveSessionFiles({ agent: "kimi", root })).toContain(kimiPath);
      expect((await sessionArchiveParserForAgent("kimi")?.parseFile(kimiPath))?.session).toMatchObject({ id: "kimi:wd_demo_abcdef123456:main:session_1", agent: "kimi" });

      const qwenDir = join(root, "qwen-project", "chats");
      await mkdir(qwenDir, { recursive: true });
      const qwenPath = join(qwenDir, "q1.jsonl");
      await writeFile(qwenPath, JSON.stringify({ sessionId: "q1", type: "user", message: { role: "user", parts: [{ text: "qwen hi" }] } }));
      expect(await discoverSessionArchiveSessionFiles({ agent: "qwen", root })).toContain(qwenPath);
      expect((await sessionArchiveParserForAgent("qwen")?.parseFile(qwenPath))?.session).toMatchObject({ id: "qwen:q1", agent: "qwen" });

      const genericPath = join(root, "generic.jsonl");
      await writeFile(genericPath, JSON.stringify({ role: "user", content: "generic hi" }));
      expect((await sessionArchiveParserForAgent("amp")?.parseFile(genericPath))?.session).toMatchObject({ id: "amp:generic", agent: "amp" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses Pi and OMP JSONL sessions with session metadata", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "pi-session.jsonl");
      await writeFile(path, [
        JSON.stringify({ type: "session", id: "pi-1", timestamp: "2025-01-01T10:00:00Z", cwd: "/Users/alice/code/my-project", branchedFrom: "/tmp/parent-1.jsonl" }),
        JSON.stringify({ type: "session_info", name: "Pi session" }),
        JSON.stringify({ type: "model_change", modelId: "pi-model" }),
        JSON.stringify({ type: "message", timestamp: "2025-01-01T10:00:01Z", message: { role: "user", content: "Fix the login bug" } }),
        JSON.stringify({ type: "message", timestamp: "2025-01-01T10:00:02Z", message: { role: "assistant", content: [{ type: "text", text: "I'll inspect" }, { type: "tool_use", id: "toolu_1", name: "Read", input: { file_path: "auth.ts" } }] } }),
      ].join("\n"));

      const pi = await sessionArchiveParserForAgent("pi")?.parseFile(path);
      const omp = await sessionArchiveParserForAgent("omp")?.parseFile(path);

      expect(pi?.session).toMatchObject({ id: "pi:pi-1", agent: "pi", project: "my-project", display_name: "Pi session", parent_session_id: "pi:parent-1", relationship_type: "fork" });
      expect(pi?.messages[1]?.tool_calls?.[0]).toMatchObject({ tool_name: "Read", category: "Read" });
      expect(omp?.session).toMatchObject({ id: "omp:pi-1", agent: "omp", parent_session_id: "omp:parent-1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses QwenPaw workspace session JSON", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const dir = join(root, "default", "sessions", "console");
      await mkdir(dir, { recursive: true });
      const path = join(dir, "s1.json");
      await writeFile(path, JSON.stringify({ messages: [
        { role: "user", content: [{ type: "text", text: "qwenpaw hi" }] },
        { role: "assistant", content: [{ type: "thinking", text: "think" }, { type: "text", text: "qwenpaw done" }] },
      ] }));

      expect(await discoverSessionArchiveSessionFiles({ agent: "qwenpaw", root })).toEqual([path]);
      const result = await sessionArchiveParserForAgent("qwenpaw")?.parseFile(path);
      expect(result?.session).toMatchObject({ id: "qwenpaw:default:console:s1", agent: "qwenpaw", project: "default", first_message: "qwenpaw hi" });
      expect(result?.messages[1]).toMatchObject({ has_thinking: true, thinking_text: "think" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("parses Reasonix JSONL with metadata, thinking, and tool calls", async () => {
    const root = await mkdtemp(join(tmpdir(), "onmyagent-session-archive-parser-"));
    try {
      const path = join(root, "session.jsonl");
      await writeFile(`${path}.meta`, JSON.stringify({ id: "rx-1", topic_title: "Reasonix topic", workspace_root: "/Users/alice/code/reasonix-app", model: "reasonix-model" }));
      await writeFile(path, [
        JSON.stringify({ role: "user", content: "Write a simple function" }),
        JSON.stringify({ role: "assistant", content: "Here it is", reasoning_content: "Need a function", tool_calls: [{ id: "call_1", name: "read_file", arguments: '{"path":"config.json"}' }] }),
        JSON.stringify({ role: "tool", tool_call_id: "call_1", content: "file contents" }),
      ].join("\n"));

      const result = await sessionArchiveParserForAgent("reasonix")?.parseFile(path);
      expect(result?.session).toMatchObject({ id: "reasonix:rx-1", agent: "reasonix", project: "reasonix-app", display_name: "Reasonix topic" });
      expect(result?.messages[1]).toMatchObject({ has_thinking: true, model: "reasonix-model" });
      expect(result?.messages[1]?.tool_calls?.[0]).toMatchObject({ tool_name: "read_file", tool_use_id: "call_1" });
      expect(result?.messages[2]).toMatchObject({ source_type: "tool", source_uuid: "call_1" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
