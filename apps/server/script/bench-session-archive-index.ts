import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { openSessionArchiveIndex } from "../src/services/session-archive-index.js";

const SESSION_COUNT = 10_000;
const AGENTS: Array<{ dir: string; agent: string }> = [
  { dir: ".codex/sessions", agent: "codex" },
  { dir: ".claude/projects/proj-a", agent: "claude" },
  { dir: ".gemini/tmp", agent: "gemini" },
  { dir: ".openclaw/agents/proj-a", agent: "openclaw" },
];

async function main() {
  const home = await mkdtemp(join(tmpdir(), "sa-bench-"));
  const cacheDb = join(home, "cache.sqlite");
  console.log("home:", home);

  const seedStart = performance.now();
  for (const agent of AGENTS) await mkdir(join(home, agent.dir), { recursive: true });
  for (let i = 0; i < SESSION_COUNT; i++) {
    const agent = AGENTS[i % AGENTS.length];
    const filePath = join(home, agent.dir, "sess-" + i + ".jsonl");
    const header = JSON.stringify({
      sessionId: agent.agent + "-" + i,
      title: "Session " + i,
      cwd: "/proj/" + (i % 20),
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
      updatedAt: new Date(Date.now() - i * 30000).toISOString(),
    });
    const body = JSON.stringify({ role: "user", content: "msg-" + i });
    await writeFile(filePath, header + "\n" + body + "\n");
  }
  console.log("seed:", (performance.now() - seedStart).toFixed(0), "ms /", SESSION_COUNT, "files");

  let maxLagMs = 0;
  const sampler = setInterval(() => {
    const scheduledAt = performance.now();
    setImmediate(() => {
      const observed = performance.now() - scheduledAt;
      if (observed > maxLagMs) maxLagMs = observed;
    });
  }, 5);

  const index = await openSessionArchiveIndex({ homeDir: home, env: {}, cacheDbPath: cacheDb, autoWatch: false });
  try {
    const coldStart = performance.now();
    const cold = await index.refresh();
    const coldMs = performance.now() - coldStart;
    console.log("cold refresh:", coldMs.toFixed(0), "ms ->", cold.length, "summaries");

    const listStart = performance.now();
    const page = index.list({ limit: 200 });
    const listMs = performance.now() - listStart;
    console.log("list(200):", listMs.toFixed(1), "ms total=" + page.total, "agents=" + page.agentCounts.length);

    const warmStart = performance.now();
    const warm = await index.refresh();
    const warmMs = performance.now() - warmStart;
    console.log("warm refresh:", warmMs.toFixed(0), "ms ->", warm.length, "summaries");
  } finally {
    index.close();
    clearInterval(sampler);
  }

  console.log("event-loop max lag:", maxLagMs.toFixed(1), "ms");
  await rm(home, { recursive: true, force: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
