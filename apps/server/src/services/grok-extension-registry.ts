export type GrokExtensionSafety = "read" | "write" | "destructive";

export type GrokExtensionFeature =
  | "commands"
  | "session.delete"
  | "session.rename"
  | "session.fork"
  | "session.info"
  | "session.usage"
  | "session.search"
  | "mcp.inventory"
  | "mcp.administer";

export type GrokExtensionDefinition = {
  feature: GrokExtensionFeature;
  methods: readonly string[];
  aliases?: readonly string[];
  safety: GrokExtensionSafety;
};

export const GROK_EXTENSION_REGISTRY: readonly GrokExtensionDefinition[] = [
  {
    feature: "commands",
    methods: ["_x.ai/commands/list"],
    aliases: ["x.ai/commands/list"],
    safety: "read",
  },
  {
    feature: "session.delete",
    methods: ["x.ai/session/delete"],
    aliases: ["_x.ai/session/delete"],
    safety: "destructive",
  },
  {
    feature: "session.rename",
    methods: ["x.ai/session/rename"],
    aliases: ["_x.ai/session/rename"],
    safety: "write",
  },
  {
    feature: "session.fork",
    methods: ["x.ai/session/fork"],
    aliases: ["_x.ai/session/fork"],
    safety: "write",
  },
  {
    feature: "session.info",
    methods: ["x.ai/session/info"],
    aliases: ["_x.ai/session/info"],
    safety: "read",
  },
  {
    feature: "session.usage",
    methods: ["x.ai/session/usage"],
    aliases: ["_x.ai/session/usage"],
    safety: "read",
  },
  {
    feature: "session.search",
    methods: ["x.ai/session/search"],
    aliases: ["_x.ai/session/search"],
    safety: "read",
  },
  {
    feature: "mcp.inventory",
    methods: ["x.ai/mcp/list"],
    aliases: ["_x.ai/mcp/list"],
    safety: "read",
  },
  {
    feature: "mcp.administer",
    methods: ["x.ai/mcp/call"],
    aliases: ["_x.ai/mcp/call"],
    safety: "write",
  },
];

const byFeature = new Map(GROK_EXTENSION_REGISTRY.map((item) => [item.feature, item]));

export function grokExtensionFor(feature: GrokExtensionFeature): GrokExtensionDefinition {
  const definition = byFeature.get(feature);
  if (!definition) {
    throw new Error(`Unknown Grok extension feature: ${feature}`);
  }
  return definition;
}

export function isGrokExtensionMethod(method: string): boolean {
  const normalized = method.trim();
  return GROK_EXTENSION_REGISTRY.some((item) =>
    item.methods.includes(normalized) || item.aliases?.includes(normalized),
  );
}

export const GROK_SESSION_UPDATE_METHODS = [
  "session/update",
  "_x.ai/session/update",
] as const;

export const GROK_QUESTION_METHODS = [
  "x.ai/ask_user_question",
  "_x.ai/ask_user_question",
] as const;

export function isKnownGrokNotification(method: string): boolean {
  const normalized = method.trim();
  return normalized === "session/update"
    || GROK_SESSION_UPDATE_METHODS.includes(normalized as typeof GROK_SESSION_UPDATE_METHODS[number])
    || normalized === "session/request_permission"
    || GROK_QUESTION_METHODS.includes(normalized as typeof GROK_QUESTION_METHODS[number])
    || normalized.startsWith("x.ai/")
    || normalized.startsWith("_x.ai/");
}
