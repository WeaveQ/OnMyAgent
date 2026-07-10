import type { ProviderAuthAuthorization } from "@opencode-ai/sdk/v2/client";

export type ProviderAuthMethod = {
  type: "oauth" | "api" | "cloud";
  label: string;
  methodIndex?: number;
  cloudProviderId?: string;
  description?: string;
  env?: string[];
  modelCount?: number;
};

export type ProviderAuthProvider = {
  id: string;
  name: string;
  env: string[];
};

export type ProviderOAuthStartResult = {
  methodIndex: number;
  authorization: ProviderAuthAuthorization;
};
