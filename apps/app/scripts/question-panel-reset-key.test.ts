import { describe, expect, test } from "bun:test";

import { buildQuestionPanelResetKey } from "../src/react-app/domains/session/modals/question-modal";

describe("buildQuestionPanelResetKey", () => {
  test("host multi-step phases with same requestId get different keys", () => {
    const requestId = "host:expert-automation-offer";
    const optional = buildQuestionPanelResetKey(requestId, [
      {
        header: "选填信息",
        question: "必填项已齐。是否继续设置选填项（如时区）？",
        options: [],
      },
    ]);
    const confirm = buildQuestionPanelResetKey(requestId, [
      {
        header: "确认创建",
        question: "确认创建 1 个定时任务？每日看板 @ 09:00",
        options: [],
      },
    ]);
    expect(optional).not.toBe(confirm);
  });

  test("same OpenCode request and same copy stay stable", () => {
    const requestId = "que_abc";
    const questions = [
      { header: "Province", question: "Which province?", options: [] },
    ];
    expect(buildQuestionPanelResetKey(requestId, questions)).toBe(
      buildQuestionPanelResetKey(requestId, [...questions]),
    );
  });
});
