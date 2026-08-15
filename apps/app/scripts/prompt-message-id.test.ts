import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "bun:test";

import { shouldForwardPromptMessageId } from "../src/react-app/domains/session/sync/prompt-message-id";

const surfacePropsPath = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "../src/react-app/shell/session-route/surface-props-hook-impl.ts",
);

describe("shouldForwardPromptMessageId", () => {
  test("forwards native OpenCode ascending ids", () => {
    expect(shouldForwardPromptMessageId("msg_000cdadf2001pKTHcqf88pAK4z")).toBe(
      true,
    );
    expect(shouldForwardPromptMessageId("msg_ffefddddf001bHd1mHEDhwYeFA")).toBe(
      true,
    );
  });

  test("rejects client UUIDs and product-prefixed synthetics", () => {
    expect(
      shouldForwardPromptMessageId("msg_ea401b16-9af4-457a-bf76-51e30893740a"),
    ).toBe(false);
    expect(
      shouldForwardPromptMessageId(
        "msg_onmyagent_output_limit_continue_aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toBe(false);
    expect(
      shouldForwardPromptMessageId(
        "msg_onmyagent-internal-plan-execute-aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      ),
    ).toBe(false);
    expect(shouldForwardPromptMessageId("")).toBe(false);
    expect(shouldForwardPromptMessageId(null)).toBe(false);
  });

  test("session send only forwards ids that pass the native-id gate", async () => {
    const source = await readFile(surfacePropsPath, "utf8");
    expect(source).toContain("shouldForwardPromptMessageId(runtimeMessageId)");
    expect(source).toContain("forwardedMessageId ? { messageID: forwardedMessageId }");
  });
});
