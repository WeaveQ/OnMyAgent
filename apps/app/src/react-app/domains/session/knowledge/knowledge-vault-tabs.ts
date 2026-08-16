import { noteKey, type KnowledgeNoteRef } from "./knowledge-vault-model";

export type KnowledgeEditorTab = {
  id: string;
  note: KnowledgeNoteRef | null;
  draft: string;
  loaded: string;
};

export function createKnowledgeEditorTab(
  note: KnowledgeNoteRef | null = null,
  content = "",
): KnowledgeEditorTab {
  const stamp = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
  return { id: `tab-${stamp}`, note, draft: content, loaded: content };
}

export function activateOrReuseTab(
  tabs: readonly KnowledgeEditorTab[],
  activeId: string,
  note: KnowledgeNoteRef,
  content: string,
): { tabs: KnowledgeEditorTab[]; activeId: string } {
  const existing = tabs.find(
    (tab) => tab.note && noteKey(tab.note) === noteKey(note),
  );
  if (existing) {
    return { tabs: [...tabs], activeId: existing.id };
  }
  const active = tabs.find((tab) => tab.id === activeId);
  if (active && !active.note) {
    return {
      tabs: tabs.map((tab) =>
        tab.id === activeId ? { ...tab, note, draft: content, loaded: content } : tab,
      ),
      activeId,
    };
  }
  const created = createKnowledgeEditorTab(note, content);
  return { tabs: [...tabs, created], activeId: created.id };
}

export function closeKnowledgeEditorTab(
  tabs: readonly KnowledgeEditorTab[],
  closeId: string,
): { tabs: KnowledgeEditorTab[]; activeId: string } {
  const index = tabs.findIndex((tab) => tab.id === closeId);
  const remaining = tabs.filter((tab) => tab.id !== closeId);
  if (remaining.length === 0) {
    const empty = createKnowledgeEditorTab();
    return { tabs: [empty], activeId: empty.id };
  }
  const nextIndex = Math.max(0, index - 1);
  return { tabs: remaining, activeId: remaining[nextIndex]?.id ?? remaining[0].id };
}

export function addKnowledgeEditorTab(
  tabs: readonly KnowledgeEditorTab[],
): { tabs: KnowledgeEditorTab[]; activeId: string } {
  const empty = createKnowledgeEditorTab();
  return { tabs: [...tabs, empty], activeId: empty.id };
}
