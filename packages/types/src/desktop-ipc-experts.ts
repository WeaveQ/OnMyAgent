// Expert marketplace IPC types (split out to keep desktop-ipc.ts under file-size baseline).

import type { ExpertTeamWorkflow } from "./expert-team-workflow.js";

export type ExpertMarketplaceName = "experts" | "my-experts";

/** Canonical metadata shared by package manifests, runtime markers, and UI. */
export type ExpertIntroStyle = "default" | "short-colleague";

export type ExpertPackageManifest = {
  /** Package skill declarations are names or package-relative skill refs. */
  skills: string[];
  introStyle?: ExpertIntroStyle;
  /** Optional OpenCode agent ids explicitly approved by the package. */
  approvedAgentIds?: string[];
};

export type ExpertPackageInstallInput = {
  source: "builtin";
  marketplace: ExpertMarketplaceName;
  packageName: string;
};

export type ExpertPackageInstallResult = {
  ok: true;
  path: string;
  packageName: string;
  marketplace: ExpertMarketplaceName;
  /** Canonical package skill declarations and materialization outcome. */
  skills?: string[];
  declaredSkills?: string[];
  installedSkills?: string[];
  missingSkills?: string[];
};

export type ExpertPackageUninstallInput = {
  marketplace: ExpertMarketplaceName;
  packageName: string;
};

export type ExpertPackageUninstallResult = {
  ok: true;
  path: string;
  packageName: string;
  marketplace: ExpertMarketplaceName;
  /** Package-owned skills removed from the user skills root. */
  removedSkills: string[];
  /** False when the package directory was already absent. */
  removedPackage: boolean;
};

export type ExpertPackageDeleteInput = {
  operationId: string;
  agentId: string;
  packageName: string;
  /**
   * User-writable root to remove. `my-experts` is self-created; `experts` is the
   * summoned local install. Never the bundled catalog under resources/.
   */
  marketplace: "my-experts" | "experts";
};

export type ExpertPackageDeleteStep = {
  target: "my-experts" | "experts" | "registry" | "skills";
  state: "pending" | "completed" | "skipped" | "failed";
  code?: string;
};

export type ExpertPackageDeleteResult = {
  ok: true;
  operationId: string;
  packageName: string;
  state: "completed" | "partial";
  steps: ExpertPackageDeleteStep[];
  removedSkills: string[];
};

export type ExpertPromptTemplate = { id: string; title: string; description: string; template: string; requiredSlots: string[]; conditionalSlots: string[] };
export type ExpertPackageListEntry = {
  id: string;
  packageName: string;
  source: "installed" | "mine";
  packagePath: string;
  displayName: string;
  profession: string;
  description: string;
  categoryId: string;
  tags: string[];
  quickPrompts: string[];
  promptTemplates: ExpertPromptTemplate[];
  avatarUrl: string | null;
  expertType: "agent" | "team";
  leadAgentName: string;
  systemPrompt: string;
  version: string | null;
  teamWorkflow: ExpertTeamWorkflow | null;
  skills: string[];
  introStyle: ExpertIntroStyle;
  approvedAgentIds: string[];
};

export type ExpertRegistryListEntry = {
  id: string;
  name: string;
  source: "installed" | "mine";
  packageName: string;
  packagePath: string;
};

export type MyExpertPackageWriteInput = {
  id: string;
  packageName: string;
  name: string;
  description: string;
  quote: string;
  rolePrompt?: string;
  memory?: string;
  draftId?: string;
  avatarDataUrl?: string;
  preserveKnowledge?: boolean;
  /** Canonical package skill declarations. */
  skills: string[];
  introStyle?: ExpertIntroStyle;
  approvedAgentIds?: string[];
  knowledge?: Array<{
    kind: "file" | "directory";
    relativePath: string;
    dataBase64?: string;
  }>;
};

export type MyExpertKnowledgeStageInput = {
  draftId: string;
  discard?: boolean;
  knowledge?: Array<{
    kind: "file" | "directory";
    relativePath: string;
    sourcePath?: string;
    dataBase64?: string;
  }>;
};

export type MyExpertKnowledgeStageResult = {
  ok: true;
  path: string;
  draftId: string;
};
