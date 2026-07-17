import type { WorkspaceSessionGroup } from "../../../../app/types";
import type { AssistantCategoryId } from "../surface/personal-assistant-config";
import { readAssistantSessionCategory } from "../../agents";

export type AssistantSelectionMemory =
  | { kind: "newTask" }
  | { kind: "automation" }
  | { kind: "session"; sessionId: string };

const ASSISTANT_SELECTION_STORAGE_KEY = "onmyagent.assistantSelection.v1";

function memoryKey(workspaceId: string, categoryId: AssistantCategoryId) {
  return `${workspaceId}:${categoryId}`;
}

function parseSelection(value: unknown): AssistantSelectionMemory | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!("kind" in value)) return null;
  if (value.kind === "newTask") return { kind: "newTask" };
  if (value.kind === "automation") return { kind: "automation" };
  if (
    value.kind === "session" &&
    "sessionId" in value &&
    typeof value.sessionId === "string" &&
    value.sessionId.trim()
  ) {
    return { kind: "session", sessionId: value.sessionId };
  }
  return null;
}

function readSelectionRecord() {
  if (typeof window === "undefined") return {};
  try {
    const parsed: unknown = JSON.parse(
      window.localStorage.getItem(ASSISTANT_SELECTION_STORAGE_KEY) ?? "{}",
    );
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed));
  } catch {
    return {};
  }
}

export function readAssistantSelectionMemory(
  workspaceId: string,
  categoryId: AssistantCategoryId,
): AssistantSelectionMemory {
  return parseSelection(readSelectionRecord()[memoryKey(workspaceId, categoryId)]) ?? { kind: "newTask" };
}

export function writeAssistantSelectionMemory(
  workspaceId: string,
  categoryId: AssistantCategoryId,
  selection: AssistantSelectionMemory,
) {
  if (typeof window === "undefined") return;
  try {
    const record = readSelectionRecord();
    record[memoryKey(workspaceId, categoryId)] = selection;
    window.localStorage.setItem(ASSISTANT_SELECTION_STORAGE_KEY, JSON.stringify(record));
  } catch {
    return;
  }
}

export function resolveAssistantSelectionMemory(input: {
  workspaceId: string;
  categoryId: AssistantCategoryId;
  selection: AssistantSelectionMemory;
  sessions: WorkspaceSessionGroup["sessions"];
}): AssistantSelectionMemory {
  if (input.selection.kind !== "session") return input.selection;
  const selection = input.selection;
  const exists = input.sessions.some(
    (session) =>
      session.id === selection.sessionId &&
      readAssistantSessionCategory(session.id) === input.categoryId,
  );
  return exists ? selection : { kind: "newTask" };
}
