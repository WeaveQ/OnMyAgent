import { describe, expect, test } from "bun:test";

import { OnMyAgentDenHelpLink } from "../src/react-app/domains/shared/onmyagent-den-help-link";

describe("shared den help link contract", () => {
  test("exports the remote worker help link component for session sidebar use", () => {
    expect(typeof OnMyAgentDenHelpLink).toBe("function");
  });
});
