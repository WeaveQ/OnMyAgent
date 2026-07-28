import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  DEFAULT_WORKSPACE_SESSION_LIST_LIMIT,
  formatWorkspaceSessionListTiming,
  normalizeWorkspaceSessionListInput,
  shouldLogSlowWorkspaceSessionList,
  WORKSPACE_SESSION_LIST_SLOW_MS,
} from "../src/services/workspace-session-list-policy.js";

describe("normalizeWorkspaceSessionListInput", () => {
  it("applies default limit when omitted", () => {
    const normalized = normalizeWorkspaceSessionListInput({});
    assert.equal(normalized.limit, DEFAULT_WORKSPACE_SESSION_LIST_LIMIT);
  });

  it("preserves positive client limit", () => {
    const normalized = normalizeWorkspaceSessionListInput({ limit: 12 });
    assert.equal(normalized.limit, 12);
  });

  it("rejects non-positive limit by falling back to default", () => {
    assert.equal(
      normalizeWorkspaceSessionListInput({ limit: 0 }).limit,
      DEFAULT_WORKSPACE_SESSION_LIST_LIMIT,
    );
    assert.equal(
      normalizeWorkspaceSessionListInput({ limit: -3 }).limit,
      DEFAULT_WORKSPACE_SESSION_LIST_LIMIT,
    );
  });
});

describe("shouldLogSlowWorkspaceSessionList", () => {
  it("logs at and above threshold", () => {
    assert.equal(shouldLogSlowWorkspaceSessionList(WORKSPACE_SESSION_LIST_SLOW_MS), true);
    assert.equal(shouldLogSlowWorkspaceSessionList(WORKSPACE_SESSION_LIST_SLOW_MS - 1), false);
  });
});

describe("formatWorkspaceSessionListTiming", () => {
  it("includes workspace id, ms, limit, and item count", () => {
    const line = formatWorkspaceSessionListTiming({
      workspaceId: "ws_1",
      durationMs: 1200.4,
      limit: 40,
      itemCount: 9,
      roots: true,
      search: true,
    });
    assert.match(line, /workspace=ws_1/);
    assert.match(line, /ms=1200/);
    assert.match(line, /limit=40/);
    assert.match(line, /items=9/);
    assert.match(line, /roots=1/);
    assert.match(line, /search=1/);
  });
});
