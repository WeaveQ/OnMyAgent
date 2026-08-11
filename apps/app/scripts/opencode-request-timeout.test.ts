import { describe, expect, test } from "bun:test";

import { resolveOpencodeRequestTimeoutMsForTests } from "../src/app/lib/opencode";

describe("resolveOpencodeRequestTimeoutMsForTests", () => {
  test("extends timeout for session create URLs", () => {
    expect(
      resolveOpencodeRequestTimeoutMsForTests(
        "http://127.0.0.1:4096/session",
        10_000,
      ),
    ).toBe(60_000);
    expect(
      resolveOpencodeRequestTimeoutMsForTests(
        "http://127.0.0.1:8787/workspace/ws_x/opencode/session",
        10_000,
      ),
    ).toBe(60_000);
  });

  test("does not treat session id paths as create", () => {
    // Default 10s still applies to ordinary session GETs.
    expect(
      resolveOpencodeRequestTimeoutMsForTests(
        "http://127.0.0.1:4096/session/ses_abc",
        10_000,
      ),
    ).toBe(10_000);
  });

  test("keeps long-running prompt paths untimed", () => {
    expect(
      resolveOpencodeRequestTimeoutMsForTests(
        "http://127.0.0.1:4096/session/ses_abc/prompt_async",
        10_000,
      ),
    ).toBe(0);
  });
});
