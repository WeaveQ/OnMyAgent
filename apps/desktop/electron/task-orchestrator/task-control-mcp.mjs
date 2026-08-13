/**
 * Minimal task-scoped MCP stdio bridge used by ACP providers that advertise
 * mcpServers. It never owns task state: each call is written to the durable
 * queue owned by the Electron Task Supervisor and the response is read back.
 */
import { randomUUID } from "node:crypto";
import { watch } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import readline from "node:readline";

const queueDirectory = path.resolve(String(process.argv[2] ?? ""));
const token = String(process.argv[3] ?? "");
const alignment = process.argv.includes("--alignment");
const timeoutArgument = process.argv.find((argument) => argument.startsWith("--timeout-ms="));
const requestedHostTimeoutMs = Number(timeoutArgument?.slice("--timeout-ms=".length));
const hostTimeoutMs = Number.isFinite(requestedHostTimeoutMs)
  ? Math.max(1_000, Math.min(14_400_000, Math.trunc(requestedHostTimeoutMs)))
  : 900_000;
const requests = path.join(queueDirectory, "requests");
const responses = path.join(queueDirectory, "responses");
await mkdir(requests, { recursive: true });
await mkdir(responses, { recursive: true });
let closing = false;
const RESPONSE_POLL_MIN_MS = 30;
const RESPONSE_POLL_MAX_MS = 500;
const responseWaiters = new Set();

function wakeResponseWaiters(source = "watch") {
  for (const waiter of [...responseWaiters]) waiter(source);
}

let responseWatcher = null;
try {
  responseWatcher = watch(responses, () => wakeResponseWaiters("watch"));
  responseWatcher.on("error", () => {
    responseWatcher?.close();
    responseWatcher = null;
  });
  responseWatcher.unref?.();
} catch {
  responseWatcher = null;
}

function waitForResponse(delayMs) {
  if (closing) return Promise.resolve("closing");
  return new Promise((resolve) => {
    let settled = false;
    const finish = (source) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      responseWaiters.delete(finish);
      resolve(source);
    };
    const timer = setTimeout(() => finish("timer"), delayMs);
    timer.unref?.();
    responseWaiters.add(finish);
  });
}

function closeResponseWaiter() {
  responseWatcher?.close();
  responseWatcher = null;
  wakeResponseWaiters("closing");
}

const contractSchema = {
  type: "object",
  additionalProperties: false,
  required: ["outcome", "deliverables", "acceptance", "scope", "verification"],
  properties: {
    outcome: { type: "string", minLength: 1, maxLength: 24_000 },
    deliverables: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", minLength: 1, maxLength: 4_000 } },
    acceptance: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", minLength: 1, maxLength: 4_000 } },
    scope: {
      type: "object",
      additionalProperties: false,
      required: ["included", "excluded"],
      properties: {
        included: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 4_000 } },
        excluded: { type: "array", maxItems: 50, items: { type: "string", minLength: 1, maxLength: 4_000 } },
      },
    },
    verification: { type: "array", minItems: 1, maxItems: 50, items: { type: "string", minLength: 1, maxLength: 4_000 } },
  },
};

const criterionResultSchema = {
  type: "object",
  additionalProperties: false,
  required: ["criterionIndex", "status", "summary"],
  properties: {
    criterionIndex: { type: "integer", minimum: 0, maximum: 49 },
    status: { type: "string", enum: ["passed", "failed"] },
    summary: { type: "string", minLength: 1, maxLength: 4_000 },
    evidenceArtifactIds: {
      type: "array",
      maxItems: 20,
      items: { type: "string", minLength: 1, maxLength: 120 },
    },
  },
};

function decisionSchema({ acceptanceRequired = false } = {}) {
  return {
    type: "object",
    additionalProperties: false,
    required: acceptanceRequired ? ["summary", "acceptanceResults"] : ["summary"],
    properties: {
      summary: { type: "string", minLength: 1, maxLength: 4_000 },
      nextAction: { type: ["string", "null"], minLength: 1, maxLength: 4_000 },
      acceptanceResults: { type: "array", maxItems: 50, items: criterionResultSchema },
    },
  };
}

const toolDefinitions = {
  get_task_state: {
    description: "Read the frozen contract, durable attempt state, artifact references and recorded primary decisions.",
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  list_agents: {
    description: "List the allowed worker profiles for this task.",
    inputSchema: { type: "object", additionalProperties: false, required: [], properties: {} },
  },
  spawn_agent: {
    description: "Spawn one allowed depth-one worker.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["workerProfileId", "prompt"],
      properties: {
        workerProfileId: { type: "string", minLength: 1, maxLength: 120 },
        prompt: { type: "string", minLength: 1, maxLength: 24_000 },
      },
    },
  },
  send_message: {
    description: "Create a depth-one follow-up for a terminal worker attempt.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["attemptId", "text"],
      properties: {
        attemptId: { type: "string", minLength: 1, maxLength: 120 },
        text: { type: "string", minLength: 1, maxLength: 24_000 },
      },
    },
  },
  wait_agent: {
    description: "Wait for a worker attempt to reach a terminal state.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["attemptId"],
      properties: { attemptId: { type: "string", minLength: 1, maxLength: 120 } },
    },
  },
  close_agent: {
    description: "Cancel an active worker attempt.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["attemptId"],
      properties: { attemptId: { type: "string", minLength: 1, maxLength: 120 } },
    },
  },
  checkpoint_task: {
    description: "Record that the current primary turn reached a safe checkpoint and needs a fresh bounded continuation. If workers are active, this returns a retryable active_workers result; wait for or close them, then retry.",
    inputSchema: decisionSchema(),
  },
  continue_task: {
    description: "Record that the task is incomplete and requires another bounded primary turn. If workers are active, this returns a retryable active_workers result; wait for or close them, then retry.",
    inputSchema: decisionSchema(),
  },
  complete_task: {
    description: "Complete the frozen task only after every acceptance criterion has a passed structured result and every spawned worker is terminal. If workers are active, this returns a retryable active_workers result; wait for or close them, then retry.",
    inputSchema: decisionSchema({ acceptanceRequired: true }),
  },
  block_task: {
    description: "Block the task with an actionable reason when it cannot safely continue without external intervention.",
    inputSchema: decisionSchema(),
  },
  realign_task: {
    description: "Return the task to human alignment because the frozen contract is no longer executable as written.",
    inputSchema: decisionSchema(),
  },
  propose_contract: {
    description: "Submit a validated structured task contract proposal.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["contract"],
      properties: { contract: contractSchema },
    },
  },
};

const EXECUTION_TOOLS = [
  "get_task_state",
  "list_agents",
  "spawn_agent",
  "send_message",
  "wait_agent",
  "close_agent",
  "checkpoint_task",
  "continue_task",
  "complete_task",
  "block_task",
  "realign_task",
];
const TOOLS = alignment ? ["propose_contract"] : EXECUTION_TOOLS;

async function callHost(name, args) {
  const id = randomUUID();
  const requestPath = path.join(requests, `${id}.json`);
  const responsePath = path.join(responses, `${id}.json`);
  const payload = { id, token, tool: name, arguments: args && typeof args === "object" ? args : {} };
  const temporary = `${requestPath}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(payload), "utf8");
  await rename(temporary, requestPath);
  const deadline = Date.now() + hostTimeoutMs;
  let idleDelay = RESPONSE_POLL_MIN_MS;
  while (!closing && Date.now() < deadline) {
    try {
      const response = JSON.parse(await readFile(responsePath, "utf8"));
      await rm(responsePath, { force: true });
      if (response?.error) throw new Error(String(response.error));
      return response?.result ?? null;
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const source = await waitForResponse(Math.min(idleDelay, Math.max(1, deadline - Date.now())));
      idleDelay = source === "watch"
        ? RESPONSE_POLL_MIN_MS
        : Math.min(RESPONSE_POLL_MAX_MS, idleDelay * 2);
    }
  }
  await Promise.allSettled([rm(requestPath, { force: true }), rm(responsePath, { force: true })]);
  if (closing) throw new Error("Task control bridge closed before the host response arrived");
  throw new Error(`Task control bridge timed out after ${hostTimeoutMs}ms waiting for the Supervisor host`);
}

function reply(id, result, error = null) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: "2.0", id, ...(error ? { error: { code: -32000, message: error } } : { result }) })}\n`);
}

const input = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
input.once("close", () => {
  closing = true;
  closeResponseWaiter();
});
const stop = () => {
  closing = true;
  closeResponseWaiter();
  process.exitCode = 0;
  input.close();
};
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
input.on("line", async (line) => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch { return; }
  const id = request?.id ?? null;
  try {
    const method = String(request?.method ?? "");
    if (method === "initialize") {
      reply(id, { protocolVersion: "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "onmyagent-task-control", version: "2" } });
      return;
    }
    if (method === "notifications/initialized") return;
    if (method === "tools/list") {
      reply(id, { tools: TOOLS.map((name) => ({ name, ...toolDefinitions[name] })) });
      return;
    }
    if (method === "tools/call") {
      const name = String(request?.params?.name ?? "");
      if (!TOOLS.some((tool) => tool === name)) throw new Error(`Unknown task control tool: ${name}`);
      const result = await callHost(name, request?.params?.arguments ?? {});
      reply(id, { content: [{ type: "text", text: JSON.stringify(result ?? null) }], structuredContent: result ?? null });
      return;
    }
    if (id !== null) reply(id, {});
  } catch (error) {
    if (id !== null) reply(id, null, error instanceof Error ? error.message : String(error));
  }
});
