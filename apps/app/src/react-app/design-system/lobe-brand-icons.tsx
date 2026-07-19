/** @jsxImportSource react */
/**
 * Thin wrappers around tree-shakable `@lobehub/icons` brand marks.
 *
 * Prefer named icon components (Mono / Color) over `ProviderIcon` / `AgentIcon`
 * helpers — those pull `@lobehub/ui` + antd peers we do not want in the app shell.
 */
import type { ComponentType, CSSProperties } from "react";
import { memo } from "react";

import Anthropic from "@lobehub/icons/es/Anthropic";
import Claude from "@lobehub/icons/es/Claude";
import Cloudflare from "@lobehub/icons/es/Cloudflare";
import Codex from "@lobehub/icons/es/Codex";
import CodeBuddy from "@lobehub/icons/es/CodeBuddy";
import Copilot from "@lobehub/icons/es/Copilot";
import DeepSeek from "@lobehub/icons/es/DeepSeek";
import Gemini from "@lobehub/icons/es/Gemini";
import Github from "@lobehub/icons/es/Github";
import GithubCopilot from "@lobehub/icons/es/GithubCopilot";
import Google from "@lobehub/icons/es/Google";
import Goose from "@lobehub/icons/es/Goose";
import Grok from "@lobehub/icons/es/Grok";
import HermesAgent from "@lobehub/icons/es/HermesAgent";
import HuggingFace from "@lobehub/icons/es/HuggingFace";
import Kimi from "@lobehub/icons/es/Kimi";
import Microsoft from "@lobehub/icons/es/Microsoft";
import Moonshot from "@lobehub/icons/es/Moonshot";
import Notion from "@lobehub/icons/es/Notion";
import Ollama from "@lobehub/icons/es/Ollama";
import OpenAI from "@lobehub/icons/es/OpenAI";
import OpenClaw from "@lobehub/icons/es/OpenClaw";
import OpenCode from "@lobehub/icons/es/OpenCode";
import OpenRouter from "@lobehub/icons/es/OpenRouter";
import Qoder from "@lobehub/icons/es/Qoder";
import Qwen from "@lobehub/icons/es/Qwen";
import Trae from "@lobehub/icons/es/Trae";
import Vercel from "@lobehub/icons/es/Vercel";
import XiaomiMiMo from "@lobehub/icons/es/XiaomiMiMo";
import XAI from "@lobehub/icons/es/XAI";

type BrandIconProps = {
  size?: number | string;
  className?: string;
  style?: CSSProperties;
  color?: string;
};

type BrandIcon = ComponentType<BrandIconProps> & {
  Color?: ComponentType<BrandIconProps>;
};

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
    if (rule.test(hay) || rule.test(id) || id === rule.key) return rule.key;
  }
  return null;
}

/** Model-provider slug → Mono brand component (inherits currentColor). */
const PROVIDER_MONO: Record<string, BrandIcon> = {
  openai: OpenAI as BrandIcon,
  anthropic: Anthropic as BrandIcon,
  google: Google as BrandIcon,
  gemini: Gemini as BrandIcon,
  deepseek: DeepSeek as BrandIcon,
  openrouter: OpenRouter as BrandIcon,
  ollama: Ollama as BrandIcon,
  moonshot: Moonshot as BrandIcon,
  qwen: Qwen as BrandIcon,
  xai: XAI as BrandIcon,
  xiaomimimo: XiaomiMiMo as BrandIcon,
  github: Github as BrandIcon,
  githubcopilot: GithubCopilot as BrandIcon,
  copilot: Copilot as BrandIcon,
  opencode: OpenCode as BrandIcon,
  cloudflare: Cloudflare as BrandIcon,
  vercel: Vercel as BrandIcon,
  huggingface: HuggingFace as BrandIcon,
  microsoft: Microsoft as BrandIcon,
};

/** Agent id / provider → Color (or Mono) brand component for white-plate tiles. */
const AGENT_BRAND: Record<string, BrandIcon> = {
  claude: Claude as BrandIcon,
  codex: Codex as BrandIcon,
  openai: OpenAI as BrandIcon,
  gemini: Gemini as BrandIcon,
  google: Google as BrandIcon,
  copilot: GithubCopilot as BrandIcon,
  "github-copilot": GithubCopilot as BrandIcon,
  qwen: Qwen as BrandIcon,
  kimi: Kimi as BrandIcon,
  moonshot: Moonshot as BrandIcon,
  grok: Grok as BrandIcon,
  xai: XAI as BrandIcon,
  mimo: XiaomiMiMo as BrandIcon,
  mimocode: XiaomiMiMo as BrandIcon,
  openclaw: OpenClaw as BrandIcon,
  hermes: HermesAgent as BrandIcon,
  opencode: OpenCode as BrandIcon,
  goose: Goose as BrandIcon,
  // cursor-agent / kiro: keep local SVGs (agent-icon-map); do not map here
  trae: Trae as BrandIcon,
  codebuddy: CodeBuddy as BrandIcon,
  qoder: Qoder as BrandIcon,
};

/** Connector / plugin preview brands with Lobe coverage. */
const PLUGIN_BRAND: Record<string, BrandIcon> = {
  github: Github as BrandIcon,
  cloudflare: Cloudflare as BrandIcon,
  vercel: Vercel as BrandIcon,
  huggingface: HuggingFace as BrandIcon,
  m365: Microsoft as BrandIcon,
  microsoft365: Microsoft as BrandIcon,
  notion: Notion as BrandIcon,
  openai: OpenAI as BrandIcon,
};

export function hasLobeProviderIcon(
  providerId?: string | null,
  providerName?: string | null,
): boolean {
  const key = resolveLobeProviderKey(providerId, providerName);
  return Boolean(key && PROVIDER_MONO[key]);
}

export function hasLobeAgentBrandIcon(id?: string | null, provider?: string | null): boolean {
  const a = id?.trim().toLowerCase() ?? "";
  const p = provider?.trim().toLowerCase() ?? "";
  // Prefer local assets for these when present; never force a weak Lobe stand-in.
  if (a === "cursor-agent" || a === "cursor" || a === "kiro" || a === "onmyagent") {
    return false;
  }
  return Boolean(AGENT_BRAND[a] || AGENT_BRAND[p]);
}

export function hasLobePluginBrandIcon(iconKey?: string | null): boolean {
  const k = iconKey?.trim().toLowerCase() ?? "";
  return Boolean(PLUGIN_BRAND[k]);
}

function renderBrand(
  Icon: BrandIcon,
  opts: { size: number; className?: string; preferColor?: boolean },
) {
  const Color = Icon.Color;
  const Comp = opts.preferColor && Color ? Color : Icon;
  return <Comp size={opts.size} className={opts.className} />;
}

/** Model-provider mark (mono, themeable via currentColor). */
export const LobeProviderBrandIcon = memo(function LobeProviderBrandIcon(props: {
  providerId?: string | null;
  providerName?: string | null;
  size?: number;
  className?: string;
  /** Called when no Lobe mark maps for this provider (caller may show a fallback). */
  onFailed?: () => void;
}) {
  const key = resolveLobeProviderKey(props.providerId, props.providerName);
  if (!key) {
    props.onFailed?.();
    return null;
  }
  const Icon = PROVIDER_MONO[key];
  if (!Icon) {
    props.onFailed?.();
    return null;
  }
  return renderBrand(Icon, {
    size: props.size ?? 16,
    className: props.className,
    preferColor: false,
  });
});

/** Local-agent tile mark (color when available). */
export const LobeAgentBrandIcon = memo(function LobeAgentBrandIcon(props: {
  id?: string | null;
  provider?: string | null;
  size?: number;
  className?: string;
}) {
  const a = props.id?.trim().toLowerCase() ?? "";
  const p = props.provider?.trim().toLowerCase() ?? "";
  const Icon = AGENT_BRAND[a] ?? AGENT_BRAND[p];
  if (!Icon) return null;
  return renderBrand(Icon, {
    size: props.size ?? 24,
    className: props.className,
    preferColor: true,
  });
});

/** Plugin / connector preview mark. */
export const LobePluginBrandIcon = memo(function LobePluginBrandIcon(props: {
  iconKey?: string | null;
  size?: number;
  className?: string;
  /** Called when no Lobe mark maps for this icon key (caller may show a fallback). */
  onFailed?: () => void;
}) {
  const k = props.iconKey?.trim().toLowerCase() ?? "";
  const Icon = PLUGIN_BRAND[k];
  if (!Icon) {
    props.onFailed?.();
    return null;
  }
  return renderBrand(Icon, {
    size: props.size ?? 24,
    className: props.className,
    preferColor: true,
  });
});
