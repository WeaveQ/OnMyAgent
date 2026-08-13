/**
 * Write-time expert packageName. New origin/marker rows must persist the
 * short marketplace name, never the composite agent id (`ns:pkg`).
 */

export function normalizeExpertWritePackageName(input: {
  agentId: string;
  packageName?: string | null;
  marketplacePackageName?: string | null;
}): string {
  const agentId = input.agentId.trim();
  const marketplacePackageName = trimName(input.marketplacePackageName);
  const packageName = trimName(input.packageName);
  const preferred =
    pickIfNotAgentId(marketplacePackageName, agentId) ??
    pickIfNotAgentId(packageName, agentId);
  const chosen = preferred ?? marketplacePackageName ?? packageName ?? agentId;
  if (chosen === agentId && agentId.includes(":")) {
    return coerceCompositePackageName(agentId);
  }
  return chosen;
}

function trimName(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  return trimmed ? trimmed : null;
}

function pickIfNotAgentId(
  value: string | null,
  agentId: string,
): string | null {
  if (!value || value === agentId) return null;
  return value;
}

function coerceCompositePackageName(value: string): string {
  const parts = value.split(":").filter(Boolean);
  if (parts.length >= 2 && parts[0] === parts[parts.length - 1]) {
    return parts[0]!;
  }
  return parts[parts.length - 1] || value;
}
