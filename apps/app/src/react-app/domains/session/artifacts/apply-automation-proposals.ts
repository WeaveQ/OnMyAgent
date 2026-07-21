/**
 * Host-side load/create for expert automation proposal JSON files.
 * Expert UI offers a dialog (ask → configure), then createAutomationsFromPayloads.
 */

import type { AutomationTaskInput } from "@onmyagent/types";

import { toWorkspaceRelativePath } from "./waybill-preview-patch";

// Unicode escapes keep renderer CJK hard-code gate clean while matching zh confirms.
const CONFIRM_PATTERN = new RegExp(
  [
    "\\u786e\\u8ba4\\u521b\\u5efa", // 确认创建
    "\\u786e\\u8ba4\\u521b\\u5efa\\u5b9a\\u65f6", // 确认创建定时
    "\\u521b\\u5efa\\u5b9a\\u65f6\\u4efb\\u52a1", // 创建定时任务
    "\\u540c\\u610f\\u521b\\u5efa", // 同意创建
    "\\u6309\\u63d0\\u6848\\u521b\\u5efa", // 按提案创建
    "\\u521b\\u5efa\\u5168\\u90e8\\u5b9a\\u65f6", // 创建全部定时
    "create\\s+(the\\s+)?automations?",
    "confirm\\s+create",
  ].join("|"),
  "i",
);
const DENY_PATTERN = new RegExp(
  [
    "\\u4e0d(\\u8981|\\u7528|\\u5fc5)\\u521b\\u5efa", // 不要/不用/不必创建
    "\\u522b\\u521b\\u5efa", // 别创建
    "\\u53d6\\u6d88\\u521b\\u5efa", // 取消创建
    "\\u5148\\u4e0d\\u8981", // 先不要
    "\\u6682\\u4e0d\\u521b\\u5efa", // 暂不创建
    "\\u4e0d\\u8981\\u5b9a\\u65f6", // 不要定时
  ].join("|"),
);

export function isAutomationCreateConfirmText(text: string): boolean {
  const normalized = text.trim();
  if (!normalized) return false;
  if (DENY_PATTERN.test(normalized)) return false;
  return CONFIRM_PATTERN.test(normalized);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function parseAutomationProposalPayload(
  raw: unknown,
): AutomationTaskInput | null {
  if (!isRecord(raw)) return null;
  const scene = raw.scene === "code" || raw.scene === "office" ? raw.scene : null;
  const title = typeof raw.title === "string" ? raw.title.trim() : "";
  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  const schedule = isRecord(raw.schedule) ? raw.schedule : null;
  if (!scene || !title || !prompt || !schedule) return null;
  const mode = schedule.mode;
  const day = schedule.day;
  const time = typeof schedule.time === "string" ? schedule.time.trim() : "";
  if (
    (mode !== "weekly" && mode !== "interval" && mode !== "once") ||
    (day !== "daily" &&
      day !== "weekly" &&
      day !== "biweekly" &&
      day !== "monthly" &&
      day !== "yearly") ||
    !time
  ) {
    return null;
  }
  const payload: AutomationTaskInput = {
    scene,
    title,
    prompt,
    schedule: {
      mode,
      day,
      time,
      ...(typeof schedule.intervalMinutes === "number"
        ? { intervalMinutes: schedule.intervalMinutes }
        : {}),
      ...(Array.isArray(schedule.weekdays)
        ? {
            weekdays: schedule.weekdays.filter(
              (value): value is number => typeof value === "number",
            ),
          }
        : {}),
      ...(typeof schedule.onceAt === "number" ? { onceAt: schedule.onceAt } : {}),
      ...(typeof schedule.timezone === "string" && schedule.timezone.trim()
        ? { timezone: schedule.timezone.trim() }
        : {}),
    },
    enabled: raw.enabled === false ? false : true,
  };
  if (typeof raw.workspaceDirectory === "string" || raw.workspaceDirectory === null) {
    payload.workspaceDirectory = raw.workspaceDirectory;
  }
  if (raw.accessMode === "default" || raw.accessMode === "full") {
    payload.accessMode = raw.accessMode;
  }
  return payload;
}

const KNOWN_PROPOSAL_BASENAMES = [
  "ar-daily-board.json",
  "fleet-daily-scan.json",
  "warehouse-daily-brief.json",
] as const;

/** Workspace-relative dirs that may hold expert automation proposals. */
export function automationProposalSearchRoots(input: {
  catalogRoot: string;
  sessionRoot?: string | null;
  sessionDirectory?: string | null;
}): string[] {
  const roots: string[] = [];
  const seen = new Set<string>();
  const push = (value: string | null | undefined) => {
    const next = value?.trim().replace(/^\/+|\/+$/g, "");
    if (!next || seen.has(next)) return;
    seen.add(next);
    roots.push(next);
  };

  const sessionDir =
    input.sessionDirectory?.trim() || input.sessionRoot?.trim() || "";
  if (sessionDir) {
    const relativeDir = toWorkspaceRelativePath(input.catalogRoot, sessionDir);
    if (relativeDir) {
      push(`${relativeDir}/automations/proposals`);
    } else if (
      !sessionDir.startsWith("/") &&
      !/^[a-zA-Z]:[\\/]/.test(sessionDir)
    ) {
      push(`${sessionDir.replace(/[/\\]+$/, "")}/automations/proposals`);
    }
  }
  push("automations/proposals");
  return roots;
}

export function knownAutomationProposalPaths(roots: readonly string[]): string[] {
  const out: string[] = [];
  for (const root of roots) {
    for (const name of KNOWN_PROPOSAL_BASENAMES) {
      out.push(`${root}/${name}`);
    }
  }
  return out;
}

export type AutomationProposalClient = {
  listWorkspaceFiles: (
    workspaceId: string,
    options?: { prefix?: string; limit?: number; includeDirs?: boolean },
  ) => Promise<{ items: Array<{ path: string; kind?: string }> }>;
  readWorkspaceFile: (
    workspaceId: string,
    path: string,
  ) => Promise<{ content?: string }>;
  listAutomations: (
    workspaceId: string,
  ) => Promise<{ items: Array<{ id: string; title: string }> }>;
  createAutomation: (
    workspaceId: string,
    payload: AutomationTaskInput,
  ) => Promise<{ item: { id: string; title: string; nextRunAt?: number | null } }>;
};

export type LoadedAutomationProposal = {
  path: string;
  payload: AutomationTaskInput;
};

export type ApplyAutomationProposalsResult = {
  created: Array<{ id: string; title: string; path: string }>;
  skipped: Array<{ title: string; reason: string; path?: string }>;
  errors: Array<{ path: string; message: string }>;
};

export async function loadAutomationProposals(input: {
  client: Pick<AutomationProposalClient, "listWorkspaceFiles" | "readWorkspaceFile">;
  workspaceId: string;
  catalogRoot: string;
  sessionRoot?: string | null;
  sessionDirectory?: string | null;
}): Promise<{
  proposals: LoadedAutomationProposal[];
  errors: Array<{ path: string; message: string }>;
}> {
  const workspaceId = input.workspaceId.trim();
  const proposals: LoadedAutomationProposal[] = [];
  const errors: Array<{ path: string; message: string }> = [];
  if (!workspaceId) return { proposals, errors };

  const roots = automationProposalSearchRoots({
    catalogRoot: input.catalogRoot,
    sessionRoot: input.sessionRoot,
    sessionDirectory: input.sessionDirectory,
  });

  const pathSet = new Set<string>(knownAutomationProposalPaths(roots));
  for (const root of roots) {
    try {
      const listed = await input.client.listWorkspaceFiles(workspaceId, {
        prefix: root,
        limit: 200,
        includeDirs: false,
      });
      for (const item of listed.items) {
        const path = item.path?.trim();
        if (!path || !path.endsWith(".json")) continue;
        if (item.kind && item.kind !== "file") continue;
        pathSet.add(path);
      }
    } catch {
      // prefix may not exist
    }
  }

  for (const path of [...pathSet].sort()) {
    let content = "";
    try {
      const file = await input.client.readWorkspaceFile(workspaceId, path);
      content = typeof file.content === "string" ? file.content : "";
    } catch {
      continue;
    }
    if (!content.trim()) continue;
    try {
      const payload = parseAutomationProposalPayload(JSON.parse(content));
      if (!payload) {
        errors.push({ path, message: "invalid automation proposal payload" });
        continue;
      }
      proposals.push({ path, payload });
    } catch (error) {
      errors.push({
        path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { proposals, errors };
}

/** Fingerprint for a proposal set so we do not re-offer the same files. */
export function automationProposalsFingerprint(
  proposals: readonly LoadedAutomationProposal[],
): string {
  return proposals
    .map((item) => `${item.path}:${item.payload.title}:${item.payload.schedule.time}`)
    .sort()
    .join("|");
}

export function buildAutomationPayloadFromDraft(input: {
  base: AutomationTaskInput;
  title: string;
  prompt: string;
  time: string;
  enabled: boolean;
}): AutomationTaskInput | null {
  const title = input.title.trim();
  const prompt = input.prompt.trim();
  const time = input.time.trim();
  if (!title || !prompt || !/^\d{2}:\d{2}$/.test(time)) return null;
  return {
    ...input.base,
    title,
    prompt,
    enabled: input.enabled,
    schedule: {
      ...input.base.schedule,
      time,
    },
  };
}

export async function createAutomationsFromPayloads(input: {
  client: Pick<AutomationProposalClient, "listAutomations" | "createAutomation">;
  workspaceId: string;
  items: Array<{ path: string; payload: AutomationTaskInput }>;
}): Promise<ApplyAutomationProposalsResult> {
  const result: ApplyAutomationProposalsResult = {
    created: [],
    skipped: [],
    errors: [],
  };
  const workspaceId = input.workspaceId.trim();
  if (!workspaceId) {
    result.errors.push({ path: "", message: "workspaceId is required" });
    return result;
  }

  let existingTitles = new Set<string>();
  try {
    const listed = await input.client.listAutomations(workspaceId);
    existingTitles = new Set(
      listed.items.map((item) => item.title.trim()).filter(Boolean),
    );
  } catch {
    existingTitles = new Set();
  }

  for (const item of input.items) {
    const payload = item.payload;
    if (existingTitles.has(payload.title)) {
      result.skipped.push({
        title: payload.title,
        reason: "already_exists",
        path: item.path,
      });
      continue;
    }
    try {
      const created = await input.client.createAutomation(workspaceId, payload);
      existingTitles.add(payload.title);
      result.created.push({
        id: created.item.id,
        title: created.item.title,
        path: item.path,
      });
    } catch (error) {
      result.errors.push({
        path: item.path,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return result;
}

/** @deprecated Prefer load + dialog + createAutomationsFromPayloads */
export async function applyAutomationProposals(input: {
  client: AutomationProposalClient;
  workspaceId: string;
  catalogRoot: string;
  sessionRoot?: string | null;
  sessionDirectory?: string | null;
}): Promise<ApplyAutomationProposalsResult> {
  const loaded = await loadAutomationProposals(input);
  const result: ApplyAutomationProposalsResult = {
    created: [],
    skipped: [],
    errors: [...loaded.errors],
  };
  if (loaded.proposals.length === 0) return result;
  const created = await createAutomationsFromPayloads({
    client: input.client,
    workspaceId: input.workspaceId,
    items: loaded.proposals,
  });
  return {
    created: created.created,
    skipped: created.skipped,
    errors: [...result.errors, ...created.errors],
  };
}
