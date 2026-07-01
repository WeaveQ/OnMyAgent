import { t } from "@/i18n";
import { desktopFetch } from "../../../app/lib/desktop";
import type { OpenworkServerClient } from "../../../app/lib/onmyagent-server";

export type LocalProviderInstallInput = {
  providerId: string;
  name: string;
  baseURL: string;
  modelId: string;
  modelName: string;
  setDefault: boolean;
};

export const OLLAMA_PROVIDER_CONFIG = {
  providerId: "ollama",
  name: "Ollama (local)",
  baseURL: "http://localhost:11434/v1",
  defaultModelId: "qwen2.5-coder:7b",
};

export const OPENAI_IMAGE_EXTENSION_ID = "openai-image-generation";
export const OPENAI_IMAGE_MODEL = "gpt-image-2";
export const OPENAI_API_KEY_ENV_KEY = "OPENAI_API_KEY";
export const IMAGE_GENERATION_PLUGIN_PATH = ".opencode/plugins/onmyagent-image-generation.ts";
export const IMAGE_GENERATION_EXTENSION_CONFIG_PATH = ".opencode/onmyagent-extensions/openai-image-generation.json";

export const IMAGE_GENERATION_PLUGIN_CONTENT = `import { tool } from "@opencode-ai/plugin"

const CONFIG_PATH = ".opencode/onmyagent-extensions/openai-image-generation.json"
const MODEL = "gpt-image-2"

const readConfig = async (root) => {
  const { readFile } = await import("node:fs/promises")
  const { join } = await import("node:path")
  const apiKeyFromEnv = process.env.OPENAI_API_KEY || process.env.ONMYAGENT_OPENAI_IMAGE_API_KEY || ""
  try {
    const raw = await readFile(join(root, CONFIG_PATH), "utf8")
    const parsed = JSON.parse(raw)
    const configKey = String(parsed?.apiKey || "").trim()
    return { apiKey: configKey || apiKeyFromEnv.trim() }
  } catch {
    return { apiKey: apiKeyFromEnv.trim() }
  }
}

const slugify = (value) => String(value)
  .toLowerCase()
  .replace(/[^a-z0-9]+/g, "-")
  .replace(/^-+|-+$/g, "")
  .slice(0, 48) || "onmyagent-image"

const generateImage = async ({ apiKey, prompt }) => {
  const response = await fetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ model: MODEL, prompt }),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || "OpenAI image generation failed"
    throw Object.assign(new Error(message), { payload, status: response.status, model: MODEL })
  }
  return payload
}

export const OnMyAgentImageGeneration = async () => ({
  tool: {
    image_generate: tool({
      description: ${JSON.stringify(t("extensions.openai_image_tool_desc"))},
      args: {
        prompt: tool.schema.string().describe("Image prompt to turn into an artifact."),
        filename: tool.schema.string().optional().describe("Optional output filename without extension."),
      },
      async execute(args, context) {
        const { mkdir, writeFile } = await import("node:fs/promises")
        const { join } = await import("node:path")
        const prompt = String(args.prompt || "").trim() || "OnMyAgent image"
        const root = context.directory || context.worktree || process.cwd()
        const config = await readConfig(root)
        if (!config.apiKey) throw new Error("OpenAI API key missing. Configure the OpenAI Image Generation extension in OnMyAgent.")
        const payload = await generateImage({ apiKey: config.apiKey, prompt })
        const first = payload?.data?.[0]
        if (!first?.b64_json) throw new Error("OpenAI did not return image data")
        const fileName = slugify(args.filename || prompt) + ".png"
        const outputDir = join(root, "artifacts")
        await mkdir(outputDir, { recursive: true })
        const outputPath = join(outputDir, fileName)
        await writeFile(outputPath, Buffer.from(first.b64_json, "base64"))
        return "Generated image artifact at artifacts/" + fileName + " using " + MODEL
      },
    }),
  },
})
`;

export function slugifyImageArtifactName(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48) || "onmyagent-image";
}

export function base64ToArrayBuffer(value: string) {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}

export async function installOpenAiImageExtensionFiles(input: {
  apiKey: string;
  client: Pick<OpenworkServerClient, "writeWorkspaceBinaryFile">;
  workspaceId: string;
}) {
  const encoder = new TextEncoder();
  await input.client.writeWorkspaceBinaryFile(input.workspaceId, {
    path: IMAGE_GENERATION_PLUGIN_PATH,
    data: encoder.encode(IMAGE_GENERATION_PLUGIN_CONTENT).buffer,
    force: true,
  });
  await input.client.writeWorkspaceBinaryFile(input.workspaceId, {
    path: IMAGE_GENERATION_EXTENSION_CONFIG_PATH,
    data: encoder.encode(JSON.stringify({
      id: OPENAI_IMAGE_EXTENSION_ID,
      name: "OpenAI Image Generation",
      type: "onmyagent-extension",
      model: OPENAI_IMAGE_MODEL,
      apiKey: input.apiKey,
      env: [OPENAI_API_KEY_ENV_KEY],
    }, null, 2)).buffer,
    force: true,
  });
  await input.client.writeWorkspaceBinaryFile(input.workspaceId, {
    path: ".opencode/package.json",
    data: encoder.encode(JSON.stringify({ dependencies: { "@opencode-ai/plugin": "1.14.38" } }, null, 2)).buffer,
    force: true,
  });
}

export async function requestOpenAiImage(input: { apiKey: string; prompt: string }) {
  const response = await desktopFetch("https://api.openai.com/v1/images/generations", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: OPENAI_IMAGE_MODEL,
      prompt: input.prompt,
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload?.error?.message || payload?.message || t("extensions.openai_image_generation_failed");
    throw Object.assign(new Error(message), { payload, status: response.status, model: OPENAI_IMAGE_MODEL });
  }
  return payload;
}

function readOpenAiImageBase64(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const data = (payload as Record<string, unknown>).data;
  if (!Array.isArray(data)) return null;
  const first = data[0];
  if (!first || typeof first !== "object" || Array.isArray(first)) return null;
  const base64 = (first as Record<string, unknown>).b64_json;
  return typeof base64 === "string" && base64.trim() ? base64 : null;
}

export async function openAiImageResponseToArrayBuffer(payload: unknown) {
  const base64 = readOpenAiImageBase64(payload);
  if (base64) {
    return base64ToArrayBuffer(base64);
  }
  throw new Error(t("extensions.openai_image_missing_data"));
}
