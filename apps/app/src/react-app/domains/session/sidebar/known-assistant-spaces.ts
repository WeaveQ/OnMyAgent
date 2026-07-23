/**
 * Selectable spaces for the composer workspace picker.
 *
 * Source of truth is the left-sidebar Spaces section: only directories that
 * already have session bindings (non-automation). Recent/local picks must NOT
 * appear in the picker until they show up under Spaces.
 */
import { workspaceDisplayName } from "../../local-agents";

export type KnownSpaceSessionBinding = {
  sessionId: string;
  directory: string;
};

export type KnownSpaceAutomationRecord = {
  sessionId: string;
  outputDirectory: string;
};

/** Legacy automation folder prefix (CJK product label via unicode escapes). */
const LEGACY_AUTOMATION_DIR_PREFIX = "\u81EA\u52A8\u5316\u4EFB\u52A1-";

export function isAssistantAutomationDirectory(
  path: string,
  automationDirs: ReadonlySet<string>,
): boolean {
  const next = path.trim();
  if (!next || automationDirs.has(next)) return true;
  const base = workspaceDisplayName(next);
  return (
    base.startsWith(LEGACY_AUTOMATION_DIR_PREFIX) ||
    /^automation[-_]/i.test(base)
  );
}

/**
 * Directories selectable in the composer picker = left-sidebar space folders.
 * Built only from session→directory bindings (excluding automation sessions/dirs).
 * Does not include recent-workspace LRU picks.
 */
export function listSelectableAssistantSpaceDirectories(input: {
  sessionBindings: readonly KnownSpaceSessionBinding[];
  automationRecords: readonly KnownSpaceAutomationRecord[];
}): string[] {
  const automationSessionIds = new Set(
    input.automationRecords
      .map((record) => record.sessionId.trim())
      .filter(Boolean),
  );
  const automationDirs = new Set(
    input.automationRecords
      .map((record) => record.outputDirectory.trim())
      .filter(Boolean),
  );

  const seen = new Set<string>();
  const out: string[] = [];
  for (const record of input.sessionBindings) {
    if (automationSessionIds.has(record.sessionId.trim())) continue;
    const next = record.directory.trim();
    if (
      !next ||
      seen.has(next) ||
      isAssistantAutomationDirectory(next, automationDirs)
    ) {
      continue;
    }
    seen.add(next);
    out.push(next);
  }
  return out;
}
