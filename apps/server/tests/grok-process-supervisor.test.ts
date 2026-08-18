import { afterEach, describe, expect, test } from "bun:test";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { join } from "node:path";
import { GrokProcessSupervisor } from "../src/services/grok-process-supervisor.js";

const children: ChildProcessWithoutNullStreams[] = [];
afterEach(() => { for (const child of children.splice(0)) child.kill("SIGKILL"); });

describe("GrokProcessSupervisor", () => {
  test("starts once per profile/workspace/sandbox and fixes safe CLI policy", async () => {
    const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
    const supervisor = new GrokProcessSupervisor({
      onRequest: async () => ({ outcome: "cancelled" }),
      spawnProcess(input) {
        calls.push({ args: input.args, env: input.env });
        const child = spawn(process.execPath, [join(import.meta.dir, "fixtures/fake-grok-acp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
        children.push(child);
        return child;
      },
    });
    const key = { profileId: "system", workspaceRoot: "/fixture/workspace", sandboxProfile: "strict" };
    const policy = { binaryPath: "/fixture/grok", runtimeHome: "/fixture/home", expectedVersion: "1.0.0" };
    const [first, second] = await Promise.all([supervisor.start(key, policy), supervisor.start(key, policy)]);
    expect(first).toBe(second);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.args).toEqual([
      "--no-auto-update", "--permission-mode", "default", "agent",
      "--no-leader", "stdio",
    ]);
    expect(calls[0]?.args).not.toContain("--always-approve");
    expect(calls[0]?.env).toMatchObject({ GROK_HOME: "/fixture/home", GROK_DISABLE_AUTOUPDATER: "1" });
    await supervisor.stopAll();
  });

  test("uses distinct processes for distinct workspace keys", async () => {
    let calls = 0;
    const supervisor = new GrokProcessSupervisor({
      onRequest: async () => ({ outcome: "cancelled" }),
      spawnProcess() {
        calls += 1;
        const child = spawn(process.execPath, [join(import.meta.dir, "fixtures/fake-grok-acp.mjs")], { stdio: ["pipe", "pipe", "pipe"] });
        children.push(child);
        return child;
      },
    });
    const policy = { binaryPath: "/fixture/grok", runtimeHome: "/fixture/home" };
    await Promise.all([
      supervisor.start({ profileId: "system", workspaceRoot: "/workspace/a" }, policy),
      supervisor.start({ profileId: "system", workspaceRoot: "/workspace/b" }, policy),
    ]);
    expect(calls).toBe(2);
    await supervisor.stopAll();
  });

  test("restarts a crashed process for the same sticky key", async () => {
    let calls = 0;
    const supervisor = new GrokProcessSupervisor({
      onRequest: async () => ({ outcome: "cancelled" }),
      spawnProcess() {
        calls += 1;
        const child = spawn(process.execPath, [
          join(import.meta.dir, "fixtures/fake-grok-acp.mjs"),
        ], { stdio: ["pipe", "pipe", "pipe"] });
        children.push(child);
        return child;
      },
    });
    const key = { profileId: "system", workspaceRoot: "/workspace/a" };
    const policy = { binaryPath: "/fixture/grok", runtimeHome: "/fixture/home" };
    const first = await supervisor.start(key, policy);
    await first.stop();
    const second = await supervisor.start(key, policy);
    expect(second).not.toBe(first);
    expect(calls).toBe(2);
    await supervisor.stopAll();
  });

  test("stopAll terminates a child that is still waiting for initialize", async () => {
    let child: ChildProcessWithoutNullStreams | undefined;
    const supervisor = new GrokProcessSupervisor({
      onRequest: async () => ({ outcome: "cancelled" }),
      spawnProcess() {
        child = spawn(process.execPath, ["-e", "setInterval(() => {}, 10_000)"], {
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        children.push(child);
        return child;
      },
    });
    const starting = supervisor.start(
      { profileId: "system", workspaceRoot: "/workspace/a" },
      { binaryPath: "/fixture/grok", runtimeHome: "/fixture/home" },
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(supervisor.stopAll()).resolves.toBeUndefined();
    await expect(starting).rejects.toBeDefined();
    expect(child?.exitCode !== null || child?.signalCode !== null).toBe(true);
  });

  test("stopAll wins a delayed start and post-drain start fails closed", async () => {
    const spawned: ChildProcessWithoutNullStreams[] = [];
    const supervisor = new GrokProcessSupervisor({
      onRequest: async () => ({ outcome: "cancelled" }),
      spawnProcess() {
        const child = spawn(process.execPath, ["-e", "setInterval(() => {}, 10_000)"], {
          stdio: ["pipe", "pipe", "pipe"],
          detached: process.platform !== "win32",
        });
        spawned.push(child);
        children.push(child);
        return child;
      },
    });
    const policy = { binaryPath: "/fixture/grok", runtimeHome: "/fixture/home" };
    const hanging = supervisor.start(
      { profileId: "system", workspaceRoot: "/workspace/a" },
      policy,
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    const stopping = supervisor.stopAll();
    await expect(supervisor.start(
      { profileId: "system", workspaceRoot: "/workspace/b" },
      policy,
    )).rejects.toMatchObject({ code: "grok_runtime_draining" });
    await expect(stopping).resolves.toBeUndefined();
    await expect(hanging).rejects.toBeDefined();
    await expect(supervisor.start(
      { profileId: "system", workspaceRoot: "/workspace/c" },
      policy,
    )).rejects.toMatchObject({ code: "grok_runtime_draining" });
    expect(supervisor.draining).toBe(true);
    expect(spawned.every((child) => child.exitCode !== null || child.signalCode !== null)).toBe(true);
  });
});
