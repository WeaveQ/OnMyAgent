import { describe, expect, test } from "bun:test";

import { isQuestionNotFoundError } from "../src/react-app/shell/session-route/model";

describe("isQuestionNotFoundError", () => {
  test("detects OpenCode QuestionNotFoundError POJO", () => {
    expect(
      isQuestionNotFoundError({
        _tag: "QuestionNotFoundError",
        requestID: "que_abc",
        message: "request not found: que_abc",
      }),
    ).toBe(true);
  });

  test("detects stringified unwrap Error payload", () => {
    expect(
      isQuestionNotFoundError(
        new Error(
          JSON.stringify({
            _tag: "QuestionNotFoundError",
            requestID: "que_f8e3eaac3001B4K3GloC",
            message: "request not found: que_f8e3eaac3001B4K3GloC",
          }),
        ),
      ),
    ).toBe(true);
  });

  test("detects classic Question request not found message", () => {
    expect(
      isQuestionNotFoundError(
        new Error("Question request not found: que_stale"),
      ),
    ).toBe(true);
  });

  test("ignores unrelated errors", () => {
    expect(isQuestionNotFoundError(new Error("network failed"))).toBe(false);
    expect(isQuestionNotFoundError(null)).toBe(false);
  });
});
