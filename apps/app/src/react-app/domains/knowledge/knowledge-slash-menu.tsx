/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Braces,
  CheckSquare,
  Code2,
  Heading1,
  Heading2,
  Heading3,
  List,
  ListOrdered,
  Quote,
  TextCursorInput,
  Type,
} from "lucide-react";
import type { PlateEditor } from "platejs/react";

import { cn } from "@/lib/utils";
import { t } from "../../../i18n";

export type SlashCommand = {
  key: string;
  label: string;
  keywords: string[];
  icon: React.ComponentType<{ className?: string }>;
  run: (editor: PlateEditor) => void;
};

type EditorWithSetNodes = PlateEditor & {
  setNodes?: (props: Record<string, unknown>) => void;
};

const setBlock = (editor: PlateEditor, type: string) => {
  // Plate v53 exposes setNodes on the Slate editor instance.
  const tf = (editor as EditorWithSetNodes).setNodes;
  if (typeof tf === "function") {
    tf.call(editor, { type });
  }
};

const insertList = (editor: PlateEditor, listType: "ul" | "ol") => {
  const tf = (editor as EditorWithSetNodes).setNodes;
  if (typeof tf === "function") {
    tf.call(editor, { type: listType === "ol" ? "ol" : "ul" });
  }
};

export function buildSlashCommands(): SlashCommand[] {
  return [
    {
      key: "paragraph",
      label: t("knowledge.slash_paragraph"),
      keywords: ["text", "p", "paragraph"],
      icon: Type,
      run: (editor) => setBlock(editor, "p"),
    },
    {
      key: "h1",
      label: t("knowledge.slash_h1"),
      keywords: ["heading", "title"],
      icon: Heading1,
      run: (editor) => setBlock(editor, "h1"),
    },
    {
      key: "h2",
      label: t("knowledge.slash_h2"),
      keywords: ["heading", "subtitle"],
      icon: Heading2,
      run: (editor) => setBlock(editor, "h2"),
    },
    {
      key: "h3",
      label: t("knowledge.slash_h3"),
      keywords: ["heading"],
      icon: Heading3,
      run: (editor) => setBlock(editor, "h3"),
    },
    {
      key: "bulleted-list",
      label: t("knowledge.slash_bullet_list"),
      keywords: ["ul", "unordered", "list"],
      icon: List,
      run: (editor) => insertList(editor, "ul"),
    },
    {
      key: "numbered-list",
      label: t("knowledge.slash_numbered_list"),
      keywords: ["ol", "ordered", "list"],
      icon: ListOrdered,
      run: (editor) => insertList(editor, "ol"),
    },
    {
      key: "todo",
      label: t("knowledge.slash_todo"),
      keywords: ["task", "checkbox", "todo"],
      icon: CheckSquare,
      run: (editor) => setBlock(editor, "action_item"),
    },
    {
      key: "quote",
      label: t("knowledge.slash_quote"),
      keywords: ["blockquote", "quote"],
      icon: Quote,
      run: (editor) => setBlock(editor, "blockquote"),
    },
    {
      key: "code",
      label: t("knowledge.slash_code"),
      keywords: ["block", "snippet", "code"],
      icon: Code2,
      run: (editor) => setBlock(editor, "code_block"),
    },
  ];
}

// Reserved for a future table command; avoids an unused import while the slash
// surface stabilizes (table insertion needs cell construction).
export const TABLE_COMMAND_META = { key: "table", icon: Braces, label: "Table" };
void TextCursorInput;

type KnowledgeSlashMenuProps = {
  editor: PlateEditor | null;
};

type Rect = { top: number; left: number };

export function KnowledgeSlashMenu({ editor }: KnowledgeSlashMenuProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const commands = useMemo(() => buildSlashCommands(), []);
  const restorePoint = useRef<{ node: unknown; offset: number } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return commands;
    return commands.filter(
      (c) =>
        c.label.toLowerCase().includes(needle) ||
        c.keywords.some((k) => k.toLowerCase().includes(needle)),
    );
  }, [commands, query]);

  useEffect(() => {
    if (!editor) return;
    // The slash menu listens on the editor's editable element. We attach to the
    // currently focused element inside the editor and anchor the popover to the
    // caret rect, so the menu does not depend on Plate internals.
    const editable = document.activeElement;
    if (!(editable instanceof HTMLElement)) return;

    const onKeyDown = (event: KeyboardEvent) => {
      const sel = window.getSelection();
      const node = sel?.anchorNode;
      const text = node?.textContent ?? "";
      const offset = sel?.anchorOffset ?? 0;

      if (event.key === "/" && !open && (text.slice(0, offset).trim() === "" || offset === 0)) {
        setOpen(true);
        setQuery("");
        setActive(0);
        const range = sel?.getRangeAt(0);
        const r = range?.getBoundingClientRect();
        if (r) setRect({ top: r.bottom + 4, left: r.left });
        return;
      }
      if (!open) return;

      if (event.key === "Escape") {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setActive((i) => Math.min(i + 1, filtered.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setActive((i) => Math.max(i - 1, 0));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const cmd = filtered[active];
        if (cmd) {
          cmd.run(editor);
          setOpen(false);
        }
        return;
      }
      if (event.key === "Backspace" && query === "") {
        setOpen(false);
        return;
      }
    };

    const onInput = () => {
      if (!open) return;
      const sel = window.getSelection();
      const text = sel?.anchorNode?.textContent ?? "";
      const offset = sel?.anchorOffset ?? 0;
      const match = text.slice(0, offset).match(/\/(.*)$/);
      if (!match) {
        setOpen(false);
        return;
      }
      setQuery(match[1] ?? "");
    };

    editable.addEventListener("keydown", onKeyDown as EventListener, true);
    editable.addEventListener("input", onInput as EventListener, true);
    return () => {
      editable.removeEventListener("keydown", onKeyDown as EventListener, true);
      editable.removeEventListener("input", onInput as EventListener, true);
    };
  }, [editor, open, query, active, filtered]);

  void restorePoint;

  if (!open || filtered.length === 0 || !rect) return null;

  return (
    <div
      className="fixed z-50 w-64 overflow-hidden rounded-xl border border-dls-border bg-dls-surface-solid p-1"
      style={{ top: rect.top, left: rect.left }}
      role="listbox"
    >
      {filtered.map((cmd, index) => {
        const Icon = cmd.icon;
        return (
          <button
            key={cmd.key}
            type="button"
            role="option"
            aria-selected={index === active}
            onMouseEnter={() => setActive(index)}
            onClick={() => {
              cmd.run(editor as PlateEditor);
              setOpen(false);
            }}
            className={cn(
              "flex w-full cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left text-sm",
              index === active
                ? "bg-dls-list-selected text-dls-text"
                : "text-dls-secondary hover:bg-dls-list-hover",
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{cmd.label}</span>
          </button>
        );
      })}
    </div>
  );
}
