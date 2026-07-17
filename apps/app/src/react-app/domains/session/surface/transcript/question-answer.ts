export type TranscriptQuestionAnswer = {
  header: string | null;
  question: string;
  answers: string[];
};

function recordValue(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value))
    : null;
}

function nonEmptyString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringList(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item === "string" && item.trim()) return [item.trim()];
    if (Array.isArray(item)) return stringList(item);
    return [];
  });
}

function parseJsonValue(value: unknown) {
  if (typeof value !== "string") return value;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed;
  } catch {
    return value;
  }
}

export function normalizeTranscriptQuestionAnswers(
  input: unknown,
  output: unknown,
): TranscriptQuestionAnswer[] {
  const inputRecord = recordValue(parseJsonValue(input));
  const questionValues = Array.isArray(inputRecord?.questions)
    ? inputRecord.questions
    : Array.isArray(input)
      ? input
      : [];
  const outputValue = parseJsonValue(output);
  const outputRecord = recordValue(outputValue);
  const answerValues = Array.isArray(outputRecord?.answers)
    ? outputRecord.answers
    : Array.isArray(outputValue)
      ? outputValue
      : [];

  return questionValues.flatMap((value, index) => {
    const question = recordValue(value);
    const questionText = nonEmptyString(question?.question);
    const answers = stringList(answerValues[index]);
    if (!questionText || answers.length === 0) return [];
    return [{
      header: nonEmptyString(question?.header),
      question: questionText,
      answers,
    }];
  });
}
