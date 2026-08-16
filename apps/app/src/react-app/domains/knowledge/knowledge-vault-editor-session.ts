import { noteKey, type KnowledgeNoteRef } from "./knowledge-vault-model";

export type KnowledgeEditorIo = {
  read: (
    note: KnowledgeNoteRef,
  ) => Promise<{ ok: boolean; content?: string; reason?: string }>;
  write: (
    note: KnowledgeNoteRef,
    content: string,
  ) => Promise<{ ok?: boolean }>;
};

export type KnowledgeAutosaveToken = {
  gen: number;
  note: KnowledgeNoteRef;
  content: string;
};

export function shouldApplyOpenResult(currentGen: number, openGen: number): boolean {
  return currentGen === openGen;
}

export function shouldApplyAutosaveLoaded(input: {
  currentGen: number;
  saveGen: number;
  selected: KnowledgeNoteRef | null;
  savedNote: KnowledgeNoteRef;
}): boolean {
  return (
    input.currentGen === input.saveGen &&
    input.selected != null &&
    noteKey(input.selected) === noteKey(input.savedNote)
  );
}

export function createKnowledgeEditorSession() {
  let gen = 0;
  let selected: KnowledgeNoteRef | null = null;
  let draft = "";
  let loaded = "";

  return {
    snapshot() {
      return { gen, selected, draft, loaded };
    },
    setDraft(value: string) {
      draft = value;
    },
    startOpen(note: KnowledgeNoteRef) {
      gen += 1;
      const flush =
        selected && noteKey(selected) !== noteKey(note) && draft !== loaded
          ? { note: selected, content: draft }
          : null;
      selected = note;
      draft = "";
      loaded = "";
      return { gen, flush };
    },
    applyOpenResult(
      openGen: number,
      result: { ok: boolean; content?: string },
    ): { applied: boolean; reason?: "stale" | "read_failed" } {
      if (!shouldApplyOpenResult(gen, openGen)) {
        return { applied: false, reason: "stale" };
      }
      if (!result.ok || typeof result.content !== "string") {
        return { applied: false, reason: "read_failed" };
      }
      draft = result.content;
      loaded = result.content;
      return { applied: true };
    },
    beginAutosave(): KnowledgeAutosaveToken | null {
      if (!selected || draft === loaded) return null;
      return { gen, note: selected, content: draft };
    },
    applyAutosaveLoaded(token: KnowledgeAutosaveToken): { applied: boolean } {
      if (
        !shouldApplyAutosaveLoaded({
          currentGen: gen,
          saveGen: token.gen,
          selected,
          savedNote: token.note,
        })
      ) {
        return { applied: false };
      }
      loaded = token.content;
      return { applied: true };
    },
  };
}

export type KnowledgeEditorSession = ReturnType<typeof createKnowledgeEditorSession>;

export async function openKnowledgeNote(
  session: KnowledgeEditorSession,
  io: KnowledgeEditorIo,
  note: KnowledgeNoteRef,
) {
  const { gen, flush } = session.startOpen(note);
  if (flush) await io.write(flush.note, flush.content);
  const result = await io.read(note);
  return session.applyOpenResult(gen, result);
}

export async function completeAutosave(
  session: KnowledgeEditorSession,
  io: KnowledgeEditorIo,
  token: KnowledgeAutosaveToken,
) {
  await io.write(token.note, token.content);
  return session.applyAutosaveLoaded(token);
}
