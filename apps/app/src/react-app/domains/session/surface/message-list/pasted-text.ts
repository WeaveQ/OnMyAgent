export const PASTE_TOKEN_RE = /(\[pasted text [^\]]+\])/;
export const PASTE_TOKEN_EXACT_RE = /^\[pasted text (.+)\]$/;

export function resolveDisplayedPastedText(
  text: string,
  pastedTextMap?: Map<string, string>,
) {
  if (!pastedTextMap?.size || !PASTE_TOKEN_RE.test(text)) return text;
  return text
    .split(PASTE_TOKEN_RE)
    .map((segment) => {
      const match = segment.match(PASTE_TOKEN_EXACT_RE);
      if (!match?.[1]) return segment;
      return pastedTextMap.get(match[1]) ?? segment;
    })
    .join("");
}
