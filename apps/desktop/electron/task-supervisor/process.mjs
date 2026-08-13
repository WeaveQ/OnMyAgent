import path from "node:path";
import { pathToFileURL } from "node:url";

import { createTaskSupervisorServer } from "./server.mjs";
import { createTaskSupervisorService } from "./service.mjs";
import { randomSupervisorEpoch } from "./protocol.mjs";
import { createTaskSupervisorStructuredLog } from "./structured-log.mjs";

function argumentValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

async function loadService(modulePath, options) {
  if (!modulePath) return createTaskSupervisorService(options);
  const imported = await import(pathToFileURL(path.resolve(modulePath)).href);
  const factory = imported.createTaskSupervisorService ?? imported.default;
  if (typeof factory !== "function") throw new Error("Task Supervisor service module must export createTaskSupervisorService");
  return factory(options);
}

export async function startTaskSupervisorProcess(options = {}) {
  const userDataDir = path.resolve(String(options.userDataDir ?? ""));
  const descriptorPath = options.descriptorPath;
  if (!userDataDir) throw new Error("Task Supervisor userDataDir is required");
  const supervisorEpoch = String(options.supervisorEpoch ?? randomSupervisorEpoch());
  const structuredLog = options.structuredLog ?? createTaskSupervisorStructuredLog({ userDataDir });
  await structuredLog.write("info", "supervisor-starting", { supervisorEpoch });
  const service = await loadService(options.serviceModule, {
    ...options,
    userDataDir,
    supervisorEpoch,
    structuredLog,
  });
  const server = createTaskSupervisorServer({
    ...options,
    userDataDir,
    ...(descriptorPath ? { descriptorPath } : {}),
    supervisorEpoch,
    service,
  });
  await server.listen();
  await structuredLog.write("info", "supervisor-ready", { supervisorEpoch });
  const onSignal = (signal) => { void server.handleSignal(signal); };
  process.once("SIGTERM", () => onSignal("SIGTERM"));
  process.once("SIGINT", () => onSignal("SIGINT"));
  process.once("disconnect", () => { void server.handleSignal("disconnect"); });
  return server;
}

async function main() {
  const userDataDir = argumentValue("--user-data") ?? process.env.ONMYAGENT_TASK_SUPERVISOR_USER_DATA;
  const descriptorPath = argumentValue("--descriptor") ?? process.env.ONMYAGENT_TASK_SUPERVISOR_DESCRIPTOR;
  const serviceModule = argumentValue("--service-module") ?? process.env.ONMYAGENT_TASK_SUPERVISOR_SERVICE_MODULE;
  if (!userDataDir) throw new Error("Task Supervisor process requires --user-data");
  // `descriptorPath` is passed explicitly by the client so a long/relocated
  // userData path does not change the child identity during a reconnect.
  const structuredLog = createTaskSupervisorStructuredLog({ userDataDir });
  process.on("uncaughtException", (error) => { void structuredLog.recordCrash(error, { source: "uncaughtException" }).finally(() => process.exit(1)); });
  process.on("unhandledRejection", (error) => { void structuredLog.recordCrash(error, { source: "unhandledRejection" }).finally(() => process.exit(1)); });
  const server = await startTaskSupervisorProcess({ userDataDir, descriptorPath, serviceModule, structuredLog });
  process.stdout.write(`${JSON.stringify({ ready: true, pid: process.pid, descriptor: server.descriptor() })}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch(async (error) => {
    const userDataDir = argumentValue("--user-data") ?? process.env.ONMYAGENT_TASK_SUPERVISOR_USER_DATA;
    if (userDataDir) await createTaskSupervisorStructuredLog({ userDataDir }).recordCrash(error, { source: "startup" }).catch(() => undefined);
    process.exitCode = 1;
  });
}
