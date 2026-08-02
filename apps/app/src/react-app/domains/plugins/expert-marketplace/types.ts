export type LocalizedText = {
  zh?: string;
  en?: string;
};

export type ExpertMarketplaceSource = "builtin" | "installed" | "mine";

export type ExpertPromptTemplate = {
  id: string;
  title: string;
  description: string;
  template: string;
  requiredSlots: string[];
  conditionalSlots: string[];
};

export type ExpertMarketplaceEntry = {
  id: string;
  packageName: string;
  source: ExpertMarketplaceSource;
  packagePath: string;
  displayName: string;
  profession: string;
  description: string;
  categoryId: string;
  categoryIds: string[];
  categoryLabel: string;
  categoryLabels: string[];
  tags: string[];
  quickPrompts: string[];
  promptTemplates: ExpertPromptTemplate[];
  avatarUrl: string | null;
  expertType: "agent" | "team";
  leadAgentName: string;
  systemPrompt: string;
  version: string | null;
};

export type ExpertMarketplaceSummonHandler = (
  expert: ExpertMarketplaceEntry,
  initialPrompt?: string,
) => void;

export type ExpertRegistryRecord = {
  id: string;
  name: string;
  source: ExpertMarketplaceSource;
  packageName: string;
  packagePath: string;
};
