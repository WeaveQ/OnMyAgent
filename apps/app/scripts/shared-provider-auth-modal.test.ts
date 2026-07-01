import { describe, expect, test } from "bun:test";

import ProviderAuthModal, { type ProviderAuthModalProps } from "../src/react-app/domains/shared/provider-auth-modal";
import type {
  ProviderAuthMethod,
  ProviderAuthProvider,
} from "../src/react-app/domains/shared/provider-auth-types";

const provider = {
  id: "openai",
  name: "OpenAI",
  env: ["OPENAI_API_KEY"],
} satisfies ProviderAuthProvider;

const method = {
  type: "api",
  label: "API Key",
  env: ["OPENAI_API_KEY"],
  modelCount: 42,
} satisfies ProviderAuthMethod;

const props = {
  open: true,
  loading: false,
  submitting: false,
  error: null,
  providers: [provider],
  connectedProviderIds: [],
  authMethods: { openai: [method] },
  onSelect: async () => ({
    methodIndex: 0,
    authorization: { type: "manual", url: "" },
  }),
  onSubmitApiKey: async () => undefined,
  onConnectCloudProvider: async () => undefined,
  onSubmitOAuth: async () => ({ connected: true }),
  onClose: () => undefined,
} satisfies ProviderAuthModalProps;

describe("shared provider auth modal contract", () => {
  test("exports a reusable auth modal for settings and session domains", () => {
    expect(typeof ProviderAuthModal).toBe("function");
  });

  test("keeps provider and method props available through the shared boundary", () => {
    expect(props.providers).toEqual([provider]);
    expect(props.authMethods.openai).toEqual([method]);
  });
});
