// Local / builtin skill desktop IPC wire types.
// Extracted from desktop-ipc.ts (re-exported for public entry compatibility).

export type LocalSkillCard = {
  name: string;
  path: string;
  description?: string;
  trigger?: string;
  root?: string;
  readonly?: boolean;
  displayNameZh?: string;
  displayNameEn?: string;
  descriptionZh?: string;
  descriptionEn?: string;
};

export type LocalSkillContent = {
  path: string;
  content: string;
};

export type OpencodeConfigFile = {
  path: string;
  exists: boolean;
  content: string | null;
};

export type BuiltinSkillPackageInstallInput = {
  source: "builtin";
  packageName: string;
  skillName: string;
};

export type BuiltinSkillPackageInstallResult = {
  ok: true;
  path: string;
  packageName: string;
  skillName: string;
};

/** Built-in catalog row for the 内置 tab (install source, not Agent load root). */
export type BuiltinSkillCatalogEntry = {
  packageName: string;
  skillName: string;
  installed: boolean;
  corePreinstall: boolean;
  description?: string;
  displayNameZh?: string;
  displayNameEn?: string;
};

export type BuiltinSkillCatalogResult = {
  skills: BuiltinSkillCatalogEntry[];
};

export type EnsureDefaultBuiltinSkillsResult = {
  ok: boolean;
  installed: string[];
  skipped: string[];
  errors: string[];
};
