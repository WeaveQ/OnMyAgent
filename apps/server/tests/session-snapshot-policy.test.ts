import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ApiError } from "../src/core/errors.js";
import {
  isSessionNotFoundApiError,
  sessionNotFoundError,
  shouldRetryWorkspaceSessionSnapshot,
} from "../src/services/session-snapshot-policy.js";

describe("session-snapshot-policy", () => {
  it("builds canonical session_not_found errors used by workspace-sessions", () => {
    const error = sessionNotFoundError({ status: 404 });
    assert.equal(error.status, 404);
    assert.equal(error.code, "session_not_found");
    assert.equal(isSessionNotFoundApiError(error), true);
    assert.equal(shouldRetryWorkspaceSessionSnapshot(error), false);
  });

  it("retries non-404 failures", () => {
    const error = new ApiError(502, "opencode_request_failed", "upstream");
    assert.equal(shouldRetryWorkspaceSessionSnapshot(error), true);
  });

  it("workspace-sessions snapshot path imports and uses sessionNotFoundError", async () => {
    const source = await Bun.file(
      new URL("../src/services/workspace-sessions.ts", import.meta.url),
    ).text();
    assert.match(source, /sessionNotFoundError/);
    assert.match(source, /shouldRetryWorkspaceSessionSnapshot/);
    assert.match(source, /from "\.\/session-snapshot-policy\.js"/);
  });
});
