import { APP_NAME } from "../core/brand.js";
import { type EnvService } from "../services/env-file.js";
import { ApiError } from "../core/errors.js";
import { addRoute, systemJsonResponse, type Route } from "./route-core.js";

const ONMYAGENT_VOICE_REALTIME_MODEL = "gpt-realtime-2";
const ONMYAGENT_VOICE_TRANSCRIPTION_MODEL = "gpt-4o-transcribe";

const ONMYAGENT_VOICE_REALTIME_TOOLS = [
  {
    type: "function",
    name: "onmyagent_snapshot",
    description: `Read the current ${APP_NAME} UI control snapshot: route, status, narration, and visible action metadata.`,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "onmyagent_list_actions",
    description: `List semantic ${APP_NAME} UI actions. Call this before onmyagent_execute_action when you do not know the exact action id.`,
    parameters: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    type: "function",
    name: "onmyagent_execute_action",
    description: `Execute a semantic ${APP_NAME} UI action by id. Prefer this over screen coordinates or DOM guessing.`,
    parameters: {
      type: "object",
      properties: {
        actionId: {
          type: "string",
          description:
            "The action id from onmyagent_list_actions, such as composer.set_text or composer.send.",
        },
        args: {
          type: "object",
          description: "Optional JSON arguments for the action.",
          additionalProperties: true,
        },
      },
      required: ["actionId"],
      additionalProperties: false,
    },
  },
];

export function registerVoiceRoutes(input: {
  routes: Route[];
  env: EnvService;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
}) {
  const { routes, env, readJsonBody } = input;

  addRoute(routes, "POST", "/voice/realtime/session", "host", async (ctx) => {
    const body = await readJsonBody(ctx.request);
    return systemJsonResponse(await createOpenAiRealtimeVoiceSession(env, body));
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readStringField(value: unknown, key: string): string {
  if (!isRecord(value)) return "";
  const field = value[key];
  return typeof field === "string" ? field.trim() : "";
}

async function resolveOpenAiRealtimeApiKey(env: EnvService): Promise<string> {
  const records = await env.list();
  const storedKey =
    records
      .find((entry) => entry.key === "OPENAI_REALTIME_API_KEY")
      ?.value.trim() ||
    records.find((entry) => entry.key === "OPENAI_API_KEY")?.value.trim() ||
    "";
  if (storedKey) return storedKey;

  return (
    process.env.ONMYAGENT_OPENAI_REALTIME_API_KEY?.trim() ||
    process.env.OPENAI_REALTIME_API_KEY?.trim() ||
    process.env.OPENAI_API_KEY?.trim() ||
    ""
  );
}

function onmyagentVoiceRealtimeInstructions() {
  return `# Role and Objective

You are ${APP_NAME} Voice Mode, a voice-first control layer inside ${APP_NAME}.
Help the user control ${APP_NAME} by using the semantic ${APP_NAME} UI tools.

# Tool Policy

- Prefer onmyagent_snapshot, onmyagent_list_actions, and onmyagent_execute_action over visual guessing.
- If the user asks to write or draft something, use composer.set_text.
- If the user asks to send or run the current prompt, use composer.send.
- For navigation, settings, session, transcript, and composer work, inspect the action list first if the action id is unknown.
- Do not claim an action completed until the tool succeeds.
- Ask for confirmation before destructive actions such as deleting a session.

# Voice Style

- Be concise, calm, and direct.
- If audio is unclear, ask the user to repeat it instead of guessing.
- Ignore background speech that is not addressed to ${APP_NAME}.
- Summarize tool results briefly and offer the next useful step.`;
}

function readOpenAiClientSecret(payload: unknown): {
  clientSecret: string;
  expiresAt: number | null;
} {
  if (!isRecord(payload)) return { clientSecret: "", expiresAt: null };
  const clientSecret = payload.client_secret;
  if (typeof clientSecret === "string")
    return { clientSecret, expiresAt: null };
  if (isRecord(clientSecret)) {
    const value =
      typeof clientSecret.value === "string" ? clientSecret.value : "";
    const expiresAt =
      typeof clientSecret.expires_at === "number"
        ? clientSecret.expires_at
        : null;
    return { clientSecret: value, expiresAt };
  }
  const value = typeof payload.value === "string" ? payload.value : "";
  return { clientSecret: value, expiresAt: null };
}

async function createOpenAiRealtimeVoiceSession(
  env: EnvService,
  input: unknown,
) {
  const apiKey = await resolveOpenAiRealtimeApiKey(env);
  if (!apiKey) {
    throw new ApiError(
      400,
      "openai_api_key_missing",
      `OpenAI API key missing. Save OPENAI_API_KEY in ${APP_NAME} Environment Variables or configure the Voice Mode extension.`,
    );
  }

  const model =
    readStringField(input, "model") || ONMYAGENT_VOICE_REALTIME_MODEL;
  const response = await fetch(
    "https://api.openai.com/v1/realtime/client_secrets",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        session: {
          type: "realtime",
          model,
          output_modalities: ["audio"],
          audio: {
            input: {
              transcription: {
                model: ONMYAGENT_VOICE_TRANSCRIPTION_MODEL,
                language: "en",
              },
              turn_detection: {
                type: "server_vad",
                threshold: 0.58,
                silence_duration_ms: 320,
                prefix_padding_ms: 300,
                create_response: true,
                interrupt_response: true,
              },
            },
          },
          instructions: onmyagentVoiceRealtimeInstructions(),
          tool_choice: "auto",
          tools: ONMYAGENT_VOICE_REALTIME_TOOLS,
        },
      }),
    },
  );

  const text = await response.text();
  let payload: unknown = null;
  try {
    payload = text ? JSON.parse(text) : null;
  } catch {
    payload = null;
  }

  if (!response.ok) {
    const errorPayload =
      isRecord(payload) && isRecord(payload.error) ? payload.error : null;
    const message =
      typeof errorPayload?.message === "string"
        ? errorPayload.message
        : response.statusText;
    throw new ApiError(
      response.status,
      "openai_realtime_failed",
      message || "Failed to create OpenAI Realtime session",
    );
  }

  const { clientSecret, expiresAt } = readOpenAiClientSecret(payload);
  if (!clientSecret) {
    throw new ApiError(
      502,
      "openai_realtime_invalid_response",
      "OpenAI did not return a usable Realtime client secret",
    );
  }

  return {
    ok: true,
    clientSecret,
    expiresAt,
    model,
    transcriptionModel: ONMYAGENT_VOICE_TRANSCRIPTION_MODEL,
    tools: ONMYAGENT_VOICE_REALTIME_TOOLS.map((tool) => tool.name),
  };
}
