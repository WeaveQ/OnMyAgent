export type LocalizedText = {
  zh?: string;
  en?: string;
};

export type ExpertMarketplaceSource = "builtin" | "installed" | "mine";

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
  avatarUrl: string | null;
  expertType: "agent" | "team";
  leadAgentName: string;
  systemPrompt: string;
  version: string | null;
};

export type ExpertRegistryRecord = {
  id: string;
  name: string;
  source: ExpertMarketplaceSource;
  packageName: string;
  packagePath: string;
};
