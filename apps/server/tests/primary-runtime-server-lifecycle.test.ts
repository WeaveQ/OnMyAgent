import { describe, expect, test } from "bun:test";

import { stopPrimaryRuntimeOwners } from "../src/services/primary-runtime-server-lifecycle.js";

describe("stopPrimaryRuntimeOwners", () => {
  test("always stops archive when registry drain throws", async () => {
    const stopped: string[] = [];
    await expect(stopPrimaryRuntimeOwners({
      stopRegistry: async () => {
        throw new Error("grok_runtime_draining");
      },
      stopArchive: async () => {
        stopped.push("archive");
      },
    })).rejects.toThrow("grok_runtime_draining");
    expect(stopped).toEqual(["archive"]);
  });

  test("stops archive after a successful registry drain", async () => {
    const stopped: string[] = [];
    await stopPrimaryRuntimeOwners({
      stopRegistry: async () => {
        stopped.push("registry");
      },
      stopArchive: async () => {
        stopped.push("archive");
      },
    });
    expect(stopped).toEqual(["registry", "archive"]);
  });
});
