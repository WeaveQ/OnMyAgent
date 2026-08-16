import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "bun:test";

import {
  completeAutosave,
  createKnowledgeEditorSession,
  openKnowledgeNote,
} from "../src/react-app/domains/knowledge/knowledge-vault-editor-session";
import type { KnowledgeNoteRef } from "../src/react-app/domains/knowledge/knowledge-vault-model";

const noteA: KnowledgeNoteRef = { scope: "user", relPath: "a.md" };
const noteB: KnowledgeNoteRef = { scope: "user", relPath: "b.md" };
const noteC: KnowledgeNoteRef = { scope: "user", relPath: "c.md" };

describe("knowledge editor session", () => {
  test("in-flight autosave of A cannot persist onto B after open starts", async () => {
    const writes: Array<{ relPath: string; content: string }> = [];
    const bodies: Record<string, string> = {
      "a.md": "A-old",
      "b.md": "B-body",
    };
    const io = {
      read: async (note: KnowledgeNoteRef) => ({
        ok: true,
        content: bodies[note.relPath],
      }),
      write: async (note: KnowledgeNoteRef, content: string) => {
        writes.push({ relPath: note.relPath, content });
        bodies[note.relPath] = content;
        return { ok: true };
      },
    };
    const session = createKnowledgeEditorSession();
    await openKnowledgeNote(session, io, noteA);
    session.setDraft("A-dirty");
    const token = session.beginAutosave();
    expect(token?.note.relPath).toBe("a.md");

    const opening = session.startOpen(noteB);
    expect(opening.flush).toEqual({ note: noteA, content: "A-dirty" });
    if (opening.flush) {
      await io.write(opening.flush.note, opening.flush.content);
    }

    const applied = await completeAutosave(session, io, token!);
    expect(applied.applied).toBe(false);
    expect(session.beginAutosave()).toBeNull();
    expect(
      writes.some((entry) => entry.relPath === "b.md"),
    ).toBe(false);
    expect(bodies["b.md"]).toBe("B-body");

    const opened = session.applyOpenResult(opening.gen, {
      ok: true,
      content: "B-body",
    });
    expect(opened.applied).toBe(true);
  });

  test("late read of B after selecting C is not applied as C's loaded baseline", async () => {
    const writes: Array<{ relPath: string; content: string }> = [];
    const io = {
      read: async (note: KnowledgeNoteRef) => ({
        ok: true,
        content: note.relPath === "b.md" ? "B-body" : "C-body",
      }),
      write: async (note: KnowledgeNoteRef, content: string) => {
        writes.push({ relPath: note.relPath, content });
        return { ok: true };
      },
    };
    const session = createKnowledgeEditorSession();
    const openB = session.startOpen(noteB);
    session.startOpen(noteC);
    const stale = session.applyOpenResult(openB.gen, {
      ok: true,
      content: "B-body",
    });
    expect(stale).toEqual({ applied: false, reason: "stale" });
    expect(session.beginAutosave()).toBeNull();
    expect(writes).toEqual([]);
    expect(session.snapshot().selected).toEqual(noteC);
    expect(session.snapshot().draft).toBe("");
    expect(session.snapshot().loaded).toBe("");
  });

  test("rail page binds open/save to the editor session", () => {
    const page = readFileSync(
      resolve(
        import.meta.dir,
        "../src/react-app/domains/knowledge/knowledge-vault-page.tsx",
      ),
      "utf8",
    );
    expect(page).toContain("createKnowledgeEditorSession");
    expect(page).toContain("applyAutosaveLoaded");
    expect(page).toContain("applyOpenResult");
    expect(page).toContain("FolderOpen");
    expect(page).toContain("ChevronsDown");
    expect(page).toContain("ChevronsUp");
    expect(page).not.toContain("FolderInput");
    expect(page).toContain("grid-cols-[16rem_minmax(0,1fr)]");
    expect(page).toContain("grid-rows-[auto_minmax(0,1fr)_auto]");
    expect(page).toContain('t("knowledge.stat_props"');
    expect(page).not.toContain("flex w-64 shrink-0 flex-col");
    const reader = readFileSync(
      resolve(
        import.meta.dir,
        "../src/react-app/domains/knowledge/knowledge-vault-reader.tsx",
      ),
      "utf8",
    );
    expect(reader).not.toContain("knowledge.stat_props");
  });
});
