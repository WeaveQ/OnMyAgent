/** @jsxImportSource react */
import { create } from "zustand";

import { t } from "../../../../i18n";

export type SessionActivityStatus =
  | "idle"
  | "thinking"
  | "responding"
  | "retrying"
  | "error"
  | "compacting"
  | "waiting";

export type SessionRunIdentity = {
  runKey: string;
  runStartedAt: number;
};

type SessionMessageRole = "assistant" | "system" | "user";

type SessionActivityRecord = {
  status: SessionActivityStatus;
  runActive: boolean;
  stopRequested: boolean;
  runKey: string | null;
  runStartedAt: number | null;
  assistantOutput: boolean;
  retrying: boolean;
  errorActive: boolean;
  errorMessage: string | null;
  compacting: boolean;
  waitingPermissionIds: string[];
  waitingQuestionIds: string[];
  messageRoles: Record<string, SessionMessageRole>;
  updatedAt: number;
};

type SessionLike = {
  id: string;
  status?: unknown;
  state?: unknown;
  runStatus?: unknown;
};

type SessionActivityStore = {
  recordsByWorkspaceId: Record<string, Record<string, SessionActivityRecord>>;
  statusesByWorkspaceId: Record<string, Record<string, SessionActivityStatus>>;
  getStatus: (workspaceId: string, sessionId: string) => SessionActivityStatus;
  getStopRequested: (workspaceId: string, sessionId: string) => boolean;
  getRunIdentity: (workspaceId: string, sessionId: string) => SessionRunIdentity | null;
  getErrorMessage: (workspaceId: string, sessionId: string) => string | null;
  seedWorkspaceSessions: (workspaceId: string, sessions: SessionLike[]) => void;
  seedSessionRun: (workspaceId: string, sessionId: string, status: unknown, assistantOutput: boolean) => void;
  startRun: (
    workspaceId: string,
    sessionId: string,
    identity?: SessionRunIdentity,
  ) => void;
  markRunStopped: (workspaceId: string, sessionId: string) => void;
  setRunStatus: (workspaceId: string, sessionId: string, status: unknown) => void;
  markMessageRole: (workspaceId: string, sessionId: string, messageId: string, role: SessionMessageRole) => void;
  markAssistantOutput: (workspaceId: string, sessionId: string, messageId?: string, options?: { allowUnknownMessageRole?: boolean }) => void;
  setWaitingRequest: (workspaceId: string, sessionId: string, kind: "permission" | "question", requestId: string, waiting: boolean) => void;
  replaceWaitingRequests: (workspaceId: string, sessionId: string, kind: "permission" | "question", requestIds: string[]) => void;
  setError: (workspaceId: string, sessionId: string, message?: string | null) => void;
  clearError: (workspaceId: string, sessionId: string) => void;
  setCompacting: (workspaceId: string, sessionId: string, compacting: boolean) => void;
  removeSession: (workspaceId: string, sessionId: string) => void;
};

const createRecord = (): SessionActivityRecord => ({
  status: "idle",
  runActive: false,
  stopRequested: false,
  runKey: null,
  runStartedAt: null,
  assistantOutput: false,
  retrying: false,
  errorActive: false,
  errorMessage: null,
  compacting: false,
  waitingPermissionIds: [],
  waitingQuestionIds: [],
  messageRoles: {},
  updatedAt: 0,
});

function normalizeRunStatus(status: unknown): "idle" | "running" | "retry" {
  if (typeof status === "string") {
    if (status === "busy" || status === "running") return "running";
    if (status === "retry") return "retry";
    return "idle";
  }

  if (!status || typeof status !== "object") return "idle";
  const type = "type" in status ? status.type : undefined;
  if (type === "busy" || type === "running") return "running";
  if (type === "retry") return "retry";
  return "idle";
}

function sessionRunStatus(session: SessionLike) {
  return session.status ?? session.state ?? session.runStatus;
}

function createRunIdentity(sessionId: string): SessionRunIdentity {
  const runStartedAt = Date.now();
  return {
    runKey: `${sessionId}:remote:${runStartedAt}`,
    runStartedAt,
  };
}

function applyRuntimeStatus(
  record: SessionActivityRecord,
  status: unknown,
  assistantOutput: boolean,
  nextRunIdentity: SessionRunIdentity,
) {
  const normalized = normalizeRunStatus(status);
  const runActive = normalized === "running" || normalized === "retry";
  if (record.stopRequested && runActive) return record;
  return {
    ...record,
    runActive,
    runKey: runActive && !record.runActive ? nextRunIdentity.runKey : record.runKey,
    runStartedAt:
      runActive && !record.runActive
        ? nextRunIdentity.runStartedAt
        : record.runStartedAt,
    stopRequested: false,
    assistantOutput: runActive && assistantOutput,
    retrying: normalized === "retry",
    errorActive: runActive ? false : record.errorActive,
    errorMessage: runActive ? null : record.errorMessage,
    compacting: runActive ? record.compacting : false,
    waitingPermissionIds: record.waitingPermissionIds,
    waitingQuestionIds: record.waitingQuestionIds,
  };
}

function statusForRecord(record: SessionActivityRecord): SessionActivityStatus {
  if (record.errorActive) return "error";
  if (record.waitingPermissionIds.length > 0 || record.waitingQuestionIds.length > 0) return "waiting";
  if (record.compacting) return "compacting";
  if (!record.runActive) return "idle";
  if (record.retrying) return "retrying";
  return record.assistantOutput ? "responding" : "thinking";
}

function updateWorkspaceStatus(
  statusesByWorkspaceId: Record<string, Record<string, SessionActivityStatus>>,
  workspaceId: string,
  sessionId: string,
  status: SessionActivityStatus,
) {
  const current = statusesByWorkspaceId[workspaceId] ?? {};
  if (current[sessionId] === status) return statusesByWorkspaceId;
  return {
    ...statusesByWorkspaceId,
    [workspaceId]: {
      ...current,
      [sessionId]: status,
    },
  };
}

function updateRecord(
  state: Pick<SessionActivityStore, "recordsByWorkspaceId" | "statusesByWorkspaceId">,
  workspaceId: string,
  sessionId: string,
  updater: (record: SessionActivityRecord) => SessionActivityRecord,
) {
  const workspaceRecords = state.recordsByWorkspaceId[workspaceId] ?? {};
  const nextRecord = updater(workspaceRecords[sessionId] ?? createRecord());
  const status = statusForRecord(nextRecord);
  const recordWithStatus = { ...nextRecord, status, updatedAt: Date.now() };
  return {
    recordsByWorkspaceId: {
      ...state.recordsByWorkspaceId,
      [workspaceId]: {
        ...workspaceRecords,
        [sessionId]: recordWithStatus,
      },
    },
    statusesByWorkspaceId: updateWorkspaceStatus(state.statusesByWorkspaceId, workspaceId, sessionId, status),
  };
}

function removeValue(values: string[], value: string) {
  return values.filter((item) => item !== value);
}

function addValue(values: string[], value: string) {
  return values.includes(value) ? values : [...values, value];
}

export const useSessionActivityStore = create<SessionActivityStore>((set, get) => ({
  recordsByWorkspaceId: {},
  statusesByWorkspaceId: {},
  getStatus: (workspaceId, sessionId) => (
    get().statusesByWorkspaceId[workspaceId]?.[sessionId] ?? "idle"
  ),
  getStopRequested: (workspaceId, sessionId) => (
    get().recordsByWorkspaceId[workspaceId]?.[sessionId]?.stopRequested ?? false
  ),
  getRunIdentity: (workspaceId, sessionId) => {
    const record = get().recordsByWorkspaceId[workspaceId]?.[sessionId];
    if (!record?.runKey || record.runStartedAt === null) return null;
    return {
      runKey: record.runKey,
      runStartedAt: record.runStartedAt,
    };
  },
  getErrorMessage: (workspaceId, sessionId) => (
    get().recordsByWorkspaceId[workspaceId]?.[sessionId]?.errorMessage ?? null
  ),
  seedWorkspaceSessions: (workspaceId, sessions) => {
    const id = workspaceId.trim();
    if (!id) return;
    set((state) => {
      let nextState = state;
      for (const session of sessions) {
        const sessionId = session.id.trim();
        if (!sessionId) continue;
        const status = sessionRunStatus(session);
        if (status === undefined || status === null) continue;
          nextState = {
            ...nextState,
            ...updateRecord(nextState, id, sessionId, (record) => {
              return applyRuntimeStatus(
                record,
                status,
                record.assistantOutput,
                createRunIdentity(sessionId),
              );
            }),
          };
      }
      return nextState;
    });
  },
  seedSessionRun: (workspaceId, sessionId, status, assistantOutput) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    set((state) => updateRecord(state, workspace, session, (record) => {
      return applyRuntimeStatus(
        record,
        status,
        assistantOutput,
        createRunIdentity(session),
      );
    }));
  },
  startRun: (workspaceId, sessionId, identity) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    const runIdentity = identity ?? createRunIdentity(session);
    set((state) => updateRecord(state, workspace, session, (record) => ({
      ...record,
      runActive: true,
      stopRequested: false,
      runKey: runIdentity.runKey,
      runStartedAt: runIdentity.runStartedAt,
      assistantOutput: false,
      retrying: false,
      errorActive: false,
      errorMessage: null,
      compacting: false,
      waitingPermissionIds: [],
      waitingQuestionIds: [],
    })));
  },
  markRunStopped: (workspaceId, sessionId) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    set((state) => updateRecord(state, workspace, session, (record) => ({
      ...record,
      runActive: false,
      stopRequested: true,
      assistantOutput: false,
      retrying: false,
      compacting: false,
      waitingPermissionIds: [],
      waitingQuestionIds: [],
    })));
  },
  setRunStatus: (workspaceId, sessionId, status) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    set((state) => updateRecord(state, workspace, session, (record) => {
      return applyRuntimeStatus(
        record,
        status,
        record.assistantOutput,
        createRunIdentity(session),
      );
    }));
  },
  markMessageRole: (workspaceId, sessionId, messageId, role) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    const message = messageId.trim();
    if (!workspace || !session || !message) return;
    set((state) => updateRecord(state, workspace, session, (record) => ({
      ...record,
      messageRoles: {
        ...record.messageRoles,
        [message]: role,
      },
    })));
  },
  markAssistantOutput: (workspaceId, sessionId, messageId, options) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    const message = messageId?.trim() ?? "";
    if (!workspace || !session) return;
    set((state) => updateRecord(state, workspace, session, (record) => {
      if (!record.runActive) return record;
      if (message && record.messageRoles[message] && record.messageRoles[message] !== "assistant") return record;
      if (message && !record.messageRoles[message] && options?.allowUnknownMessageRole !== true) return record;
      return { ...record, assistantOutput: true };
    }));
  },
  setWaitingRequest: (workspaceId, sessionId, kind, requestId, waiting) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    const request = requestId.trim();
    if (!workspace || !session || !request) return;
    set((state) => updateRecord(state, workspace, session, (record) => {
      const key = kind === "permission" ? "waitingPermissionIds" : "waitingQuestionIds";
      return {
        ...record,
        [key]: waiting ? addValue(record[key], request) : removeValue(record[key], request),
      };
    }));
  },
  replaceWaitingRequests: (workspaceId, sessionId, kind, requestIds) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    const ids = Array.from(new Set(requestIds.map((requestId) => requestId.trim()).filter(Boolean)));
    set((state) => updateRecord(state, workspace, session, (record) => ({
      ...record,
      [kind === "permission" ? "waitingPermissionIds" : "waitingQuestionIds"]: ids,
    })));
  },
  setError: (workspaceId, sessionId, message) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    const errorMessage = message?.trim() || null;
    set((state) => updateRecord(state, workspace, session, (record) => ({
      ...record,
      errorActive: true,
      errorMessage,
      runActive: false,
      assistantOutput: false,
      retrying: false,
      compacting: false,
    })));
  },
  clearError: (workspaceId, sessionId) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    set((state) => updateRecord(state, workspace, session, (record) => ({
      ...record,
      errorActive: false,
      errorMessage: null,
    })));
  },
  setCompacting: (workspaceId, sessionId, compacting) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    set((state) => updateRecord(state, workspace, session, (record) => ({
      ...record,
      compacting,
      errorActive: compacting ? false : record.errorActive,
    })));
  },
  removeSession: (workspaceId, sessionId) => {
    const workspace = workspaceId.trim();
    const session = sessionId.trim();
    if (!workspace || !session) return;
    set((state) => {
      const workspaceRecords = state.recordsByWorkspaceId[workspace];
      const workspaceStatuses = state.statusesByWorkspaceId[workspace];
      if (!workspaceRecords?.[session] && !workspaceStatuses?.[session]) return state;
      const nextRecords = { ...(workspaceRecords ?? {}) };
      const nextStatuses = { ...(workspaceStatuses ?? {}) };
      delete nextRecords[session];
      delete nextStatuses[session];
      return {
        ...state,
        recordsByWorkspaceId: {
          ...state.recordsByWorkspaceId,
          [workspace]: nextRecords,
        },
        statusesByWorkspaceId: {
          ...state.statusesByWorkspaceId,
          [workspace]: nextStatuses,
        },
      };
    });
  },
}));

export function getSessionActivityStatusLabel(status: SessionActivityStatus) {
  if (status === "thinking") return t("session.assistant_thinking");
  if (status === "responding") return t("session.assistant_responding");
  if (status === "retrying") return t("session.assistant_retrying");
  if (status === "waiting") return t("session.assistant_waiting");
  if (status === "compacting") return t("session.assistant_compacting");
  if (status === "error") return t("session.assistant_error");
  return t("session.assistant_idle");
}
