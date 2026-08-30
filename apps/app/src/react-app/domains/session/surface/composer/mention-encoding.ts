/**
 * Percent-encode a mention value so it can be embedded in the draft as a single `@token` with no spaces.
 * @param value The raw mention value to encode.
 */
export function encodeComposerMentionValue(value: string) {
  return value.replaceAll("%", "%25").replaceAll(" ", "%20");
}

/**
 * Recover the original mention value from its encoded form. Preserves literal `%20` sequences in the original.
 * @param value The encoded mention value to decode.
 */
export function decodeComposerMentionValue(value: string) {
  return value.replaceAll("%20", " ").replaceAll("%25", "%");
}

/** File chips show the last two path segments so `uploads/foo.mp4` is not `@foo.mp4`. */
export function formatComposerFileMentionLabel(value: string) {
  const parts = value.split(/[\\/]/).filter(Boolean);
  if (parts.length >= 2) return parts.slice(-2).join("/");
  return parts[0] || value;
}
