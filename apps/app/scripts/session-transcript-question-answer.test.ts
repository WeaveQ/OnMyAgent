import { describe, expect, test } from "bun:test";

import { normalizeTranscriptQuestionAnswers } from "../src/react-app/domains/session/surface/transcript/question-answer";

describe("session transcript historical question answers", () => {
  test("pairs OpenCode question metadata with nested answers", () => {
    expect(normalizeTranscriptQuestionAnswers(
      {
        questions: [
          { header: "Province", question: "Which province?" },
          { header: "Subjects", question: "Which subjects?" },
        ],
      },
      { answers: [["Zhejiang"], ["Math", "English"]] },
    )).toEqual([
      { header: "Province", question: "Which province?", answers: ["Zhejiang"] },
      { header: "Subjects", question: "Which subjects?", answers: ["Math", "English"] },
    ]);
  });

  test("accepts serialized output and omits unanswered prompts", () => {
    expect(normalizeTranscriptQuestionAnswers(
      { questions: [{ question: "Answered?" }, { question: "Pending?" }] },
      JSON.stringify({ answers: [["Yes"], []] }),
    )).toEqual([
      { header: null, question: "Answered?", answers: ["Yes"] },
    ]);
  });
});
