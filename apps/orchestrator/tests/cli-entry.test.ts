import { describe, expect, test } from "bun:test";

const cliPath = new URL("../src/cli.ts", import.meta.url).pathname;

async function runCli(args: string[]) {
  const childProcess = Bun.spawn([process.execPath, cliPath, ...args], {
    cwd: new URL("..", import.meta.url).pathname,
    env: { ...Bun.env, NO_COLOR: "1" },
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(childProcess.stdout).text(),
    new Response(childProcess.stderr).text(),
    childProcess.exited,
  ]);

  return { stdout, stderr, exitCode };
}

describe("orchestrator cli entry", () => {
  test("prints help and exits successfully for --help", async () => {
    const result = await runCli(["--help"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Usage:");
    expect(result.stdout).toContain("onmyagent start [--workspace <path>] [options]");
    expect(result.stdout).toContain("--version                 Show version");
  });

  test("prints version and exits successfully for -v", async () => {
    const result = await runCli(["-v"]);

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe("");
    expect(result.stdout.trim()).toMatch(/^\d+\.\d+\.\d+/);
  });

  test("prints help and exits non-zero for an unknown command", async () => {
    const result = await runCli(["missing-command"]);

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Commands:");
    expect(result.stdout).toContain("onmyagent status [--onmyagent-url <url>] [--opencode-url <url>]");
  });
});
