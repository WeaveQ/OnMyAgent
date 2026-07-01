import { afterEach, describe, expect, test } from "bun:test";

import {
  assertManagedOpencodeAuth,
  encodeBasicAuth,
  isLoopbackHost,
  resolveManagedOpencodeCredentials,
  resolveManagedOpencodeHost,
} from "../src/runtime-auth";

const originalEnv = { ...process.env };

afterEach(() => {
  process.env = { ...originalEnv };
});

describe("runtime auth", () => {
  test("encodes basic auth credentials", () => {
    expect(encodeBasicAuth("user", "pass")).toBe("dXNlcjpwYXNz");
  });

  test("accepts only loopback OpenCode bind hosts", () => {
    expect(isLoopbackHost("127.0.0.1")).toBe(true);
    expect(isLoopbackHost("localhost")).toBe(true);
    expect(isLoopbackHost("::1")).toBe(true);
    expect(isLoopbackHost("0.0.0.0")).toBe(false);
    expect(resolveManagedOpencodeHost()).toBe("127.0.0.1");
    expect(() => resolveManagedOpencodeHost("0.0.0.0")).toThrow();
  });

  test("rejects disabled managed OpenCode auth", () => {
    const args = { positionals: [], flags: new Map<string, string | boolean>([["opencode-auth", false]]) };

    expect(() => assertManagedOpencodeAuth(args)).toThrow();
  });

  test("generates managed credentials by default", () => {
    const args = { positionals: [], flags: new Map<string, string | boolean>() };
    const credentials = resolveManagedOpencodeCredentials(args);

    expect(credentials.username).toHaveLength(512);
    expect(credentials.password).toHaveLength(512);
    expect(credentials.username).not.toBe(credentials.password);
  });

  test("rejects external credential flags unless internally allowed", () => {
    const args = {
      positionals: [],
      flags: new Map<string, string | boolean>([
        ["opencode-username", "alice"],
        ["opencode-password", "secret"],
      ]),
    };

    expect(() => resolveManagedOpencodeCredentials(args)).toThrow();

    process.env.ONMYAGENT_INTERNAL_ALLOW_OPENCODE_CREDENTIALS = "1";
    expect(resolveManagedOpencodeCredentials(args)).toEqual({
      username: "alice",
      password: "secret",
    });
  });
});
