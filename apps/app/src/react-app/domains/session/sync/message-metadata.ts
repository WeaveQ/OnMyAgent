type TranscriptTokenSource = {
  total?: number;
  input?: number;
  output?: number;
  reasoning?: number;
  cache?: {
    read?: number;
    write?: number;
  };
};

export type TranscriptMessageSourceInfo = {
  time?: {
    created?: number;
    completed?: number;
  };
  providerID?: string;
  modelID?: string;
  cost?: number;
  tokens?: TranscriptTokenSource;
  error?: {
    name?: string;
  };
  finish?: string;
};

export type TranscriptTokenUsage = {
  total: number | null;
  input: number | null;
  output: number | null;
  reasoning: number | null;
  cacheRead: number | null;
  cacheWrite: number | null;
};

export type TranscriptMessageMetadata = {
  created: number | null;
  completed: number | null;
  providerID: string | null;
  modelID: string | null;
  cost: number | null;
  tokens: TranscriptTokenUsage | null;
  errorName: string | null;
  finishReason: string | null;
};

function finiteNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function propertyValue(value: object, key: string): unknown {
  return key in value ? Reflect.get(value, key) : undefined;
}

function tokenUsage(value: unknown): TranscriptTokenUsage | null {
  if (!value || typeof value !== "object") return null;

  const cache = propertyValue(value, "cache");
  const cacheRecord = cache && typeof cache === "object" ? cache : null;
  const usage = {
    total: finiteNumber(propertyValue(value, "total")),
    input: finiteNumber(propertyValue(value, "input")),
    output: finiteNumber(propertyValue(value, "output")),
    reasoning: finiteNumber(propertyValue(value, "reasoning")),
    cacheRead: cacheRecord ? finiteNumber(propertyValue(cacheRecord, "read")) : null,
    cacheWrite: cacheRecord ? finiteNumber(propertyValue(cacheRecord, "write")) : null,
  };

  return Object.values(usage).some((item) => item !== null) ? usage : null;
}

export function createTranscriptMessageMetadata(info: TranscriptMessageSourceInfo) {
  const created = finiteNumber(info.time?.created);
  const completed = finiteNumber(info.time?.completed);
  const providerID = stringValue(info.providerID);
  const modelID = stringValue(info.modelID);
  const cost = finiteNumber(info.cost);
  const errorName = stringValue(info.error?.name);
  const finishReason = stringValue(info.finish);

  return {
    opencode: {
      ...(created === null ? {} : { created }),
      ...(completed === null ? {} : { completed }),
      ...(providerID === null ? {} : { providerID }),
      ...(modelID === null ? {} : { modelID }),
      ...(cost === null ? {} : { cost }),
      ...(info.tokens ? { tokens: info.tokens } : {}),
      ...(errorName === null ? {} : { errorName }),
      ...(finishReason === null ? {} : { finishReason }),
    },
  };
}

export function readTranscriptMessageMetadata(metadata: unknown): TranscriptMessageMetadata {
  const empty = {
    created: null,
    completed: null,
    providerID: null,
    modelID: null,
    cost: null,
    tokens: null,
    errorName: null,
    finishReason: null,
  };
  if (!metadata || typeof metadata !== "object") return empty;

  const opencode = propertyValue(metadata, "opencode");
  if (!opencode || typeof opencode !== "object") return empty;

  return {
    created: finiteNumber(propertyValue(opencode, "created")),
    completed: finiteNumber(propertyValue(opencode, "completed")),
    providerID: stringValue(propertyValue(opencode, "providerID")),
    modelID: stringValue(propertyValue(opencode, "modelID")),
    cost: finiteNumber(propertyValue(opencode, "cost")),
    tokens: tokenUsage(propertyValue(opencode, "tokens")),
    errorName: stringValue(propertyValue(opencode, "errorName")),
    finishReason: stringValue(propertyValue(opencode, "finishReason")),
  };
}
