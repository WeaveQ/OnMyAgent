import { describe, expect, test } from "bun:test";

import {
  buildOpenworkEnvSystemContext,
  clearOpenworkEnvSystemContextCache,
} from "../src/react-app/domains/shared/env-context";

type ListUserEnvKeysClient = {
  baseUrl: string;
  listUserEnvKeys: () => Promise<{ keys?: string[] }>;
};

function createClient(keys: string[]) {
  let calls = 0;
  const client: ListUserEnvKeysClient = {
    baseUrl: "http://127.0.0.1:4111",
    async listUserEnvKeys() {
      calls += 1;
      return { keys };
    },
  };
  return { client, calls: () => calls };
}

describe("shared env context contract", () => {
  test("returns an empty context without a client", async () => {
    await expect(buildOpenworkEnvSystemContext(null)).resolves.toBeUndefined();
  });

  test("normalizes env keys and caches by runtime key", async () => {
    clearOpenworkEnvSystemContextCache();
    const { client, calls } = createClient(["OPENAI_API_KEY", " bad-key ", "ANTHROPIC_API_KEY", "OPENAI_API_KEY"]);

    const first = await buildOpenworkEnvSystemContext(client, {
      runtimeKey: "runtime-a",
      readPendingChanges: () => false,
    });
    const second = await buildOpenworkEnvSystemContext(client, {
      runtimeKey: "runtime-a",
      readPendingChanges: () => false,
    });

    expect(first).toBe(second);
    expect(calls()).toBe(1);
    expect(first).toContain("ANTHROPIC_API_KEY");
    expect(first).toContain("OPENAI_API_KEY");
    expect(first).not.toContain("bad-key");
  });
});
