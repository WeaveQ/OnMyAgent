import { Lexer, type Tokens } from "marked";

// Framework-agnostic editor doc model. Deliberately has no Plate/Slate/React
// imports so it stays trivially unit-testable; Slice 2 maps this to/from
// Plate values.

export type BlockText = {
  text: string;
  bold?: boolean;
  italic?: boolean;
  code?: boolean;
};

export type MarkdownBlock =
  | { type: "heading"; level: 1 | 2 | 3 | 4 | 5 | 6; children: BlockText[] }
  | { type: "paragraph"; children: BlockText[] }
  | { type: "bulletList"; items: BlockText[][] }
  | { type: "orderedList"; items: BlockText[][] }
  | { type: "todo"; checked: boolean; children: BlockText[] }
  | { type: "blockquote"; children: BlockText[] }
  | { type: "code"; lang: string; code: string }
  | { type: "table"; headers: BlockText[][]; rows: BlockText[][][] };

type InlineMarks = { bold?: boolean; italic?: boolean; code?: boolean };

const LEXER_OPTIONS = { gfm: true, breaks: false } as const;

// Walk marked's inline token tree into flat BlockText spans, applying marks.
function walkInline(tokens: readonly Tokens.Generic[] | undefined, marks: InlineMarks): BlockText[] {
  const out: BlockText[] = [];
  if (!tokens) return out;
  for (const token of tokens) {
    switch (token.type) {
      case "text": {
        if (token.tokens) {
          out.push(...walkInline(token.tokens, marks));
        } else {
          out.push(mkSpan(token.text ?? "", marks));
        }
        break;
      }
      case "strong":
        out.push(...walkInline(token.tokens, { ...marks, bold: true }));
        break;
      case "em":
        out.push(...walkInline(token.tokens, { ...marks, italic: true }));
        break;
      case "codespan":
        // A code span overrides surrounding emphasis marks.
        out.push({ text: token.text ?? "", code: true });
        break;
      case "link":
        // The model has no link node; preserve the raw markdown verbatim so it
        // round-trips back through the lexer as a link.
        out.push(mkSpan(token.raw ?? "", marks));
        break;
      case "del":
        // Strikethrough is not in the minimal mark set; keep content.
        out.push(...walkInline(token.tokens, marks));
        break;
      case "br":
        out.push(mkSpan("\n", marks));
        break;
      case "escape":
        out.push(mkSpan(token.text ?? "", marks));
        break;
      case "html":
        out.push(mkSpan(token.raw ?? "", marks));
        break;
      case "image":
        out.push(mkSpan(token.raw ?? "", marks));
        break;
      default:
        if (token.tokens) {
          out.push(...walkInline(token.tokens, marks));
        } else if (typeof token.text === "string") {
          out.push(mkSpan(token.text, marks));
        }
    }
  }
  return mergeAdjacent(out);
}

function mkSpan(text: string, marks: InlineMarks): BlockText {
  if (!text) return { text };
  const span: BlockText = { text };
  if (marks.bold) span.bold = true;
  if (marks.italic) span.italic = true;
  if (marks.code) span.code = true;
  return span;
}

function sameMarks(a: BlockText, b: BlockText): boolean {
  return !!a.bold === !!b.bold && !!a.italic === !!b.italic && !!a.code === !!b.code;
}

function mergeAdjacent(spans: BlockText[]): BlockText[] {
  const out: BlockText[] = [];
  for (const span of spans) {
    if (span.text === "") continue;
    const last = out[out.length - 1];
    if (last && sameMarks(last, span)) {
      last.text += span.text;
    } else {
      out.push({ ...span });
    }
  }
  return out;
}

// Extract inline children from a list item, ignoring any nested sub-lists
// (the flat model does not represent nesting).
function listItemChildren(item: Tokens.ListItem): BlockText[] {
  const spans: BlockText[] = [];
  for (const token of item.tokens ?? []) {
    if (token.type === "text" || token.type === "paragraph") {
      spans.push(...walkInline(token.tokens, {}));
    }
  }
  return mergeAdjacent(spans);
}

function blockquoteChildren(token: Tokens.Blockquote): BlockText[] {
  const spans: BlockText[] = [];
  for (const child of token.tokens ?? []) {
    if (child.type === "paragraph" || child.type === "text") {
      if (spans.length > 0) spans.push({ text: "\n" });
      spans.push(...walkInline(child.tokens, {}));
    }
  }
  return mergeAdjacent(spans);
}

function tableCellSpans(cell: Tokens.TableCell): BlockText[] {
  return walkInline(cell.tokens, {});
}

export function markdownToBlocks(markdown: string): MarkdownBlock[] {
  const source = String(markdown ?? "");
  if (!source.trim()) return [];
  const tokens = new Lexer(LEXER_OPTIONS).lex(source);
  const blocks: MarkdownBlock[] = [];
  for (const token of tokens) {
    switch (token.type) {
      case "heading": {
        const level = token.depth as 1 | 2 | 3 | 4 | 5 | 6;
        blocks.push({ type: "heading", level, children: walkInline(token.tokens, {}) });
        break;
      }
      case "paragraph":
        blocks.push({ type: "paragraph", children: walkInline(token.tokens, {}) });
        break;
      case "code":
        blocks.push({ type: "code", lang: token.lang ?? "", code: token.text ?? "" });
        break;
      case "blockquote":
        blocks.push({
          type: "blockquote",
          children: blockquoteChildren(token as Tokens.Blockquote),
        });
        break;
      case "table": {
        const t = token as Tokens.Table;
        blocks.push({
          type: "table",
          headers: (t.header ?? []).map(tableCellSpans),
          rows: (t.rows ?? []).map((row: Tokens.TableCell[]) => row.map(tableCellSpans)),
        });
        break;
      }
      case "list": {
        const list = token as Tokens.List;
        if (list.ordered) {
          blocks.push({
            type: "orderedList",
            items: (list.items ?? []).map(listItemChildren),
          });
        } else {
          // Unordered lists can mix plain bullets and GFM task items. Emit
          // contiguous plain items as a bullet list and each task item as its
          // own todo block so the two kinds do not merge back into one list on
          // round-trip (a `- text`/`- [ ] text` boundary keeps them apart).
          let plain: BlockText[][] = [];
          const flushPlain = () => {
            if (plain.length > 0) {
              blocks.push({ type: "bulletList", items: plain });
              plain = [];
            }
          };
          for (const item of list.items ?? []) {
            if (item.task) {
              flushPlain();
              blocks.push({
                type: "todo",
                checked: !!item.checked,
                children: listItemChildren(item),
              });
            } else {
              plain.push(listItemChildren(item));
            }
          }
          flushPlain();
        }
        break;
      }
      default:
        // space, hr, html blocks, etc. are not represented in the minimal model.
        break;
    }
  }
  return blocks;
}

function escapePlainText(text: string): string {
  // Escape characters that would otherwise form emphasis/code spans. A span
  // whose text is itself a complete markdown link (produced by parse) is
  // passed through verbatim so URLs survive.
  if (/^\[.+\]\(.+\)$/.test(text)) return text;
  return text.replace(/\\/g, "\\\\").replace(/([*_`])/g, "\\$1");
}

function inlineToMarkdown(children: readonly BlockText[]): string {
  return children
    .map((span) => {
      let text: string;
      if (span.code) {
        // Use a longer fence when the code text itself contains backticks.
        if (span.text.includes("`")) {
          text = "`` " + span.text + " ``";
        } else {
          text = "`" + span.text + "`";
        }
      } else {
        text = escapePlainText(span.text);
      }
      if (span.bold) text = `**${text}**`;
      if (span.italic) text = `*${text}*`;
      return text;
    })
    .join("");
}

function blockToMarkdown(block: MarkdownBlock): string {
  switch (block.type) {
    case "heading":
      return `${"#".repeat(block.level)} ${inlineToMarkdown(block.children)}`;
    case "paragraph":
      return inlineToMarkdown(block.children);
    case "bulletList":
      return block.items.map((item) => `- ${inlineToMarkdown(item)}`).join("\n");
    case "orderedList":
      return block.items.map((item, i) => `${i + 1}. ${inlineToMarkdown(item)}`).join("\n");
    case "todo":
      return `- [${block.checked ? "x" : " "}] ${inlineToMarkdown(block.children)}`;
    case "blockquote": {
      const inner = inlineToMarkdown(block.children);
      return inner
        .split("\n")
        .map((line) => `> ${line}`)
        .join("\n");
    }
    case "code":
      return "```" + block.lang + "\n" + block.code + "\n```";
    case "table": {
      const header = `| ${block.headers.map((cell) => inlineToMarkdown(cell)).join(" | ")} |`;
      const separator = `| ${block.headers.map(() => "---").join(" | ")} |`;
      const rows = block.rows.map(
        (row) => `| ${row.map((cell) => inlineToMarkdown(cell)).join(" | ")} |`,
      );
      return [header, separator, ...rows].join("\n");
    }
  }
}

export function blocksToMarkdown(blocks: readonly MarkdownBlock[]): string {
  return blocks.map(blockToMarkdown).join("\n\n");
}
