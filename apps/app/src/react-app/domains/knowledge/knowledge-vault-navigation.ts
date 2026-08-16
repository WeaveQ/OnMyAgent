import type { KnowledgeNoteRef } from "./knowledge-vault-model";

export const OPEN_KNOWLEDGE_NOTE_EVENT = "oma-open-knowledge-note";

let pendingNote: KnowledgeNoteRef | null = null;

export function takePendingKnowledgeNote(): KnowledgeNoteRef | null {
  const note = pendingNote;
  pendingNote = null;
  return note;
}

export function openKnowledgeNoteInRail(note: KnowledgeNoteRef): void {
  const scope =
    note.scope === "project" || note.scope === "expert" ? note.scope : "user";
  pendingNote = { scope, relPath: note.relPath };
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(OPEN_KNOWLEDGE_NOTE_EVENT, { detail: pendingNote }));
}

export function subscribeOpenKnowledgeNote(
  listener: (note: KnowledgeNoteRef) => void,
): () => void {
  if (typeof window === "undefined") return () => undefined;
  const onEvent = (event: Event) => {
    const detail = (event as CustomEvent<KnowledgeNoteRef>).detail;
    if (!detail?.relPath) return;
    const scope =
      detail.scope === "project" || detail.scope === "expert" ? detail.scope : "user";
    listener({ scope, relPath: detail.relPath });
  };
  window.addEventListener(OPEN_KNOWLEDGE_NOTE_EVENT, onEvent);
  return () => window.removeEventListener(OPEN_KNOWLEDGE_NOTE_EVENT, onEvent);
}
