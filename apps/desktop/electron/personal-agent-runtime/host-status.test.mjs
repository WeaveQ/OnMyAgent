import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { buildSkillStatus, buildMcpStatus, buildPermissionStatus } from "./host-status.mjs";

describe("host-status skill view-model", () => {
  it("returns empty when no native_skills_dirs provided", async () => {
    const result = await buildSkillStatus({ nativeSkillsDirs: [] });
    assert.deepEqual(result, { skills: [], roots: [], error: null });
  });

  it("marks missing root as non-existent without throwing", async () => {
    const result = await buildSkillStatus({ nativeSkillsDirs: ["/definitely/not/a/path/xyz-123"] });
    assert.equal(result.skills.length, 0);
    assert.equal(result.roots.length, 1);
    assert.equal(result.roots[0].exists, false);
  });

  it("collects SKILL.md packages including .system bundled skills", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "host-status-skill-"));
    try {
      const skillDir = path.join(tmp, "quick-summary");
      await mkdir(skillDir, { recursive: true });
      await writeFile(path.join(skillDir, "SKILL.md"), "# skill\n");
      const nestedDir = path.join(tmp, "team", "issue-breakdown");
      await mkdir(nestedDir, { recursive: true });
      await writeFile(path.join(nestedDir, "SKILL.md"), "# nested\n");
      // .system is the bundled-skills convention (e.g. ~/.codex/skills/.system/*)
      // and must be discoverable even though it starts with a dot.
      const systemSkill = path.join(tmp, ".system", "imagegen");
      await mkdir(systemSkill, { recursive: true });
      await writeFile(path.join(systemSkill, "SKILL.md"), "# system\n");
      // Other dot dirs must still be skipped.
      const hiddenSkill = path.join(tmp, ".hidden", "should-skip");
      await mkdir(hiddenSkill, { recursive: true });
      await writeFile(path.join(hiddenSkill, "SKILL.md"), "# hidden\n");
      const result = await buildSkillStatus({ nativeSkillsDirs: [tmp] });
      const names = new Set(result.skills.map((s) => s.name));
      assert.ok(names.has("quick-summary"), "quick-summary missing");
      assert.ok(names.has("issue-breakdown"), "issue-breakdown missing");
      assert.ok(names.has("imagegen"), ".system-nested skill missing");
      assert.ok(!names.has("should-skip"), "hidden dot directory leaked in");
      assert.equal(result.roots[0].exists, true);
      for (const skill of result.skills) assert.equal(skill.provenance, "workspace");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("deduplicates skills discovered through multiple overlapping roots", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "host-status-skill-dup-"));
    try {
      const skillDir = path.join(tmp, "root", "quick-summary");
      await mkdir(skillDir, { recursive: true });
      await writeFile(path.join(skillDir, "SKILL.md"), "# dup\n");
      const result = await buildSkillStatus({ nativeSkillsDirs: [tmp, path.join(tmp, "root")] });
      const matches = result.skills.filter((s) => path.basename(s.indexFile) === "SKILL.md");
      assert.equal(matches.length, 1, `expected 1 dedup, got ${matches.length}`);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});

describe("host-status mcp view-model", () => {
  it("returns empty when no messages or commands", () => {
    const result = buildMcpStatus({});
    assert.deepEqual(result, { servers: [], error: null });
  });

  it("aggregates tool calls tagged with mcp:<server> source", () => {
    const result = buildMcpStatus({
      conversationMessages: [
        { type: "acp_tool_call", toolCall: { source: "mcp:github", name: "list_repos" } },
        { type: "acp_tool_call", toolCall: { source: "mcp:github", name: "get_pr" } },
        { type: "acp_tool_call", toolCall: { source: "builtin", name: "read_file" } },
      ],
    });
    assert.equal(result.servers.length, 1);
    assert.equal(result.servers[0].name, "github");
    assert.equal(result.servers[0].toolCount, 2);
    assert.equal(result.servers[0].connected, true);
  });

  it("includes servers advertised through available_commands.source", () => {
    const result = buildMcpStatus({
      availableCommands: [
        { name: "search", source: "mcp:brave" },
        { name: "read", source: "builtin" },
      ],
    });
    assert.equal(result.servers.length, 1);
    assert.equal(result.servers[0].name, "brave");
    assert.equal(result.servers[0].toolCount, 0);
  });
});

describe("host-status permission view-model", () => {
  it("counts pending / approved / denied separately", () => {
    const status = buildPermissionStatus({
      pendingApprovals: [
        { id: "p1", summary: "run tests", method: "tool/run" },
      ],
      conversationMessages: [
        { type: "permission", createdAt: 100, approval: { id: "d1", decision: "accept", summary: "read file", method: "fs/read" } },
        { type: "permission", createdAt: 200, approval: { id: "d2", decision: "acceptForSession", summary: "delete", method: "fs/delete" } },
        { type: "permission", createdAt: 300, approval: { id: "d3", decision: "reject", summary: "sudo", method: "shell/exec" } },
        { type: "text", text: "not a permission" },
      ],
      rememberedDecisions: [{ key: "abc" }, { key: "def" }],
    });
    assert.equal(status.pending, 1);
    assert.equal(status.approved, 2);
    assert.equal(status.denied, 1);
    assert.equal(status.remembered, 2);
    assert.equal(status.items.length, 4);
    assert.equal(status.items[0].state, "pending");
    const approved = status.items.filter((item) => item.state === "approved");
    assert.equal(approved.length, 2);
  });

  it("returns zeros on empty input", () => {
    const status = buildPermissionStatus({});
    assert.equal(status.pending, 0);
    assert.equal(status.approved, 0);
    assert.equal(status.denied, 0);
    assert.equal(status.remembered, 0);
    assert.equal(status.items.length, 0);
  });
});
