import { splitMarkdownFrontmatter } from "./knowledge-vault-frontmatter";

/** Body shown in the live Markdown preview (frontmatter stripped). */
export function knowledgePreviewBody(markdown: string): string {
  return splitMarkdownFrontmatter(String(markdown ?? "")).body;
}
