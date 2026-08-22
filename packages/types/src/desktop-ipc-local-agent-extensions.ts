/** Optional provider/catalog fields shared by Personal Local Agent views. */

export type PersonalLocalAgentRuntimeExtensions = {
  acpArgs?: string[];
  connectionType?: string | null;
  supportsAcp?: boolean;
  discoverable?: boolean;
  nativeSkillsDirs?: string[];
};
export type PersonalLocalAgentMetadataRuntimeExtensions = {
  acpArgs?: string[];
  connectionType?: string | null;
};
