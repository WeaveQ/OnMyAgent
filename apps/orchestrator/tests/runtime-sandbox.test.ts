import { afterEach, describe, expect, test } from "bun:test";

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
});
