import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { resolveExpertSessionRuntimeRoot } from "./expert-session-runtime-path.mjs";

test("resolves the app-managed expert session runtime root beneath user data", () => {
  const userDataDir = path.join(path.sep, "tmp", "onmyagent-user-data");
  assert.equal(
    resolveExpertSessionRuntimeRoot(userDataDir),
    path.join(userDataDir, "expert-sessions"),
  );
});
