// Expert marketplace IPC types (split out to keep desktop-ipc.ts under file-size baseline).

import type { ExpertTeamWorkflow } from "./expert-team-workflow.js";

export type ExpertMarketplaceName = "experts" | "my-experts";

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
  skillIds?: string[];
  draftId?: string;
  avatarDataUrl?: string;
  preserveKnowledge?: boolean;
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
