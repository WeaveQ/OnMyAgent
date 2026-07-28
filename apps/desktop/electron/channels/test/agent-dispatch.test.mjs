import { strict as assert } from "node:assert";

import { __test__ } from "../agent-dispatch.mjs";

const {
  normalizeAvailableAgents,
  resolveAgentAlias,
  parseAgentSwitchCommand,
  renderAgentHelp,
  ONMYAGENT_ASSISTANT_AGENT_ID,
  ONMYAGENT_ASSISTANT_PROVIDER,
} = __test__;

const fallback = { provider: "opencode", id: "opencode" };
const external = [
  { provider: "codex", id: "codex" },
  { provider: "claude", id: "claude" },
];

console.log("Test A: onmyagent pseudo-agent is injected into available agents");
const agents = normalizeAvailableAgents(external, fallback);
const onmyagent = agents.find((a) => a.id === ONMYAGENT_ASSISTANT_AGENT_ID);
assert.ok(onmyagent, "onmyagent must be present in available agents");
assert.equal(
  onmyagent.provider,
  ONMYAGENT_ASSISTANT_PROVIDER,
  "provider must stay onmyagent-assistant (not forced back to opencode by normalize)",
);
assert.equal(onmyagent.name, "本地助理 OnMyAgent");
console.log("✓ onmyagent injected with preserved provider");

console.log("Test B: existing external agents are untouched");
assert.ok(agents.find((a) => a.id === "codex" && a.provider === "codex"));
assert.ok(agents.find((a) => a.id === "claude" && a.provider === "claude"));
assert.ok(agents.find((a) => a.id === "opencode" && a.provider === "opencode"));
console.log("✓ codex/claude/opencode preserved");

console.log("Test C: no duplicate injection when onmyagent already present");
const dup = normalizeAvailableAgents(
  [{ provider: ONMYAGENT_ASSISTANT_PROVIDER, id: ONMYAGENT_ASSISTANT_AGENT_ID }],
  fallback,
);
assert.equal(
  dup.filter((a) => a.id === ONMYAGENT_ASSISTANT_AGENT_ID).length,
  1,
  "exactly one onmyagent entry",
);
console.log("✓ no duplicate");

console.log("Test D: resolveAgentAlias matches onmyagent variants");
assert.equal(resolveAgentAlias(agents, "onmyagent")?.id, ONMYAGENT_ASSISTANT_AGENT_ID);
assert.equal(resolveAgentAlias(agents, "onmyagent-assistant")?.id, ONMYAGENT_ASSISTANT_AGENT_ID);
assert.equal(resolveAgentAlias(agents, "本地助理 onmyagent")?.id, ONMYAGENT_ASSISTANT_AGENT_ID);
console.log("✓ alias resolution works");

console.log("Test E: parseAgentSwitchCommand('#agent onmyagent')");
const cmd = parseAgentSwitchCommand("#agent onmyagent");
assert.ok(cmd);
assert.equal(cmd.target, "onmyagent");
assert.equal(parseAgentSwitchCommand("/agent onmyagent")?.target, "onmyagent");
console.log("✓ parse works");

console.log("Test F: rolling back to an external agent still resolves (no break)");
assert.equal(resolveAgentAlias(agents, "codex")?.id, "codex");
assert.equal(resolveAgentAlias(agents, "claude")?.id, "claude");
console.log("✓ rollback works, existing agents unaffected");

console.log("Test G: renderAgentHelp lists onmyagent");
const help = renderAgentHelp(
  {
    options: {
      agent: { id: "opencode", provider: "opencode" },
      agentByChat: new Map(),
      availableAgents: agents,
    },
  },
  "chat-1",
);
assert.ok(help.includes("onmyagent"), "help text should list onmyagent");
console.log("✓ help lists onmyagent");

console.log("\n✅ All agent-dispatch onmyagent (P1-01/P1-02) tests passed!");
