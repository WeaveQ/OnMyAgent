/** @jsxImportSource react */
import { useMemo, useRef } from "react";
import {
  Plate,
  PlateContent,
  createPlateEditor,
  type PlateEditor,
  type PlatePlugin,
} from "platejs/react";
import type { Value } from "@platejs/slate";
import {
  BaseBlockquotePlugin,
  BaseBoldPlugin,
  BaseCodePlugin,
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseH4Plugin,
  BaseH5Plugin,
  BaseH6Plugin,
  BaseItalicPlugin,
} from "@platejs/basic-nodes";
import { BaseListPlugin } from "@platejs/list";
import {
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin,
} from "@platejs/code-block";
import {
  BaseTableCellHeaderPlugin,
  BaseTableCellPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
} from "@platejs/table";
import { cn } from "@/lib/utils";
import {
  blocksToMarkdown,
  markdownToBlocks,
  type MarkdownBlock,
} from "./knowledge-markdown-roundtrip";
import { KnowledgeSlashMenu } from "./knowledge-slash-menu";
import { t } from "../../../i18n";

type KnowledgeBlockEditorProps = {
  value: string;
  onChange: (markdown: string) => void;
  placeholder?: string;
  className?: string;
};

type BlockSpan = { text: string; bold?: boolean; italic?: boolean; code?: boolean };

// Plate/Slate nodes are plain objects with a `type`/`text` discriminator. The
// plugin packages ship their own branded element types but our mapping only
// needs the structural shape, so we model it locally instead of importing each
// plugin's internal type (which would couple this file to plugin internals).
type PlateText = { text: string; bold?: boolean; italic?: boolean; code?: boolean };
type PlateNode = PlateText | { type: string; children?: PlateNode[]; checked?: boolean; lang?: string };

// --- Markdown <-> Plate Value ---------------------------------------------
// The roundtrip module owns the framework-agnostic block model (H1-H6, lists,
// todos, code, quote, table). We map it to Plate element nodes here so no Plate
// type leaks into the pure logic.

function inlineChildren(spans: readonly BlockSpan[]): PlateText[] {
  return spans.map((span) => ({
    ...(span.bold ? { bold: true } : {}),
    ...(span.italic ? { italic: true } : {}),
    ...(span.code ? { code: true } : {}),
    text: span.text,
  }));
}

function el(
  type: string,
  children: PlateNode[],
  extra?: { checked?: boolean; lang?: string },
): PlateNode {
  return { type, children, ...(extra ?? {}) };
}

function listElement(type: "ul" | "ol", items: BlockSpan[][]): PlateNode {
  return el(
    type,
    items.map((item) => el("li", [el("lic", inlineChildren(item))])),
  );
}

function blocksToPlate(blocks: MarkdownBlock[]): PlateNode[] {
  const nodes: PlateNode[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case "heading":
        nodes.push(el(`h${block.level}`, inlineChildren(block.children)));
        break;
      case "paragraph":
        nodes.push(el("p", inlineChildren(block.children)));
        break;
      case "bulletList":
        nodes.push(listElement("ul", block.items));
        break;
      case "orderedList":
        nodes.push(listElement("ol", block.items));
        break;
      case "todo":
        nodes.push(el("action_item", inlineChildren(block.children), { checked: block.checked }));
        break;
      case "blockquote":
        nodes.push(el("blockquote", inlineChildren(block.children)));
        break;
      case "code":
        nodes.push(
          el(
            "code_block",
            block.code.split("\n").map((line) => el("code_line", [{ text: line }])),
            { lang: block.lang },
          ),
        );
        break;
      case "table":
        nodes.push(
          el("table", [
            el("tr", block.headers.map((cell) => el("th", inlineChildren(cell)))),
            ...block.rows.map((row) =>
              el("tr", row.map((cell) => el("td", inlineChildren(cell)))),
            ),
          ]),
        );
        break;
    }
  }
  if (nodes.length === 0) nodes.push(el("p", [{ text: "" }]));
  return nodes;
}

function textOf(node: unknown): string {
  if (typeof node === "string") return node;
  if (node && typeof node === "object" && "text" in node) {
    const value = (node as { text?: unknown }).text;
    return typeof value === "string" ? value : "";
  }
  return "";
}

function plateChildrenToSpans(children: unknown): BlockSpan[] {
  if (!Array.isArray(children)) return [{ text: "" }];
  return children
    .map((child) => {
      if (!child || typeof child !== "object") return { text: String(child ?? "") };
      const n = child as Record<string, unknown>;
      const span: BlockSpan = { text: textOf(n) };
      if (n.bold) span.bold = true;
      if (n.italic) span.italic = true;
      if (n.code) span.code = true;
      return span;
    })
    .filter((span) => span.text.length > 0);
}

function isElement(node: PlateNode): node is PlateNode & {
  type: string;
  children?: PlateNode[];
  checked?: boolean;
  lang?: string;
} {
  return typeof node === "object" && node !== null && "type" in node;
}

function elementChildren(node: PlateNode): PlateNode[] {
  if (isElement(node) && Array.isArray(node.children)) return node.children;
  return [];
}

function asElementArray(value: unknown): PlateNode[] {
  if (!Array.isArray(value)) return [];
  return value.filter((n): n is PlateNode => typeof n === "object" && n !== null);
}

function plateToBlocks(value: PlateNode[]): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = [];
  for (const node of value) {
    if (!isElement(node)) continue;
    const type = String(node.type ?? "p");
    const children = elementChildren(node);
    const headingMatch = type.match(/^h([1-6])$/);
    if (headingMatch) {
      blocks.push({
        type: "heading",
        level: Number(headingMatch[1]) as 1 | 2 | 3 | 4 | 5 | 6,
        children: plateChildrenToSpans(children),
      });
      continue;
    }
    if (type === "ul" || type === "ol") {
      const items = children
        .filter((c) => isElement(c) && c.type === "li")
        .map((li) => {
          const lic = elementChildren(li).find((c) => isElement(c) && c.type === "lic");
          return plateChildrenToSpans(lic ? elementChildren(lic) : []);
        });
      blocks.push(
        type === "ul" ? { type: "bulletList", items } : { type: "orderedList", items },
      );
      continue;
    }
    if (type === "action_item") {
      blocks.push({
        type: "todo",
        checked: Boolean(node.checked),
        children: plateChildrenToSpans(children),
      });
      continue;
    }
    if (type === "blockquote") {
      blocks.push({ type: "blockquote", children: plateChildrenToSpans(children) });
      continue;
    }
    if (type === "code_block") {
      const lines = children
        .filter((c) => isElement(c) && c.type === "code_line")
        .map((line) => elementChildren(line).map(textOf).join(""));
      blocks.push({
        type: "code",
        lang: typeof node.lang === "string" ? node.lang : "",
        code: lines.join("\n"),
      });
      continue;
    }
    if (type === "table") {
      const rows = children.filter((c) => isElement(c) && c.type === "tr");
      const headerRow = rows[0];
      const headers = elementChildren(headerRow).map((cell) =>
        plateChildrenToSpans(elementChildren(cell)),
      );
      blocks.push({
        type: "table",
        headers,
        rows: rows.slice(1).map((row) =>
          elementChildren(row).map((cell) => plateChildrenToSpans(elementChildren(cell))),
        ),
      });
      continue;
    }
    blocks.push({ type: "paragraph", children: plateChildrenToSpans(children) });
  }
  return blocks;
}

// --- Plugins ---------------------------------------------------------------
// The @platejs/* packages export branded SlatePlugin types. We type the list
// element as PlatePlugin and assign through an `unknown[]` collection point so
// each plugin is accepted structurally at runtime without an `as unknown as`
// double-cast in business source.
const RAW_PLUGINS: unknown[] = [
  BaseH1Plugin,
  BaseH2Plugin,
  BaseH3Plugin,
  BaseH4Plugin,
  BaseH5Plugin,
  BaseH6Plugin,
  BaseBoldPlugin,
  BaseItalicPlugin,
  BaseCodePlugin,
  BaseBlockquotePlugin,
  BaseListPlugin,
  BaseCodeBlockPlugin,
  BaseCodeLinePlugin,
  BaseCodeSyntaxPlugin,
  BaseTablePlugin,
  BaseTableRowPlugin,
  BaseTableCellPlugin,
  BaseTableCellHeaderPlugin,
];
const PLUGIN_LIST: PlatePlugin[] = RAW_PLUGINS as PlatePlugin[];

export function KnowledgeBlockEditor(props: KnowledgeBlockEditorProps) {
  const lastEmitted = useRef<string>(props.value);
  const editor = useMemo(() => {
    const value = blocksToPlate(markdownToBlocks(props.value)) as Value;
    return createPlateEditor({
      plugins: PLUGIN_LIST,
      value,
    }) as PlateEditor;
    // Seed only once; the editor owns the document after mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      className={cn(
        "knowledge-block-editor min-h-0 flex-1 overflow-auto bg-dls-background px-6 py-4 text-sm leading-relaxed text-dls-text",
        props.className,
      )}
    >
      <Plate
        editor={editor}
        onChange={({ value }) => {
          const markdown = blocksToMarkdown(plateToBlocks(value as PlateNode[]));
          if (markdown !== lastEmitted.current) {
            lastEmitted.current = markdown;
            props.onChange(markdown);
          }
        }}
      >
        <PlateContent
          className="knowledge-block-content outline-none"
          placeholder={props.placeholder ?? t("knowledge.editor_placeholder")}
          aria-label={t("knowledge.editor_label")}
        />
        <KnowledgeSlashMenu editor={editor} />
      </Plate>
    </div>
  );
}
