import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeSandboxEntrypoint } from "../src/cli-sandbox-runtime";

import {
  addEnvPassThroughArgs,
  sandboxEnvPassThroughNames,
  shQuote,
} from "../src/runtime-sandbox";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("runtime sandbox", () => {
  test("shell-quotes single quotes safely", () => {
    expect(shQuote("plain")).toBe("'plain'");
    expect(shQuote("a'b")).toBe("'a'\"'\"'b'");
  });

  test("passes through sorted user and provider env names", () => {
    expect(sandboxEnvPassThroughNames({ Z_KEY: "1", A_KEY: "2" })).toEqual([
      "ANTHROPIC_API_KEY",
      "A_KEY",
      "GEMINI_API_KEY",
      "OPENAI_API_KEY",
      "Z_KEY",
    ]);
  });

  test("adds env args only for existing process variables", () => {
    process.env.EXISTING_VALUE = "ok";
    delete process.env.MISSING_VALUE;
    const args: string[] = [];

    addEnvPassThroughArgs(args, ["EXISTING_VALUE", "MISSING_VALUE"]);

    expect(args).toEqual(["-e", "EXISTING_VALUE=ok"]);
  });

  test.each(["docker", "container"] as const)(
    "writes authoritative %s runtime identity into the sandbox entrypoint",
    async (backend) => {
      const root = await mkdtemp(join(tmpdir(), "onmyagent-sandbox-entrypoint-"));
      const entrypointHostPath = join(root, "entrypoint.sh");
      try {
        await writeSandboxEntrypoint({
          entrypointHostPath,
          rootInContainer: "/persist/runtime",
          opencodeConfigDirInContainer: "/opencode-config",
          backend,
          opencode: {
            corsOrigins: [],
            hotReload: { enabled: false, debounceMs: 100, cooldownMs: 200 },
          },
          onmyagent: {
            token: "not-written-to-script",
            hostToken: "not-written-to-script",
            approvalMode: "manual",
            approvalTimeoutMs: 1_000,
            readOnly: false,
            corsOrigins: [],
            logFormat: "pretty",
            opencodeRouterEnabled: false,
          },
          runId: "fixture-run",
          logFormat: "pretty",
        });

        const script = await readFile(entrypointHostPath, "utf8");
        expect(script).toContain(
          "export ONMYAGENT_PRIMARY_RUNTIME_DATA_ROOT='/persist'",
        );
        expect(script).toContain(
          "export ONMYAGENT_PRIMARY_OPENCODE_PROFILE_ID='orchestrator-sandbox'",
        );
        expect(script).toContain(
          'export ONMYAGENT_PRIMARY_OPENCODE_RUNTIME_HOME="$XDG_DATA_HOME/opencode"',
        );
        expect(script).toContain(
          `export ONMYAGENT_PRIMARY_OPENCODE_SANDBOX_PROFILE='orchestrator-${backend}'`,
        );
        expect(script).not.toContain("not-written-to-script");
      } finally {
        await rm(root, { recursive: true, force: true });
      }
    },
  );
});
