/**
 * Host-driven automation offer flow for expert sessions.
 * Uses the existing QuestionPanel options UI (not a free-form dialog).
 */

import type { AutomationTaskInput } from "@onmyagent/types";
import type { QuestionInfo } from "@opencode-ai/sdk/v2/client";

import type { PendingQuestion } from "../../../../app/types";
import type { LoadedAutomationProposal } from "./apply-automation-proposals";
import {
  buildAutomationPayloadFromDraft,
  type ApplyAutomationProposalsResult,
} from "./apply-automation-proposals";

export const HOST_AUTOMATION_QUESTION_ID = "host:expert-automation-offer";

export type AutomationRequiredField = "title" | "prompt" | "time";
export type AutomationOptionalField = "timezone";

export type AutomationOfferDraft = {
  path: string;
  payload: AutomationTaskInput;
};

export type AutomationCreateResultRow = {
  id: string;
  title: string;
  prompt: string;
  scene: AutomationTaskInput["scene"];
};

export type AutomationOfferPhase =
  | "idle"
  | "offer"
  | "collect_required"
  | "ask_optional"
  | "collect_optional"
  | "confirm"
  | "result"
  | "dismissed";

export type AutomationOfferFlowState = {
  phase: AutomationOfferPhase;
  drafts: AutomationOfferDraft[];
  missing: Array<{ path: string; field: AutomationRequiredField }>;
  optionalFields: AutomationOptionalField[];
  optionalIndex: number;
  resultRows: AutomationCreateResultRow[];
  busy: boolean;
  fingerprint: string;
};

export type AutomationOfferLabels = {
  offerHeader: string;
  offerQuestion: (count: number, titles: string) => string;
  optAutoCreate: string;
  optAutoCreateDesc: string;
  optSkip: string;
  optSkipDesc: string;
  requiredHeader: string;
  requiredTitleQuestion: (taskTitle: string) => string;
  requiredPromptQuestion: (taskTitle: string) => string;
  requiredTimeQuestion: (taskTitle: string) => string;
  optionalHeader: string;
  optionalQuestion: string;
  optOptionalYes: string;
  optOptionalYesDesc: string;
  optOptionalNo: string;
  optOptionalNoDesc: string;
  optionalTimezoneQuestion: string;
  confirmHeader: string;
  confirmQuestion: (count: number, summary: string) => string;
  optConfirm: string;
  optConfirmDesc: string;
  optCancel: string;
  optCancelDesc: string;
  customAnswerLabel: string;
};

export function createIdleAutomationOfferFlow(): AutomationOfferFlowState {
  return {
    phase: "idle",
    drafts: [],
    missing: [],
    optionalFields: [],
    optionalIndex: 0,
    resultRows: [],
    busy: false,
    fingerprint: "",
  };
}

export function listMissingRequiredFields(
  payload: AutomationTaskInput,
): AutomationRequiredField[] {
  const missing: AutomationRequiredField[] = [];
  if (!payload.title.trim()) missing.push("title");
  if (!payload.prompt.trim()) missing.push("prompt");
  if (!/^\d{2}:\d{2}$/.test(payload.schedule.time.trim())) missing.push("time");
  return missing;
}

export function listMissingRequiredAcrossDrafts(
  drafts: readonly AutomationOfferDraft[],
): Array<{ path: string; field: AutomationRequiredField }> {
  const out: Array<{ path: string; field: AutomationRequiredField }> = [];
  for (const draft of drafts) {
    for (const field of listMissingRequiredFields(draft.payload)) {
      out.push({ path: draft.path, field });
    }
  }
  return out;
}

export function draftsFromProposals(
  proposals: readonly LoadedAutomationProposal[],
): AutomationOfferDraft[] {
  return proposals.map((item) => ({
    path: item.path,
    payload: { ...item.payload, schedule: { ...item.payload.schedule } },
  }));
}

export function startAutomationOfferFlow(input: {
  proposals: readonly LoadedAutomationProposal[];
  fingerprint: string;
}): AutomationOfferFlowState {
  return {
    phase: "offer",
    drafts: draftsFromProposals(input.proposals),
    missing: [],
    optionalFields: [],
    optionalIndex: 0,
    resultRows: [],
    busy: false,
    fingerprint: input.fingerprint,
  };
}

function draftByPath(
  drafts: readonly AutomationOfferDraft[],
  path: string,
): AutomationOfferDraft | null {
  return drafts.find((item) => item.path === path) ?? null;
}

function updateDraftField(
  drafts: AutomationOfferDraft[],
  path: string,
  field: AutomationRequiredField,
  value: string,
): AutomationOfferDraft[] {
  return drafts.map((draft) => {
    if (draft.path !== path) return draft;
    if (field === "title") {
      return { ...draft, payload: { ...draft.payload, title: value.trim() } };
    }
    if (field === "prompt") {
      return { ...draft, payload: { ...draft.payload, prompt: value.trim() } };
    }
    return {
      ...draft,
      payload: {
        ...draft.payload,
        schedule: { ...draft.payload.schedule, time: value.trim() },
      },
    };
  });
}

function updateTimezone(
  drafts: AutomationOfferDraft[],
  timezone: string,
): AutomationOfferDraft[] {
  const next = timezone.trim();
  if (!next) return drafts;
  return drafts.map((draft) => ({
    ...draft,
    payload: {
      ...draft.payload,
      schedule: { ...draft.payload.schedule, timezone: next },
    },
  }));
}

function nextPhaseAfterRequired(
  drafts: AutomationOfferDraft[],
  fingerprint: string,
): AutomationOfferFlowState {
  const missing = listMissingRequiredAcrossDrafts(drafts);
  if (missing.length > 0) {
    return {
      phase: "collect_required",
      drafts,
      missing,
      optionalFields: [],
      optionalIndex: 0,
      resultRows: [],
      busy: false,
      fingerprint,
    };
  }
  return {
    phase: "ask_optional",
    drafts,
    missing: [],
    optionalFields: [],
    optionalIndex: 0,
    resultRows: [],
    busy: false,
    fingerprint,
  };
}

export function buildAutomationOfferQuestion(
  state: AutomationOfferFlowState,
  labels: AutomationOfferLabels,
): QuestionInfo | null {
  if (state.phase === "offer") {
    const titles = state.drafts.map((item) => item.payload.title || item.path).join(", ");
    return {
      header: labels.offerHeader,
      question: labels.offerQuestion(state.drafts.length, titles),
      options: [
        {
          label: labels.optAutoCreate,
          description: labels.optAutoCreateDesc,
        },
        {
          label: labels.optSkip,
          description: labels.optSkipDesc,
        },
      ],
    };
  }

  if (state.phase === "collect_required") {
    const current = state.missing[0];
    if (!current) return null;
    const draft = draftByPath(state.drafts, current.path);
    const taskTitle = draft?.payload.title || current.path;
    const question =
      current.field === "title"
        ? labels.requiredTitleQuestion(taskTitle)
        : current.field === "prompt"
          ? labels.requiredPromptQuestion(taskTitle)
          : labels.requiredTimeQuestion(taskTitle);
    return {
      header: labels.requiredHeader,
      question,
      options: [],
      custom: true,
    };
  }

  if (state.phase === "ask_optional") {
    return {
      header: labels.optionalHeader,
      question: labels.optionalQuestion,
      options: [
        {
          label: labels.optOptionalYes,
          description: labels.optOptionalYesDesc,
        },
        {
          label: labels.optOptionalNo,
          description: labels.optOptionalNoDesc,
        },
      ],
    };
  }

  if (state.phase === "collect_optional") {
    const field = state.optionalFields[state.optionalIndex];
    if (field === "timezone") {
      return {
        header: labels.optionalHeader,
        question: labels.optionalTimezoneQuestion,
        options: [
          {
            label: labels.optOptionalNo,
            description: labels.optOptionalNoDesc,
          },
        ],
        custom: true,
      };
    }
    return null;
  }

  if (state.phase === "confirm") {
    const summary = state.drafts
      .map((item) => `${item.payload.title} @ ${item.payload.schedule.time}`)
      .join("; ");
    return {
      header: labels.confirmHeader,
      question: labels.confirmQuestion(state.drafts.length, summary),
      options: [
        {
          label: labels.optConfirm,
          description: labels.optConfirmDesc,
        },
        {
          label: labels.optCancel,
          description: labels.optCancelDesc,
        },
      ],
    };
  }

  return null;
}

export function toHostPendingQuestion(input: {
  sessionId: string;
  question: QuestionInfo;
}): PendingQuestion {
  return {
    id: HOST_AUTOMATION_QUESTION_ID,
    sessionID: input.sessionId,
    questions: [input.question],
    receivedAt: Date.now(),
  };
}

export function isHostAutomationQuestionId(id: string | null | undefined): boolean {
  return id === HOST_AUTOMATION_QUESTION_ID;
}

export type AutomationOfferAnswerResult =
  | { kind: "state"; state: AutomationOfferFlowState }
  | { kind: "create"; state: AutomationOfferFlowState };

export function applyAutomationOfferAnswer(input: {
  state: AutomationOfferFlowState;
  answers: string[][];
  labels: AutomationOfferLabels;
}): AutomationOfferAnswerResult {
  const answer = (input.answers[0] ?? []).map((item) => item.trim()).filter(Boolean);
  const first = answer[0] ?? "";
  const state = input.state;
  const labels = input.labels;

  if (state.phase === "offer") {
    if (first === labels.optAutoCreate) {
      return { kind: "state", state: nextPhaseAfterRequired(state.drafts, state.fingerprint) };
    }
    return {
      kind: "state",
      state: { ...createIdleAutomationOfferFlow(), phase: "dismissed", fingerprint: state.fingerprint },
    };
  }

  if (state.phase === "collect_required") {
    const current = state.missing[0];
    if (!current || !first) return { kind: "state", state };
    const drafts = updateDraftField(state.drafts, current.path, current.field, first);
    return { kind: "state", state: nextPhaseAfterRequired(drafts, state.fingerprint) };
  }

  if (state.phase === "ask_optional") {
    if (first === labels.optOptionalYes) {
      return {
        kind: "state",
        state: {
          ...state,
          phase: "collect_optional",
          optionalFields: ["timezone"],
          optionalIndex: 0,
        },
      };
    }
    return {
      kind: "state",
      state: {
        ...state,
        phase: "confirm",
        optionalFields: [],
        optionalIndex: 0,
      },
    };
  }

  if (state.phase === "collect_optional") {
    const field = state.optionalFields[state.optionalIndex];
    let drafts = state.drafts;
    if (field === "timezone") {
      const timezoneValue =
        first === labels.optOptionalNo
          ? ""
          : answer.find((item) => item !== labels.optOptionalNo) ?? first;
      if (timezoneValue) drafts = updateTimezone(drafts, timezoneValue);
    }
    const nextIndex = state.optionalIndex + 1;
    if (nextIndex < state.optionalFields.length) {
      return {
        kind: "state",
        state: {
          ...state,
          drafts,
          optionalIndex: nextIndex,
          phase: "collect_optional",
        },
      };
    }
    return {
      kind: "state",
      state: {
        ...state,
        drafts,
        phase: "confirm",
        optionalIndex: nextIndex,
      },
    };
  }

  if (state.phase === "confirm") {
    if (first === labels.optConfirm) {
      return {
        kind: "create",
        state: { ...state, busy: true },
      };
    }
    return {
      kind: "state",
      state: { ...createIdleAutomationOfferFlow(), phase: "dismissed", fingerprint: state.fingerprint },
    };
  }

  return { kind: "state", state };
}

export function finalizeAutomationCreateResult(input: {
  state: AutomationOfferFlowState;
  result: ApplyAutomationProposalsResult;
  drafts: AutomationOfferDraft[];
}): AutomationOfferFlowState {
  const promptByTitle = new Map(
    input.drafts.map((item) => [item.payload.title, item.payload.prompt] as const),
  );
  const sceneByTitle = new Map(
    input.drafts.map((item) => [item.payload.title, item.payload.scene] as const),
  );
  const resultRows: AutomationCreateResultRow[] = input.result.created.map((item) => ({
    id: item.id,
    title: item.title,
    prompt: promptByTitle.get(item.title) ?? "",
    scene: sceneByTitle.get(item.title) ?? "office",
  }));
  return {
    ...input.state,
    phase: resultRows.length > 0 ? "result" : "dismissed",
    busy: false,
    resultRows,
  };
}

export function buildCreatePayloadsFromDrafts(
  drafts: readonly AutomationOfferDraft[],
): Array<{ path: string; payload: AutomationTaskInput }> {
  const items: Array<{ path: string; payload: AutomationTaskInput }> = [];
  for (const draft of drafts) {
    const payload = buildAutomationPayloadFromDraft({
      base: draft.payload,
      title: draft.payload.title,
      prompt: draft.payload.prompt,
      time: draft.payload.schedule.time,
      enabled: draft.payload.enabled !== false,
    });
    if (!payload) continue;
    items.push({ path: draft.path, payload });
  }
  return items;
}
