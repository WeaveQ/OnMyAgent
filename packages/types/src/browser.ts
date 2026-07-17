import { z } from "zod";

export const BrowserBackendSchema = z.enum(["in-app", "chrome"]);
export type BrowserBackend = z.infer<typeof BrowserBackendSchema>;

export const BrowserExecutionContextSchema = z.object({
  workspaceId: z.string().min(1),
  sessionId: z.string().min(1),
  messageId: z.string().min(1),
  turnId: z.string().min(1),
  agentId: z.string().min(1),
  backend: BrowserBackendSchema,
});
export type BrowserExecutionContext = z.infer<typeof BrowserExecutionContextSchema>;

export const BrowserRpcMethodSchema = z.enum([
  "getInfo",
  "attach",
  "detach",
  "executeCdp",
  "executeCdpWithCachedExpression",
  "createTab",
  "claimTab",
  "listTabs",
  "listUserTabs",
  "selectedTab",
  "finalizeTabs",
  "navigate",
  "navigateHistory",
  "reload",
  "screenshot",
  "locatorAction",
  "domObserve",
  "domAction",
  "coordinateAction",
  "dialogAction",
  "clipboardRead",
  "clipboardWrite",
  "consoleLogs",
  "tabContent",
  "history",
  "allowDownload",
  "turnEnded",
  "sessionDeleted",
  "nodeReplWrite",
  "nodeReplReset",
]);
export type BrowserRpcMethod = z.infer<typeof BrowserRpcMethodSchema>;

export const BrowserRpcRequestSchema = z.object({
  jsonrpc: z.literal("2.0"),
  id: z.union([z.string(), z.number()]),
  method: BrowserRpcMethodSchema,
  params: z.record(z.string(), z.unknown()),
  context: BrowserExecutionContextSchema,
  capability: z.string().min(1),
});
export type BrowserRpcRequest = z.infer<typeof BrowserRpcRequestSchema>;

export const BrowserTabOwnerSchema = z.enum(["user", "agent", "claimed"]);
export type BrowserTabOwner = z.infer<typeof BrowserTabOwnerSchema>;

export const BrowserTabSchema = z.object({
  tabId: z.string().min(1),
  owner: BrowserTabOwnerSchema,
  sessionId: z.string().min(1).nullable(),
  title: z.string(),
  url: z.string(),
  visible: z.boolean(),
  temporary: z.boolean(),
  deliverable: z.boolean(),
  handoff: z.boolean(),
});
export type BrowserTab = z.infer<typeof BrowserTabSchema>;

export const BrowserActivityMetadataSchema = z.object({
  backend: BrowserBackendSchema,
  tabId: z.string().min(1).nullable(),
  url: z.string().nullable(),
  activity: z.string().min(1),
  screenshot: z.string().nullable(),
  approvalId: z.string().nullable(),
  handoff: z.boolean(),
});
export type BrowserActivityMetadata = z.infer<typeof BrowserActivityMetadataSchema>;
