import assert from "node:assert/strict";
import test from "node:test";

import { createExpertMarketplace } from "./expert-marketplace.mjs";

test("my expert packages preserve role prompt, memory, and selected skills", () => {
  const marketplace = createExpertMarketplace({ getRealHomeDir: () => "/tmp/onmyagent-test-home" });
  const files = marketplace.myExpertPackageFiles({
    name: "Decision coach",
    description: "Helps compare options.",
    rolePrompt: "Ask for constraints before making a recommendation.",
    memory: "Remember the user's preferred risk level.",
    skillIds: ["research", "planning"],
  }, "decision-coach");

  assert.deepEqual(files.plugin.agentConfig, {
    rolePrompt: "Ask for constraints before making a recommendation.",
    memory: "Remember the user's preferred risk level.",
    skillIds: ["research", "planning"],
  });
  assert.match(files.agentMarkdown, /## 角色提示词/);
  assert.match(files.agentMarkdown, /Ask for constraints/);
  assert.match(files.agentMarkdown, /## 专家记忆/);
  assert.match(files.agentMarkdown, /preferred risk level/);
  assert.match(files.agentMarkdown, /`research`、`planning`/);
});
