const WORKSPACE_SWATCHES = ["#2563eb", "#5a67d8", "#f97316", "#10b981"];

export function workspaceSwatchColor(seed: string) {
  const value = seed.trim() || "workspace";
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash << 5) - hash + value.charCodeAt(index);
    hash |= 0;
  }
  return WORKSPACE_SWATCHES[Math.abs(hash) % WORKSPACE_SWATCHES.length];
}
