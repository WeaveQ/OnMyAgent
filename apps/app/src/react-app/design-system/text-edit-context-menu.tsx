/** @jsxImportSource react */
import { useCallback, useRef, useState, type MouseEvent } from "react";
import { ClipboardPaste, Copy, Scissors } from "lucide-react";

import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";

import {
  closestEditableElement,
  selectEditableContents,
  snapshotTextEditFlags,
  type TextEditFlags,
} from "./text-edit-flags";

const EMPTY_FLAGS: TextEditFlags = {
  canCut: false,
  canCopy: false,
  canPaste: false,
};

export function TextEditContextMenu(props: {
  children: React.ReactNode;
  className?: string;
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const editableRef = useRef<HTMLElement | null>(null);
  const [flags, setFlags] = useState<TextEditFlags>(EMPTY_FLAGS);

  const rememberEditable = useCallback((event: MouseEvent) => {
    const editable =
      closestEditableElement(event.target) ??
      closestEditableElement(document.activeElement);
    editableRef.current = editable;
    setFlags(
      snapshotTextEditFlags(
        window.getSelection(),
        editable ?? document.activeElement,
      ),
    );
  }, []);

  const focusEditable = useCallback(() => {
    editableRef.current?.focus();
  }, []);

  const runCopy = useCallback(() => {
    const text = window.getSelection()?.toString() ?? "";
    if (!text) return;
    void navigator.clipboard?.writeText(text).catch(() => {
      document.execCommand("copy");
    });
  }, []);

  const runCut = useCallback(() => {
    focusEditable();
    document.execCommand("cut");
  }, [focusEditable]);

  const runPaste = useCallback(() => {
    focusEditable();
    void navigator.clipboard
      ?.readText()
      .then((text) => {
        if (text) document.execCommand("insertText", false, text);
      })
      .catch(() => {
        document.execCommand("paste");
      });
  }, [focusEditable]);

  const runSelectAll = useCallback(() => {
    const root = rootRef.current;
    const editable =
      editableRef.current ??
      root?.querySelector<HTMLElement>("[contenteditable='true']") ??
      root;
    if (!editable) return;
    selectEditableContents(editable);
  }, []);

  return (
    <ContextMenu>
      <ContextMenuTrigger
        className="select-text"
        render={
          <div
            ref={rootRef}
            className={cn("min-h-0 select-text", props.className)}
            data-text-edit-context-menu="true"
            onContextMenu={rememberEditable}
          />
        }
      >
        {props.children}
      </ContextMenuTrigger>
      <ContextMenuContent className="min-w-40" aria-label={t("common.edit")}>
        <ContextMenuItem
          className="hover:bg-accent hover:text-accent-foreground"
          disabled={!flags.canCut}
          onClick={runCut}
        >
          <Scissors className="size-4" />
          {t("common.cut")}
        </ContextMenuItem>
        <ContextMenuItem
          className="hover:bg-accent hover:text-accent-foreground"
          disabled={!flags.canCopy}
          onClick={runCopy}
        >
          <Copy className="size-4" />
          {t("common.copy")}
        </ContextMenuItem>
        <ContextMenuItem
          className="hover:bg-accent hover:text-accent-foreground"
          disabled={!flags.canPaste}
          onClick={runPaste}
        >
          <ClipboardPaste className="size-4" />
          {t("common.paste")}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="hover:bg-accent hover:text-accent-foreground"
          onClick={runSelectAll}
        >
          {t("common.select_all")}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
