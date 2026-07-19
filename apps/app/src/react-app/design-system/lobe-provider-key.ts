/**
 * Pure mapping helpers for Lobe brand icon ids (no React / package imports).
 * Kept separate so unit tests do not load `@lobehub/icons` (circular graph in features).
 */

/** Normalize free-form provider id / display name → lobe provider slug. */
export function resolveLobeProviderKey(
  providerId?: string | null,
  providerName?: string | null,
): string | null {
  const id = providerId?.trim().toLowerCase() ?? "";
  const name = providerName?.trim().toLowerCase() ?? "";
  const hay = `${id} ${name}`;

  const rules: Array<{ key: string; test: (s: string) => boolean }> = [
    { key: "openai", test: (s) => /\bopenai\b|\bcodex\b|\bgpt\b|\bchatgpt\b/.test(s) },
    { key: "anthropic", test: (s) => /\banthropic\b|\bclaude\b/.test(s) },
    { key: "google", test: (s) => /\bgoogle\b|\bgemini\b|\bvertex\b/.test(s) },
    { key: "deepseek", test: (s) => /\bdeepseek\b/.test(s) },
    { key: "openrouter", test: (s) => /\bopenrouter\b/.test(s) },
    { key: "ollama", test: (s) => /\bollama\b/.test(s) },
    { key: "moonshot", test: (s) => /\bmoonshot\b|\bkimi\b/.test(s) },
    { key: "qwen", test: (s) => /\bqwen\b|\balibaba\b|\bdashscope\b|\bbailian\b/.test(s) },
    { key: "xai", test: (s) => /\bxai\b|\bgrok\b/.test(s) },
    { key: "xiaomimimo", test: (s) => /\bmimo\b|\bxiaomi\b/.test(s) },
    { key: "github", test: (s) => /\bgithub\b/.test(s) && !/\bcopilot\b/.test(s) },
    { key: "githubcopilot", test: (s) => /\bcopilot\b/.test(s) },
    { key: "opencode", test: (s) => /\bopencode\b/.test(s) },
    { key: "cloudflare", test: (s) => /\bcloudflare\b|\bworkers\b/.test(s) },
    { key: "vercel", test: (s) => /\bvercel\b/.test(s) },
    { key: "huggingface", test: (s) => /\bhuggingface\b|\bhf\b/.test(s) },
    { key: "microsoft", test: (s) => /\bmicrosoft\b|\bazure\b|\bm365\b|\boffice\b/.test(s) },
    { key: "groq", test: (s) => /\bgroq\b/.test(s) },
    { key: "mistral", test: (s) => /\bmistral\b/.test(s) },
    { key: "togetherai", test: (s) => /\btogether\b/.test(s) },
    { key: "fireworks", test: (s) => /\bfireworks\b/.test(s) },
    { key: "perplexity", test: (s) => /\bperplexity\b/.test(s) },
    { key: "zhipu", test: (s) => /\bzhipu\b|\bglm\b|\bchatglm\b/.test(s) },
    { key: "volcengine", test: (s) => /\bvolc\b|\bdoubao\b|\bbytedance\b/.test(s) },
    { key: "siliconcloud", test: (s) => /\bsilicon\b/.test(s) },
  ];

  for (const rule of rules) {
    if (id === rule.key || rule.test(hay) || rule.test(id)) return rule.key;
  }
  return null;
}

/**
 * Agent product id → Lobe static icon id (lowercase slug used by static-svg package).
 * Only entries with reliable public marks are listed; niche agents stay on local assets.
 */
export const LOBE_AGENT_ICON_ID: Record<string, string> = {
  claude: "claude",
  codex: "openai",
  openai: "openai",
  gemini: "gemini",
  google: "google",
  copilot: "githubcopilot",
  "github-copilot": "githubcopilot",
  qwen: "qwen",
  kimi: "kimi",
  moonshot: "moonshot",
  grok: "xai",
  xai: "xai",
  mimo: "xiaomimimo",
  mimocode: "xiaomimimo",
  openclaw: "openclaw",
  hermes: "hermesagent",
  opencode: "opencode",
  goose: "goose",
  trae: "trae",
  codebuddy: "codebuddy",
  qoder: "qoder",
};

export const LOBE_PLUGIN_ICON_ID: Record<string, string> = {
  github: "github",
  cloudflare: "cloudflare",
  vercel: "vercel",
  huggingface: "huggingface",
  m365: "microsoft",
  microsoft365: "microsoft",
  notion: "notion",
};

/**
 * Icons that publish a `-color.svg` on `@lobehub/icons-static-svg` (npmmirror).
 * Others only ship mono (`{id}.svg`); requesting `-color` 404s on Aliyun.
 * Probed against registry.npmmirror.com (package 1.94.x).
 */
const LOBE_COLOR_VARIANT_IDS = new Set([
  "claude",
  "google",
  "gemini",
  "deepseek",
  "openrouter",
  "qwen",
  "cloudflare",
  "huggingface",
  "microsoft",
  "mistral",
  "kimi",
  "openclaw",
  "trae",
  "codebuddy",
  "qoder",
]);

/**
 * Build a static SVG URL from the Lobe icons static package.
 * Aliyun npmmirror CDN — same layout as getLobeIconCDN `cdn: 'aliyun'`.
 * Prefer color when the package ships it; otherwise fall back to mono.
 */
export function lobeStaticSvgUrl(
  iconId: string,
  variant: "mono" | "color" = "color",
): string {
  const id = iconId.trim().toLowerCase();
  const useColor = variant === "color" && LOBE_COLOR_VARIANT_IDS.has(id);
  const file = useColor ? `${id}-color.svg` : `${id}.svg`;
  return `https://registry.npmmirror.com/@lobehub/icons-static-svg/latest/files/icons/${file}`;
}

export function resolveLobeAgentIconId(
  id?: string | null,
  provider?: string | null,
): string | null {
  const a = id?.trim().toLowerCase() ?? "";
  const p = provider?.trim().toLowerCase() ?? "";
  if (a === "onmyagent" || a === "cursor-agent" || a === "cursor" || a === "kiro") {
    return null;
  }
  return LOBE_AGENT_ICON_ID[a] ?? LOBE_AGENT_ICON_ID[p] ?? null;
}

export function resolveLobePluginIconId(iconKey?: string | null): string | null {
  const k = iconKey?.trim().toLowerCase() ?? "";
  return LOBE_PLUGIN_ICON_ID[k] ?? null;
}
