/**
 * Heavy markdown post-processing (Shiki, Mermaid diagram bind, KaTeX) must
 * not re-run on every streaming token flush. Cheap sync HTML still updates;
 * enhance once the stream idles.
 */
export function shouldRunMarkdownHeavyEnhance(
  streaming: boolean | undefined,
): boolean {
  return streaming !== true;
}
