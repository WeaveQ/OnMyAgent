import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";

import { globalSkillsDir } from "../workspace/workspace-files.js";
import {
  copySafePackageTree,
  fingerprintSafePackageTree,
  isRecord,
  isSafePackageSegment,
  normalizePackageRelativePath,
  packagePath,
  pathExists,
  readJsonRecord,
  resolveSafePackagePath,
  replaceDirectoriesAtomically,
  type DirectoryReplacement,
} from "./workbuddy-expert-files.js";
import {
  createImportTransactionPreview,
  executeImportTransaction,
  ImportTransactionError,
  type ImportTransactionPreview,
} from "./import-transaction.js";
import {
  appendTeamWorkflowPrompt,
  compileTeamWorkflow,
  type TeamWorkflow,
} from "./workbuddy-team-workflow.js";

const WORKBUDDY_MANIFEST = join(".codebuddy-plugin", "plugin.json");
const ONMYAGENT_MANIFEST = join(".expert-plugin", "plugin.json");
const IMPORT_MARKER = ".onmyagent-workbuddy-import.json";

export type WorkBuddyExpertType = "agent" | "team";

export type WorkBuddyPackageSummary = {
  packageName: string;
  displayName: string;
  profession: string;
  description: string;
  version: string | null;
  expertType: WorkBuddyExpertType;
  leadAgentName: string;
  agents: string[];
  members: number;
  skills: string[];
  warnings: string[];
};

export type WorkBuddyImportResult = {
  ok: true;
  dryRun: boolean;
  action: "added" | "updated" | "would-add" | "would-update";
  package: WorkBuddyPackageSummary;
  destination: string;
  installedSkills: string[];
  skippedFiles: string[];
  warnings: string[];
};

export type WorkBuddyImportPreviewResult = {
  ok: true;
  dryRun: true;
  action: "would-add" | "would-update";
  package: WorkBuddyPackageSummary;
  destination: string;
  destinations: string[];
  installedSkills: string[];
  conflicts: string[];
  committable: boolean;
  confirmationToken: string;
  warnings: string[];
};

type PreparedPackage = {
  summary: WorkBuddyPackageSummary;
  sourceDir: string;
  normalizedManifest: Record<string, unknown>;
  skillRefs: Array<{ name: string; relativePath: string; hasSkillMarkdown: boolean }>;
  matchNames: string[];
  leadAgentRelativePath: string;
  compiledLeadMarkdown: string;
  teamWorkflow?: TeamWorkflow;
};

type ImportRoots = {
  sourceRoot: string;
  expertsRoot: string;
  skillsRoot: string;
};

type PreparedImportPlan = {
  roots: ImportRoots;
  prepared: PreparedPackage;
  destination: string;
  installedSkills: string[];
  transaction: ImportTransactionPreview<WorkBuddyPackageSummary>;
};

type ImportDestinationState = {
  destination: string;
  state: "missing" | "owned" | "foreign";
};

export class WorkBuddyImportError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "WorkBuddyImportError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

export function resolveWorkBuddyImportRoots(): ImportRoots {
  const skillsRoot = process.env.OPENCODE_GLOBAL_SKILLS_DIR?.trim() || globalSkillsDir();
  const sourceRoot = process.env.ONMYAGENT_WORKBUDDY_EXPERTS_DIR?.trim()
    || join(homedir(), ".workbuddy", "plugins", "marketplaces", "experts", "plugins");
  const expertsRoot = process.env.ONMYAGENT_EXPERTS_DIR?.trim()
    || join(dirname(skillsRoot), "experts", "installed");
  return { sourceRoot, expertsRoot, skillsRoot };
}

export async function listWorkBuddyExpertPackages(
  options: { kind?: WorkBuddyExpertType; roots?: ImportRoots } = {},
): Promise<WorkBuddyPackageSummary[]> {
  const prepared = await loadPreparedPackages(options.roots ?? resolveWorkBuddyImportRoots());
  return prepared
    .filter((item) => !options.kind || item.summary.expertType === options.kind)
    .map((item) => item.summary);
}

export async function inspectWorkBuddyExpertPackage(input: {
  query: string;
  kind?: WorkBuddyExpertType;
  roots?: ImportRoots;
}): Promise<WorkBuddyPackageSummary> {
  const prepared = await selectPreparedPackage(input.query, input.kind, input.roots);
  return prepared.summary;
}

export async function importWorkBuddyExpertPackage(input: {
  query: string;
  kind?: WorkBuddyExpertType;
  dryRun?: boolean;
  confirmationToken?: string;
  requireConfirmation?: boolean;
  roots?: ImportRoots;
}): Promise<WorkBuddyImportResult> {
  const plan = await prepareWorkBuddyImportPlan(input);
  const { roots, prepared, destination, installedSkills, transaction } = plan;
  const updating = transaction.action === "update";
  if (input.dryRun === true) {
    return {
      ok: true,
      dryRun: true,
      action: updating ? "would-update" : "would-add",
      package: prepared.summary,
      destination,
      installedSkills,
      skippedFiles: [],
      warnings: prepared.summary.warnings,
    };
  }

  if (!input.requireConfirmation) {
    assertWorkBuddyPlanCommittable(transaction);
  }
  const committed = await executeImportTransaction({
    preview: transaction,
    confirmationToken: input.requireConfirmation
      ? input.confirmationToken
      : transaction.confirmationToken,
    stage: () => stageWorkBuddyImport(plan),
    verifyStaged: (staged) => verifyStagedWorkBuddyImport(plan, staged),
    commit: async (staged) => {
      await replaceDirectoriesAtomically(
        staged.replacements,
        () => verifyCommittedWorkBuddyImport(plan),
      );
      return staged;
    },
    verifyCommitted: async () => verifyCommittedWorkBuddyImport(plan),
    cleanup: cleanupStagedWorkBuddyImport,
  }).catch((error: unknown) => {
    if (error instanceof ImportTransactionError) throw toWorkBuddyTransactionError(error);
    throw error;
  });

  return {
    ok: true,
    dryRun: false,
    action: updating ? "updated" : "added",
    package: prepared.summary,
    destination,
    installedSkills,
    skippedFiles: [...new Set(committed.skippedFiles)].sort(),
    warnings: prepared.summary.warnings,
  };
}

export async function previewWorkBuddyExpertImport(input: {
  query: string;
  kind?: WorkBuddyExpertType;
  roots?: ImportRoots;
}): Promise<WorkBuddyImportPreviewResult> {
  const plan = await prepareWorkBuddyImportPlan(input);
  const { transaction, destination, installedSkills, prepared } = plan;
  return {
    ok: true,
    dryRun: true,
    action: transaction.action === "update" ? "would-update" : "would-add",
    package: prepared.summary,
    destination,
    destinations: transaction.destinations,
    installedSkills,
    conflicts: transaction.conflicts,
    committable: transaction.committable,
    confirmationToken: transaction.confirmationToken,
    warnings: transaction.warnings,
  };
}

async function prepareWorkBuddyImportPlan(input: {
  query: string;
  kind?: WorkBuddyExpertType;
  roots?: ImportRoots;
}): Promise<PreparedImportPlan> {
  const roots = input.roots ?? resolveWorkBuddyImportRoots();
  const prepared = await selectPreparedPackage(input.query, input.kind, roots);
  const destination = join(roots.expertsRoot, prepared.summary.packageName);
  const installedSkills = prepared.skillRefs
    .filter((skill) => skill.hasSkillMarkdown)
    .map((skill) => skill.name);
  const destinationState = await ownershipState(destination, prepared.summary.packageName);
  const skillStates = await Promise.all(
    installedSkills.map(async (skillName) => ({
      skillName,
      destination: join(roots.skillsRoot, skillName),
      state: await ownershipState(join(roots.skillsRoot, skillName), prepared.summary.packageName),
    })),
  );
  const conflicts = [
    ...(destinationState === "foreign" ? [destination] : []),
    ...skillStates
      .filter((item) => item.state === "foreign")
      .map((item) => join(roots.skillsRoot, item.skillName)),
  ];
  const sourceFingerprint = await fingerprintPreparedSource(prepared);
  const targetFingerprint = await fingerprintImportDestinations([
    { destination, state: destinationState },
    ...skillStates.map(({ destination: skillDestination, state }) => ({
      destination: skillDestination,
      state,
    })),
  ]);
  const destinations = [
    destination,
    ...installedSkills.map((skillName) => join(roots.skillsRoot, skillName)),
  ];
  const transaction = createImportTransactionPreview({
    adapter: "workbuddy-expert",
    sourceId: prepared.summary.packageName,
    sourceFingerprint,
    targetFingerprint,
    action: destinationState === "owned" ? "update" : "add",
    destinations,
    conflicts,
    warnings: prepared.summary.warnings,
    summary: prepared.summary,
  });
  return { roots, prepared, destination, installedSkills, transaction };
}

type StagedWorkBuddyImport = {
  replacements: DirectoryReplacement[];
  stagedPaths: string[];
  skippedFiles: string[];
};

async function stageWorkBuddyImport(plan: PreparedImportPlan): Promise<StagedWorkBuddyImport> {
  const { roots, prepared, destination } = plan;
  await mkdir(roots.expertsRoot, { recursive: true });
  await mkdir(roots.skillsRoot, { recursive: true });
  const expertStaging = join(
    roots.expertsRoot,
    `.getworkbuddy-${prepared.summary.packageName}-${randomUUID()}`,
  );
  const stagedPaths = [expertStaging];
  const replacements: DirectoryReplacement[] = [];
  const skippedFiles: string[] = [];
  try {
    skippedFiles.push(...(await copySafePackageTree(prepared.sourceDir, expertStaging)));
    await mkdir(join(expertStaging, ".expert-plugin"), { recursive: true });
    await writeFile(
      join(expertStaging, ONMYAGENT_MANIFEST),
      `${JSON.stringify(prepared.normalizedManifest, null, 2)}\n`,
      "utf8",
    );
    await writeFile(
      packagePath(expertStaging, prepared.leadAgentRelativePath),
      prepared.compiledLeadMarkdown,
      "utf8",
    );
    await writeImportMarker(expertStaging, prepared, "expert");
    replacements.push({ staging: expertStaging, destination });

    for (const skill of prepared.skillRefs.filter((item) => item.hasSkillMarkdown)) {
      const staging = join(roots.skillsRoot, `.getworkbuddy-${skill.name}-${randomUUID()}`);
      stagedPaths.push(staging);
      skippedFiles.push(
        ...(await copySafePackageTree(
          packagePath(expertStaging, skill.relativePath),
          staging,
        )).map((item) => `${skill.relativePath}/${item}`),
      );
      await writeImportMarker(staging, prepared, "skill", skill.name);
      replacements.push({ staging, destination: join(roots.skillsRoot, skill.name) });
    }
    return { replacements, stagedPaths, skippedFiles };
  } catch (error) {
    await Promise.all(stagedPaths.map((path) => rm(path, { recursive: true, force: true })));
    throw error;
  }
}

async function verifyStagedWorkBuddyImport(
  plan: PreparedImportPlan,
  staged: StagedWorkBuddyImport,
): Promise<void> {
  for (const replacement of staged.replacements) {
    if (!await pathExists(replacement.staging)) {
      throw new Error(`WorkBuddy import staging is missing: ${replacement.staging}`);
    }
  }
  const currentFingerprint = await fingerprintPreparedSource(plan.prepared);
  if (currentFingerprint !== plan.transaction.sourceFingerprint) {
    throw new ImportTransactionError(
      "import_plan_stale",
      "WorkBuddy source changed while the import was being staged",
    );
  }
  const currentTargetFingerprint = await fingerprintCurrentImportDestinations(plan);
  if (currentTargetFingerprint !== plan.transaction.targetFingerprint) {
    throw new ImportTransactionError(
      "import_plan_stale",
      "WorkBuddy destinations changed after preview",
    );
  }
  const expectedExpertState = plan.transaction.action === "update" ? "owned" : "missing";
  const expertState = await ownershipState(
    plan.destination,
    plan.prepared.summary.packageName,
  );
  if (expertState !== expectedExpertState) {
    throw new ImportTransactionError(
      "import_plan_stale",
      "WorkBuddy expert destination changed after preview",
      { destination: plan.destination, state: expertState },
    );
  }
  for (const skillName of plan.installedSkills) {
    const destination = join(plan.roots.skillsRoot, skillName);
    const state = await ownershipState(destination, plan.prepared.summary.packageName);
    if (state === "foreign" || (plan.transaction.action === "add" && state !== "missing")) {
      throw new ImportTransactionError(
        "import_plan_stale",
        "WorkBuddy skill destination changed after preview",
        { destination, state },
      );
    }
  }
}

async function fingerprintCurrentImportDestinations(
  plan: PreparedImportPlan,
): Promise<string> {
  return fingerprintImportDestinations([
    {
      destination: plan.destination,
      state: await ownershipState(
        plan.destination,
        plan.prepared.summary.packageName,
      ),
    },
    ...(await Promise.all(
      plan.installedSkills.map(async (skillName) => {
        const destination = join(plan.roots.skillsRoot, skillName);
        return {
          destination,
          state: await ownershipState(destination, plan.prepared.summary.packageName),
        };
      }),
    )),
  ]);
}

async function fingerprintImportDestinations(
  destinations: ImportDestinationState[],
): Promise<string> {
  const hash = createHash("sha256");
  for (const item of [...destinations].sort((left, right) =>
    left.destination.localeCompare(right.destination),
  )) {
    hash.update(`destination:${item.destination}\0state:${item.state}\0`);
    if (item.state === "owned") {
      hash.update(await fingerprintSafePackageTree(item.destination));
    }
  }
  return hash.digest("hex");
}

async function fingerprintPreparedSource(prepared: PreparedPackage): Promise<string> {
  const safeTreeFingerprint = await fingerprintSafePackageTree(prepared.sourceDir);
  const manifestContent = await readFile(join(prepared.sourceDir, WORKBUDDY_MANIFEST), "utf8");
  return createHash("sha256")
    .update(safeTreeFingerprint)
    .update(manifestContent)
    .digest("hex");
}

async function verifyCommittedWorkBuddyImport(plan: PreparedImportPlan): Promise<void> {
  const manifestPath = join(plan.destination, ONMYAGENT_MANIFEST);
  if (!await pathExists(manifestPath)) {
    throw new Error(`WorkBuddy expert verification failed: ${plan.destination}`);
  }
  if (plan.prepared.teamWorkflow) {
    const manifest = await readJsonRecord(manifestPath);
    const teamWorkflow = manifest && isRecord(manifest.teamWorkflow)
      ? manifest.teamWorkflow
      : null;
    if (teamWorkflow?.mode !== "lead-workflow") {
      throw new Error(`WorkBuddy team workflow verification failed: ${plan.destination}`);
    }
  }
  for (const skillName of plan.installedSkills) {
    const skillMarkdown = join(plan.roots.skillsRoot, skillName, "SKILL.md");
    if (!await pathExists(skillMarkdown)) {
      throw new Error(`WorkBuddy skill verification failed: ${skillMarkdown}`);
    }
  }
}

async function cleanupStagedWorkBuddyImport(staged: StagedWorkBuddyImport): Promise<void> {
  await Promise.all(
    staged.stagedPaths.map((path) => rm(path, { recursive: true, force: true })),
  );
}

function assertWorkBuddyPlanCommittable(
  transaction: ImportTransactionPreview<WorkBuddyPackageSummary>,
): void {
  if (transaction.conflicts.length === 0) return;
  throw new WorkBuddyImportError(
    409,
    "workbuddy_import_conflict",
    "Import would overwrite an expert or skill not owned by getworkbuddy",
    { conflicts: transaction.conflicts },
  );
}

function toWorkBuddyTransactionError(error: ImportTransactionError): WorkBuddyImportError {
  if (error.code === "import_conflict") {
    return new WorkBuddyImportError(409, "workbuddy_import_conflict", error.message, error.details);
  }
  if (error.code === "import_plan_stale") {
    return new WorkBuddyImportError(409, "workbuddy_import_plan_stale", error.message, error.details);
  }
  return new WorkBuddyImportError(400, "workbuddy_import_confirmation_required", error.message);
}

async function loadPreparedPackages(roots: ImportRoots): Promise<PreparedPackage[]> {
  if (!await pathExists(roots.sourceRoot)) return [];
  const entries = await readdir(roots.sourceRoot, { withFileTypes: true });
  const packages: PreparedPackage[] = [];
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.name.startsWith(".")) continue;
    const sourceDir = join(roots.sourceRoot, entry.name);
    const manifestPath = packagePath(sourceDir, WORKBUDDY_MANIFEST);
    if (!await pathExists(manifestPath)) continue;
    const manifest = await readJsonRecord(
      await resolveSafePackagePath(sourceDir, WORKBUDDY_MANIFEST),
    );
    if (!manifest) continue;
    packages.push(await preparePackage(sourceDir, entry.name, manifest));
  }
  return packages;
}

async function selectPreparedPackage(
  query: string,
  kind?: WorkBuddyExpertType,
  roots = resolveWorkBuddyImportRoots(),
): Promise<PreparedPackage> {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) {
    throw new WorkBuddyImportError(400, "workbuddy_query_required", "WorkBuddy package name is required");
  }
  const packages = (await loadPreparedPackages(roots))
    .filter((item) => !kind || item.summary.expertType === kind);
  const exact = packages.filter((item) =>
    item.matchNames.some((name) => name.toLocaleLowerCase() === normalizedQuery));
  if (exact.length === 1) return exact[0];
  const fuzzy = packages.filter((item) =>
    item.matchNames.some((name) => name.toLocaleLowerCase().includes(normalizedQuery)));
  if (fuzzy.length === 1) return fuzzy[0];
  const candidates = (exact.length > 1 ? exact : fuzzy).map((item) => item.summary);
  if (candidates.length > 1) {
    throw new WorkBuddyImportError(
      409,
      "workbuddy_query_ambiguous",
      `Multiple WorkBuddy packages match: ${query}`,
      { candidates },
    );
  }
  throw new WorkBuddyImportError(
    404,
    "workbuddy_package_not_found",
    `WorkBuddy package not found: ${query}`,
    { available: packages.map((item) => item.summary) },
  );
}

async function preparePackage(
  sourceDir: string,
  directoryName: string,
  manifest: Record<string, unknown>,
): Promise<PreparedPackage> {
  const declaredName = stringValue(manifest.name) || directoryName;
  if (!isSafePackageSegment(declaredName)) {
    throw new WorkBuddyImportError(
      422,
      "workbuddy_manifest_invalid",
      `WorkBuddy package has an unsafe manifest name: ${directoryName}`,
    );
  }

  const members = Array.isArray(manifest.members) ? manifest.members.filter(isRecord) : [];
  const expertType: WorkBuddyExpertType = manifest.expertType === "team" || members.length > 1
    ? "team"
    : "agent";
  const teamInfo = isRecord(manifest.teamInfo) ? manifest.teamInfo : {};
  const leadAgentName = stringValue(manifest.agentName)
    || stringValue(teamInfo.leadAgent)
    || stringValue(members.find((member) => member.role === "lead")?.id)
    || directoryName;
  const agentRefs = await normalizedAgentRefs(sourceDir, manifest.agents, members, leadAgentName);
  if (agentRefs.length === 0) {
    throw new WorkBuddyImportError(
      422,
      "workbuddy_agents_missing",
      `WorkBuddy package has no readable agent markdown: ${directoryName}`,
    );
  }
  const orderedAgentRefs = leadFirst(agentRefs, leadAgentName);
  const leadAgentRelativePath = orderedAgentRefs[0];
  const leadMarkdown = await readFile(
    await resolveSafePackagePath(sourceDir, leadAgentRelativePath),
    "utf8",
  );
  const heading = firstMarkdownHeading(leadMarkdown) || directoryName;

  const displayPair = localizedPair(manifest.displayName, heading);
  const professionPair = localizedPair(manifest.profession, displayPair.zh || displayPair.en);
  const descriptionPair = localizedPair(
    manifest.displayDescription,
    stringValue(manifest.description) || frontmatterValue(leadMarkdown, "description") || heading,
  );
  const warnings: string[] = [
    "WorkBuddy connectors, tokens, sessions, task history, and runtime teams are not migrated.",
  ];
  if (expertType === "team") {
    warnings.push("Team roles are compiled into a single-lead workflow; no team member is independently dispatched.");
  }

  const teamWorkflow = expertType === "team"
    ? compileTeamWorkflow({
        leadAgentName,
        members,
        fallbackMemberIds: orderedAgentRefs.map((item) => basename(item, ".md")),
      })
    : undefined;
  const compiledLeadMarkdown = teamWorkflow
    ? appendTeamWorkflowPrompt(leadMarkdown, teamWorkflow)
    : leadMarkdown;

  const skillRefs = await normalizedSkillRefs(sourceDir, manifest.skills, warnings);
  const normalizedManifest: Record<string, unknown> = {
    ...manifest,
    name: declaredName,
    version: stringValue(manifest.version) || "1.0.0",
    description: stringValue(manifest.description) || descriptionPair.zh || descriptionPair.en,
    displayName: displayPair,
    profession: professionPair,
    displayDescription: descriptionPair,
    expertType,
    agentName: leadAgentName,
    agents: orderedAgentRefs.map((item) => `./${item}`),
    skills: skillRefs.map((item) => `./${item.relativePath}`),
    members,
    teamInfo: expertType === "team"
      ? Object.keys(teamInfo).length > 0
        ? teamInfo
        : {
            leadAgent: leadAgentName,
            memberAgents: orderedAgentRefs.slice(1).map((item) => basename(item, ".md")),
          }
      : undefined,
    teamWorkflow,
    importedFrom: "workbuddy",
  };
  const summary: WorkBuddyPackageSummary = {
    packageName: declaredName,
    displayName: displayPair.zh || displayPair.en,
    profession: professionPair.zh || professionPair.en,
    description: descriptionPair.zh || descriptionPair.en,
    version: stringValue(manifest.version) || null,
    expertType,
    leadAgentName,
    agents: orderedAgentRefs.map((item) => basename(item, ".md")),
    members: members.length || orderedAgentRefs.length,
    skills: skillRefs.filter((item) => item.hasSkillMarkdown).map((item) => item.name),
    warnings,
  };
  const matchNames = new Set([
    declaredName,
    directoryName,
    ...localizedValues(manifest.displayName),
    ...localizedValues(manifest.profession),
    displayPair.zh,
    displayPair.en,
    professionPair.zh,
    professionPair.en,
  ].filter(Boolean));
  return {
    summary,
    sourceDir,
    normalizedManifest,
    skillRefs,
    matchNames: [...matchNames],
    leadAgentRelativePath,
    compiledLeadMarkdown,
    teamWorkflow,
  };
}

async function normalizedAgentRefs(
  sourceDir: string,
  declared: unknown,
  members: Record<string, unknown>[],
  leadAgentName: string,
): Promise<string[]> {
  const candidates: string[] = [];
  if (Array.isArray(declared)) {
    for (const entry of declared) {
      const value = isRecord(entry) ? entry.path ?? entry.file ?? entry.id : entry;
      const relativePath = normalizePackageRelativePath(value);
      if (relativePath) candidates.push(relativePath);
    }
  }
  if (candidates.length === 0) {
    for (const member of members) {
      const id = stringValue(member.id);
      if (isSafePackageSegment(id)) candidates.push(`agents/${id}.md`);
    }
  }
  if (candidates.length === 0) {
    const agentsRoot = join(sourceDir, "agents");
    if (await pathExists(agentsRoot)) {
      const entries = await readdir(agentsRoot, { withFileTypes: true });
      candidates.push(
        ...entries
          .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
          .map((entry) => `agents/${entry.name}`),
      );
    }
  }
  if (!candidates.some((item) => basename(item, ".md") === leadAgentName)) {
    candidates.unshift(`agents/${leadAgentName}.md`);
  }
  const readable: string[] = [];
  for (const candidate of [...new Set(candidates)]) {
    if (!candidate.endsWith(".md")) continue;
    const candidatePath = packagePath(sourceDir, candidate);
    if (!await pathExists(candidatePath)) continue;
    await resolveSafePackagePath(sourceDir, candidate);
    readable.push(candidate);
  }
  return readable;
}

async function normalizedSkillRefs(
  sourceDir: string,
  declared: unknown,
  warnings: string[],
): Promise<Array<{ name: string; relativePath: string; hasSkillMarkdown: boolean }>> {
  if (!Array.isArray(declared)) return [];
  const output: Array<{ name: string; relativePath: string; hasSkillMarkdown: boolean }> = [];
  for (const entry of declared) {
    const candidate = isRecord(entry)
      ? entry.path ?? (stringValue(entry.name) ? `skills/${stringValue(entry.name)}` : null)
      : entry;
    const relativePath = normalizePackageRelativePath(candidate);
    if (!relativePath) {
      warnings.push("Ignored an unsafe or malformed WorkBuddy skill path.");
      continue;
    }
    const name = basename(relativePath);
    const sourcePath = packagePath(sourceDir, relativePath);
    if (!isSafePackageSegment(name) || !await pathExists(sourcePath)) {
      warnings.push(`Ignored missing WorkBuddy skill: ${relativePath}`);
      continue;
    }
    await resolveSafePackagePath(sourceDir, relativePath);
    const hasSkillMarkdown = await pathExists(packagePath(sourceDir, join(relativePath, "SKILL.md")));
    if (!hasSkillMarkdown) {
      warnings.push(`Preserved ${relativePath}, but did not install it globally because SKILL.md is missing.`);
    }
    output.push({ name, relativePath, hasSkillMarkdown });
  }
  return output;
}

function leadFirst(agentRefs: string[], leadAgentName: string): string[] {
  return [...agentRefs].sort((left, right) => {
    const leftLead = basename(left, ".md") === leadAgentName;
    const rightLead = basename(right, ".md") === leadAgentName;
    if (leftLead !== rightLead) return leftLead ? -1 : 1;
    return left.localeCompare(right);
  });
}

function localizedPair(value: unknown, fallback: string): { zh: string; en: string } {
  if (typeof value === "string" && value.trim()) {
    return { zh: value.trim(), en: value.trim() };
  }
  if (isRecord(value)) {
    const zh = stringValue(value.zh);
    const en = stringValue(value.en);
    const resolved = zh || en || fallback;
    return { zh: zh || resolved, en: en || resolved };
  }
  return { zh: fallback, en: fallback };
}

function localizedValues(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!isRecord(value)) return [];
  return [stringValue(value.zh), stringValue(value.en)].filter(Boolean);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function firstMarkdownHeading(markdown: string): string {
  return markdown.match(/^#\s+(.+)$/m)?.[1]?.trim() ?? "";
}

function frontmatterValue(markdown: string, key: string): string {
  const frontmatter = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/)?.[1] ?? "";
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return frontmatter.match(new RegExp(`^${escaped}:\\s*["']?([^"'\\n]+)`, "m"))?.[1]?.trim() ?? "";
}

async function ownershipState(
  destination: string,
  sourcePackage: string,
): Promise<"missing" | "owned" | "foreign"> {
  if (!await pathExists(destination)) return "missing";
  const marker = await readJsonRecord(join(destination, IMPORT_MARKER));
  return marker?.source === "workbuddy" && marker.sourcePackage === sourcePackage
    ? "owned"
    : "foreign";
}

async function writeImportMarker(
  destination: string,
  prepared: PreparedPackage,
  artifactType: "expert" | "skill",
  skillName?: string,
): Promise<void> {
  await writeFile(
    join(destination, IMPORT_MARKER),
    `${JSON.stringify({
      schemaVersion: 1,
      source: "workbuddy",
      sourcePackage: prepared.summary.packageName,
      sourceVersion: prepared.summary.version,
      artifactType,
      ...(skillName ? { skillName } : {}),
      importedAt: new Date().toISOString(),
    }, null, 2)}\n`,
    "utf8",
  );
}
