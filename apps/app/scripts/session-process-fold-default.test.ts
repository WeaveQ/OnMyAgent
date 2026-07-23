import { describe, expect, test } from "bun:test";

import { shouldDefaultExpandProcessFold } from "../src/react-app/domains/session/surface/message-list/process-fold";

describe("shouldDefaultExpandProcessFold (shipped)", () => {
  test("tool process chrome stays collapsed by default even when running", () => {
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: false, running: true }),
    ).toBe(false);
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: false, running: false }),
    ).toBe(false);
  });

  test("plan/task list may open while running", () => {
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: true, running: true }),
    ).toBe(true);
    expect(
      shouldDefaultExpandProcessFold({ isPlanList: true, running: false }),
    ).toBe(false);
  });
});
