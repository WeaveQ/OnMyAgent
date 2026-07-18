import { spawn } from "node:child_process";

import { extractOpenClawPayloadText, isOpenClawFallbackSuccessLine, isRecoverableOpenClawFallbackLine } from "../../personal-local-agent-runtime.mjs";
import { injectPersonalAgentContext } from "../context-injection.mjs";
import { readSession, writeSession } from "../session-store.mjs";
import { createExecHelpers, runId, stringifyAgentCommand, terminateProcessTree } from "../utils.mjs";
import { ensureProviderWorkdir } from "../workdir.mjs";
import { unregisterAgentProcess } from "../process-registry.mjs";

const DEFAULT_TURN_TIMEOUT_MS = 10 * 60_000;

function buildArgs(ctx, sessionId) {
  const args = ["agent", "--local", "--json", "--session-id", sessionId, "--timeout", "600"];
  if (ctx.model) args.push("--agent", ctx.model);
  args.push(...(ctx.agent.customArgs ?? []));
  args.push("--message", ctx.prompt);
  return args;
}

function parseJsonLike(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function firstJsonObjectStart(text) {
  const lines = String(text ?? "").split(/\r?\n/);
  let offset = 0;
  for (const line of lines) {
    if (line.startsWith("{")) return offset;
    offset += line.length + 1;
  }
  return -1;
}

function parseWholeResult(stdout) {
  const trimmed = String(stdout ?? "").trim();
  if (!trimmed) return null;
  const direct = parseJsonLike(trimmed);
  if (direct && (Array.isArray(direct.payloads) || direct.meta)) return direct;
  const start = firstJsonObjectStart(trimmed);
  if (start >= 0) {
    const parsed = parseJsonLike(trimmed.slice(start).trim());
    if (parsed && (Array.isArray(parsed.payloads) || parsed.meta)) return parsed;
  }
  return null;
}

function eventErrorMessage(event) {
  return String(event?.error?.data?.message ?? event?.error?.message ?? event?.message ?? event?.text ?? event?.error?.name ?? "unknown openclaw error").trim();
}

function parseOutput(stdout, appendEvent) {
  const outputParts = [];
  let sessionId = "";
  let failedError = "";
  let gotStructured = false;

  const whole = parseWholeResult(stdout);
  if (whole) {
    gotStructured = true;
    const text = extractOpenClawPayloadText(whole);
    if (text) outputParts.push(text);
    sessionId = String(whole?.meta?.agentMeta?.sessionId ?? whole?.sessionId ?? "").trim();
    return { output: outputParts.join("\n").trim(), sessionId, error: "", gotStructured };
  }

  const rawLines = [];
  for (const line of String(stdout ?? "").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parsed = trimmed.startsWith("{") ? parseJsonLike(trimmed) : null;
    if (!parsed) {
      rawLines.push(trimmed);
      continue;
    }
    gotStructured = true;
    if (parsed.sessionId) sessionId = String(parsed.sessionId);
    if (parsed.type === "text" && typeof parsed.text === "string") {
      outputParts.push(parsed.text);
      appendEvent({ type: "assistant_chunk", text: parsed.text });
      continue;
    }
    if (parsed.type === "error" || (parsed.type === "lifecycle" && ["error", "failed", "cancelled"].includes(String(parsed.phase)))) {
      failedError = eventErrorMessage(parsed);
      appendEvent({ type: "error", text: failedError });
      continue;
    }
    if (parsed.type === "tool_use") {
      appendEvent({ type: "tool", text: `tool_start> ${parsed.tool ?? "tool"}` });
      continue;
    }
    if (parsed.type === "tool_result") {
      appendEvent({ type: "tool", text: `tool_result> ${String(parsed.text ?? "").slice(0, 1200)}` });
      continue;
    }
    const payloadText = extractOpenClawPayloadText(parsed);
    if (payloadText) outputParts.push(payloadText);
  }

  const output = outputParts.join("\n").trim();
  if (!gotStructured && rawLines.length) return { output: rawLines.join("\n").trim(), sessionId, error: "", gotStructured: false };
  return { output, sessionId, error: failedError, gotStructured };
}

function waitForProcess(child, timeoutMs) {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      // Tree-kill on timeout so Windows agent grandchildren do not orphan.
      void terminateProcessTree(child).catch(() => undefined);
    }, timeoutMs);
    child.stdout?.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code: 1, signal: null, stdout, stderr: stderr || error.message });
    });
    child.once("close", (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, signal, stdout, stderr });
    });
  });
}

export function createOpenClawAdapter({ appendEvent, registerCancel }) {
  const execHelpers = createExecHelpers();
  const active = new Map();

  return {
    provider: "openclaw",
    async sendMessage(ctx) {
      const executablePath = ctx.agent.executablePath || "openclaw";
      const workdir = await ensureProviderWorkdir(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      await injectPersonalAgentContext({ workdir, provider: ctx.agent.provider, workspaceRoot: ctx.workspaceRoot, accessibleWorkspaceRoots: ctx.accessibleWorkspaceRoots });
      const stored = await readSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id);
      const sessionId = String(ctx.resumeKey ?? ctx.providerSessionId ?? stored.sessionId ?? "").trim() || `onmyagent-openclaw-${runId()}`;
      const args = buildArgs(ctx, sessionId);
      const command = stringifyAgentCommand(executablePath, args);
      appendEvent({ type: "log", text: command });
      const child = spawn(executablePath, args, {
        cwd: workdir,
        env: execHelpers.processEnv({ PWD: workdir }),
        windowsHide: true,
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      child.unref?.();
      if (ctx.runId) active.set(ctx.runId, child);
      registerCancel?.(async () => {
        await terminateProcessTree(child);
        if (ctx.runId) {
          active.delete(ctx.runId);
          unregisterAgentProcess(ctx.runId);
        }
      });
      appendEvent({ type: "log", text: `pid ${child.pid ?? "unknown"}` });

      try {
        const result = await waitForProcess(child, DEFAULT_TURN_TIMEOUT_MS);
        const stderrLines = String(result.stderr ?? "")
          .split(/\r?\n/)
          .map((line) => line.trim())
          .filter(Boolean);
        let recoverableFallback = false;
        let fallbackSucceeded = false;
        for (const line of stderrLines) {
          if (isOpenClawFallbackSuccessLine(line)) fallbackSucceeded = true;
          if (isRecoverableOpenClawFallbackLine(line)) recoverableFallback = true;
          appendEvent({ type: "log", text: `stderr> ${line}` });
        }
        const parsed = parseOutput(result.stdout, appendEvent);
        const output = parsed.output.trim();
        const failedExit = result.code !== 0 && !(output && (fallbackSucceeded || recoverableFallback));
        if (parsed.error) throw new Error(parsed.error);
        if (failedExit) throw new Error((result.stderr || `openclaw exited with code ${result.code ?? "unknown"}`).trim());
        if (!output) throw new Error("openclaw returned no parseable output");
        const liveSessionId = parsed.sessionId || sessionId;
        await writeSession(ctx.workspaceRoot, ctx.agent.provider, ctx.agent.id, {
          sessionId: liveSessionId,
          workdir,
          updatedAt: Date.now(),
        });
        return {
          output,
          command: [command, `sessionID=${liveSessionId}`, `cwd=${workdir}`, ctx.model ? `openclawAgent=${ctx.model}` : "openclawAgent=<default>"].join("\n"),
          connectionMode: "OpenClaw local agent JSON session",
          sessionId: liveSessionId,
          providerSessionId: liveSessionId,
          resumeKey: sessionId,
          workdir,
          pid: child.pid ?? null,
        };
      } finally {
        if (ctx.runId) active.delete(ctx.runId);
      }
    },
    async cancel(ctx) {
      const child = active.get(ctx.runId);
      if (!child) throw new Error("OpenClaw run is not active");
      await terminateProcessTree(child);
      active.delete(ctx.runId);
      unregisterAgentProcess(ctx.runId);
    },
  };
}

export const __test__ = { parseOutput, parseWholeResult, buildArgs };
