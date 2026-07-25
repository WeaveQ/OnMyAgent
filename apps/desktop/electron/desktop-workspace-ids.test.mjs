import test from "node:test";
import assert from "node:assert/strict";

import {
  localWorkspaceId,
  normalizeWorkspacePathKey,
  remoteWorkspaceId,
  sanitizeCommandName,
  serializeCommandFrontmatter,
  stableWorkspaceId,
  validateSkillName,
} from "./desktop-workspace-ids.mjs";

test("sanitizeCommandName strips slash and keeps safe chars", () => {
  assert.equal(sanitizeCommandName("/hello_world"), "hello_world");
  assert.equal(sanitizeCommandName(" bad name! "), "badname");
  assert.equal(sanitizeCommandName(""), null);
});

test("validateSkillName requires kebab-case", () => {
  assert.equal(validateSkillName("my-skill"), "my-skill");
  assert.throws(() => validateSkillName("Not_Valid"), /kebab-case/);
});

test("serializeCommandFrontmatter requires template", () => {
  assert.throws(() => serializeCommandFrontmatter({}), /template is required/);
  const out = serializeCommandFrontmatter({
    description: "Say hi",
    template: "Hello $NAME",
  });
  assert.match(out, /^---\n/);
  assert.match(out, /description: "Say hi"/);
  assert.match(out, /Hello \$NAME/);
});

test("workspace ids are stable hashes", () => {
  const a = localWorkspaceId("/tmp/ws");
  const b = localWorkspaceId("/tmp/ws");
  assert.equal(a, b);
  assert.match(a, /^ws_[a-f0-9]{12}$/);
  assert.notEqual(
    remoteWorkspaceId("http://h", "/dir"),
    remoteWorkspaceId("http://h", "/other"),
  );
  assert.equal(stableWorkspaceId("x"), stableWorkspaceId("x"));
  assert.equal(
    normalizeWorkspacePathKey("/tmp/A"),
    normalizeWorkspacePathKey("/tmp/A"),
  );
});
