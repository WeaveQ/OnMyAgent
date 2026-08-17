import type {
  ExpertDirectoryRecord,
  ExpertDirectorySession,
} from "@onmyagent/types/server";

export const EXPERT_MISSING_SKILLS_DISMISS_KEY =
  "onmyagent:expert-missing-skills-dismissed";

export function missingSkillsFingerprint(
  workspaceId: string,
  agentId: string,
  skills: readonly string[],
): string {
  const workspace = workspaceId.trim();
  const agent = agentId.trim();
  const list = [...new Set(skills.map((skill) => skill.trim()).filter(Boolean))].sort();
  return `${workspace}\u0000${agent}\u0000${list.join(",")}`;
}

function readDismissedSet(storage: Pick<Storage, "getItem"> | null | undefined): Set<string> {
  if (!storage) return new Set();
  try {
    const raw = storage.getItem(EXPERT_MISSING_SKILLS_DISMISS_KEY);
    if (!raw) return new Set();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return new Set();
    return new Set(
      parsed.filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    );
  } catch {
    return new Set();
  }
}

export function isExpertMissingSkillsNoticeDismissed(input: {
  workspaceId: string;
  agentId: string;
  skills: readonly string[];
  storage?: Pick<Storage, "getItem"> | null;
}): boolean {
  if (!input.workspaceId.trim() || !input.agentId.trim()) return false;
  const key = missingSkillsFingerprint(input.workspaceId, input.agentId, input.skills);
  return readDismissedSet(
    input.storage ?? (typeof localStorage === "undefined" ? null : localStorage),
  ).has(key);
}

export function dismissExpertMissingSkillsNotice(input: {
  workspaceId: string;
  agentId: string;
  skills: readonly string[];
  storage?: Pick<Storage, "getItem" | "setItem"> | null;
}): void {
  const storage = input.storage ?? (typeof localStorage === "undefined" ? null : localStorage);
  if (!storage) return;
  const key = missingSkillsFingerprint(input.workspaceId, input.agentId, input.skills);
  if (!input.workspaceId.trim() || !input.agentId.trim()) return;
  const next = readDismissedSet(storage);
  next.add(key);
  try {
    storage.setItem(EXPERT_MISSING_SKILLS_DISMISS_KEY, JSON.stringify([...next]));
  } catch {
    // Quota / private mode — notice can still be dismissed for this mount.
  }
}

export function selectExpertMissingSkillRepairTargets(
  record: Pick<ExpertDirectoryRecord, "sessions" | "runtimeDirectories"> | null | undefined,
): Array<{ sessionId: string; directory: string }> {
  if (!record) return [];
  const fromSessions = (record.sessions ?? []).flatMap((session: ExpertDirectorySession) => {
    const directory = session.directory?.trim() ?? "";
    const sessionId = session.sessionId?.trim() ?? "";
    if (!directory || !sessionId) return [];
    if ((session.missingSkills?.length ?? 0) === 0) return [];
    return [{ sessionId, directory }];
  });
  if (fromSessions.length > 0) return fromSessions;
  return (record.runtimeDirectories ?? []).flatMap((directory, index) => {
    const path = directory.trim();
    if (!path) return [];
    return [{ sessionId: record.sessions?.[index]?.sessionId?.trim() || `session-${index}`, directory: path }];
  });
}

export type ExpertDirectoryRepairRecord = Pick<
  ExpertDirectoryRecord,
  "sessions" | "runtimeDirectories" | "packageName" | "declaredSkills" | "missingSkills" | "agentId"
>;

export function selectExpertDirectoryRecord<T extends { agentId: string }>(
  records: readonly T[] | null | undefined,
  agentId: string | null | undefined,
): T | null {
  const id = agentId?.trim() ?? "";
  if (!id || !records) return null;
  return records.find((record) => record.agentId === id) ?? null;
}

export function packageNameForExpertRepair(
  agentId: string,
  packageName?: string | null,
): string {
  const fromPackage = packageName?.trim() ?? "";
  if (fromPackage) return fromPackage;
  const id = agentId.trim();
  if (!id) return "";
  return id.includes(":") ? id.slice(0, id.indexOf(":")) : id;
}

export type ExpertMissingSkillsRepairClient = {
  ensureExpertSessionIsolation: (
    workspaceId: string,
    payload: {
      directory: string;
      agentId?: string;
      packageName?: string;
      sessionId?: string;
      skillNames?: string[];
    },
  ) => Promise<{ missingSkills?: string[] }>;
  getExpertDirectory: (workspaceId: string) => Promise<{
    records: ExpertDirectoryRepairRecord[];
  }>;
};

function normalizeSkillList(skills: readonly string[] | null | undefined): string[] {
  return [...new Set((skills ?? []).map((skill) => skill.trim()).filter(Boolean))].sort();
}

export async function repairExpertMissingSkills(input: {
  client: ExpertMissingSkillsRepairClient;
  workspaceId: string;
  agentId: string;
  packageName?: string;
  skillNames?: readonly string[];
  record?: Pick<
    ExpertDirectoryRecord,
    "sessions" | "runtimeDirectories" | "packageName" | "declaredSkills" | "missingSkills"
  > | null;
}): Promise<{ remaining: string[] }> {
  const workspaceId = input.workspaceId.trim();
  const agentId = input.agentId.trim();
  if (!workspaceId || !agentId) return { remaining: normalizeSkillList(input.skillNames) };

  let record: ExpertDirectoryRepairRecord | null = input.record
    ? { agentId, ...input.record }
    : null;
  let targets = selectExpertMissingSkillRepairTargets(record);
  if (targets.length === 0) {
    const directory = await input.client.getExpertDirectory(workspaceId);
    record = selectExpertDirectoryRecord(directory.records, agentId);
    targets = selectExpertMissingSkillRepairTargets(record);
  }
  if (targets.length === 0) {
    return { remaining: normalizeSkillList(record?.missingSkills ?? input.skillNames) };
  }

  const packageName = packageNameForExpertRepair(agentId, input.packageName ?? record?.packageName);
  const skillNames = normalizeSkillList(record?.declaredSkills ?? input.skillNames);
  for (const target of targets) {
    await input.client.ensureExpertSessionIsolation(workspaceId, {
      directory: target.directory,
      agentId,
      ...(packageName ? { packageName } : {}),
      sessionId: target.sessionId,
      ...(skillNames.length ? { skillNames } : {}),
    });
  }
  const next = await input.client.getExpertDirectory(workspaceId);
  const remaining = selectExpertDirectoryRecord(next.records, agentId)?.missingSkills ?? [];
  return { remaining: normalizeSkillList(remaining) };
}
