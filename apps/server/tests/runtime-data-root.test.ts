import { describe, expect, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import type { WorkspaceInfo } from "@onmyagent/types/server";
import { resolveAgentRuntimeSelectionPath } from "../src/services/agent-runtime-selection.js";
import { resolveRuntimeDataRoot } from "../src/services/runtime-data-root.js";
import { resolveRuntimeSessionBindingStorePath } from "../src/services/runtime-session-bindings.js";

const workspace: WorkspaceInfo = {
  id: "runtime-root-workspace",
  name: "Runtime root workspace",
  path: join(homedir(), "fixture-workspace"),
  preset: "starter",
  workspaceType: "local",
};

describe("resolveRuntimeDataRoot", () => {
  test("keeps primary runtime selection and bindings under one server-owned data root", () => {
    const root = resolveRuntimeDataRoot();
    expect(resolveAgentRuntimeSelectionPath()).toStartWith(root);
    expect(resolveRuntimeSessionBindingStorePath({ workspace })).toStartWith(root);
  });

  test("honors an explicit composition root for primary runtime state", () => {
    const root = join(homedir(), "fixture-runtime-root");
    expect(resolveRuntimeDataRoot(root)).toBe(root);
    expect(resolveAgentRuntimeSelectionPath(root)).toStartWith(root);
    expect(resolveRuntimeSessionBindingStorePath({ workspace, dataRoot: root })).toStartWith(root);
  });

  test("does not default a production macOS server to the development app root", () => {
    if (
      process.platform !== "darwin" ||
      process.env.ONMYAGENT_PRIMARY_RUNTIME_DATA_ROOT?.trim()
    ) return;
    if (process.env.ONMYAGENT_DEV_MODE === "1") return;
    expect(resolveRuntimeDataRoot()).toEndWith(
      join("Library", "Application Support", "com.differentai.onmyagent"),
    );
    expect(resolveRuntimeDataRoot()).not.toContain("com.differentai.onmyagent.dev");
  });
});
