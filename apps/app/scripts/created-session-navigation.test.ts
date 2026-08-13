import { describe, expect, test } from "bun:test";

import { shouldNavigateToCreatedSession } from "../src/react-app/shell/session-route/created-session-actions";

describe("shouldNavigateToCreatedSession", () => {
  test("navigates when the user stayed on the draft that started the send", () => {
    expect(
      shouldNavigateToCreatedSession({
        sessionIdAtSendStart: "draft:ws:agent-a",
        currentSelectedSessionId: "draft:ws:agent-a",
        createdSessionId: "ses_new",
      }),
    ).toBe(true);
  });

  test("navigates when the route is still empty during create", () => {
    expect(
      shouldNavigateToCreatedSession({
        sessionIdAtSendStart: null,
        currentSelectedSessionId: null,
        createdSessionId: "ses_new",
      }),
    ).toBe(true);
  });

  test("does not navigate when the user switched experts mid-create", () => {
    expect(
      shouldNavigateToCreatedSession({
        sessionIdAtSendStart: "draft:ws:agent-a",
        currentSelectedSessionId: "draft:ws:agent-b",
        createdSessionId: "ses_new",
      }),
    ).toBe(false);
  });

  test("does not navigate when the user opened another real session mid-create", () => {
    expect(
      shouldNavigateToCreatedSession({
        sessionIdAtSendStart: "draft:ws:agent-a",
        currentSelectedSessionId: "ses_other_expert",
        createdSessionId: "ses_new",
      }),
    ).toBe(false);
  });

  test("navigates when create finished while already viewing the new session", () => {
    expect(
      shouldNavigateToCreatedSession({
        sessionIdAtSendStart: "draft:ws:agent-a",
        currentSelectedSessionId: "ses_new",
        createdSessionId: "ses_new",
      }),
    ).toBe(true);
  });

  test("does not navigate after an explicit click cancels the create transaction", () => {
    expect(
      shouldNavigateToCreatedSession({
        sessionIdAtSendStart: "ses_expert_b",
        currentSelectedSessionId: "ses_expert_b",
        createdSessionId: "ses_expert_a_new",
        createTransactionActive: false,
      }),
    ).toBe(false);
  });

  test("active expert transaction survives an automatic fallback route", () => {
    expect(
      shouldNavigateToCreatedSession({
        sessionIdAtSendStart: null,
        currentSelectedSessionId: "ses_expert_b_fallback",
        createdSessionId: "ses_expert_a_new",
        createTransactionActive: true,
      }),
    ).toBe(true);
  });
});
