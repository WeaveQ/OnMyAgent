/**
 * Keep the provider modal "Advanced JSON" panel in sync with the form:
 * form edits rewrite JSON; valid JSON edits fill the form.
 */

export type ProviderSettingsAppType = "opencode" | "openclaw" | "hermes" | "claude" | "codex" | (string & {});

export type ProviderSettingsModelRow = {
  id: string;
  name: string;
  contextWindow: string;
  outputTokenLimit: string;
};

export type ProviderSettingsDraftSlice = {
  name: string;
  baseUrl: string;
  apiKey: string;
  modelRows: ProviderSettingsModelRow[];
  settingsJson: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function parseSettingsObject(json: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(json);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Keep head/tail, replace the middle with `*` of the same length. */
export function maskSecretMiddle(secret: string): string {
  if (!secret) return secret;
  const n = secret.length;
  if (n <= 2) return "*".repeat(n);
  const keep = n > 12 ? 4 : n > 6 ? 2 : 1;
  return `${secret.slice(0, keep)}${"*".repeat(n - keep * 2)}${secret.slice(-keep)}`;
}

function replaceJsonStringLiteral(json: string, from: string, to: string): string {
  if (!from || from === to) return json;
  return json.split(JSON.stringify(from)).join(JSON.stringify(to));
}

/** Textarea display: hide the stored API key until the eye is open. */
export function displaySettingsJsonWithApiKeyVisibility(
  json: string,
  secret: string,
  revealed: boolean,
): string {
  if (revealed || !secret) return json;
  return replaceJsonStringLiteral(json, secret, maskSecretMiddle(secret));
}

/** Map a masked JSON edit back to the real key so sync does not persist stars. */
export function canonicalizeSettingsJsonApiKey(displayedJson: string, secret: string): string {
  if (!secret) return displayedJson;
  const masked = maskSecretMiddle(secret);
  if (masked === secret) return displayedJson;
  return replaceJsonStringLiteral(displayedJson, masked, secret);
}

function positiveNumberField(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return String(value);
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed) && parsed > 0) return String(parsed);
  }
  return "";
}

function modelEntryFromRow(
  row: ProviderSettingsModelRow,
  previousEntry: unknown,
): Record<string, unknown> {
  const previous = isRecord(previousEntry) ? { ...previousEntry } : {};
  const prevLimit = isRecord(previous.limit) ? { ...previous.limit } : {};
  const id = row.id.trim();
  const name = row.name.trim() || id;
  const contextWindow = Number.parseInt(row.contextWindow, 10);
  const outputTokenLimit = Number.parseInt(row.outputTokenLimit, 10);
  const next: Record<string, unknown> = { ...previous, name };
  if (Number.isFinite(contextWindow) && contextWindow > 0) {
    prevLimit.context = contextWindow;
  }
  if (Number.isFinite(outputTokenLimit) && outputTokenLimit > 0) {
    prevLimit.output = outputTokenLimit;
  }
  if (Object.keys(prevLimit).length > 0) next.limit = prevLimit;
  return next;
}

function rowsFromOpencodeModels(models: unknown): ProviderSettingsModelRow[] {
  if (!isRecord(models)) return [];
  return Object.entries(models).flatMap(([id, spec]) => {
    const key = id.trim();
    if (!key) return [];
    const record = isRecord(spec) ? spec : {};
    const limit = isRecord(record.limit) ? record.limit : {};
    const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : key;
    return [
      {
        id: key,
        name,
        contextWindow: positiveNumberField(record.contextWindow) || positiveNumberField(limit.context),
        outputTokenLimit:
          positiveNumberField(record.outputTokenLimit) || positiveNumberField(limit.output),
      },
    ];
  });
}

function rowsFromOpenclawModels(models: unknown): ProviderSettingsModelRow[] {
  if (!Array.isArray(models)) return [];
  return models.flatMap((item) => {
    if (typeof item === "string" && item.trim()) {
      const id = item.trim();
      return [{ id, name: id, contextWindow: "", outputTokenLimit: "" }];
    }
    if (!isRecord(item)) return [];
    const id = String(item.id ?? item.name ?? "").trim();
    if (!id) return [];
    const name = String(item.name ?? id).trim() || id;
    return [{ id, name, contextWindow: "", outputTokenLimit: "" }];
  });
}

export function stringifySettingsFromDraft(
  appType: ProviderSettingsAppType,
  draft: ProviderSettingsDraftSlice,
): string {
  const previous = parseSettingsObject(draft.settingsJson) ?? {};
  const filledRows = draft.modelRows.filter((row) => row.id.trim());
  if (appType === "opencode") {
    const prevOptions = isRecord(previous.options) ? { ...previous.options } : {};
    const prevModels = isRecord(previous.models) ? previous.models : {};
    const models = Object.fromEntries(
      filledRows.map((row) => [row.id.trim(), modelEntryFromRow(row, prevModels[row.id.trim()])]),
    );
    return JSON.stringify(
      {
        npm:
          typeof previous.npm === "string" && previous.npm.trim()
            ? previous.npm
            : "@ai-sdk/openai-compatible",
        ...previous,
        ...(draft.name.trim() ? { name: draft.name.trim() } : {}),
        options: {
          ...prevOptions,
          baseURL: draft.baseUrl.trim(),
          apiKey: draft.apiKey,
        },
        models,
      },
      null,
      2,
    );
  }
  if (appType === "openclaw") {
    return JSON.stringify(
      {
        ...previous,
        baseUrl: draft.baseUrl.trim(),
        apiKey: draft.apiKey,
        api: typeof previous.api === "string" && previous.api.trim() ? previous.api : "openai-completions",
        models: filledRows.map((row) => ({
          id: row.id.trim(),
          name: row.name.trim() || row.id.trim(),
        })),
      },
      null,
      2,
    );
  }
  if (appType === "hermes") {
    const model = filledRows[0]?.id.trim() ?? "";
    return JSON.stringify(
      {
        ...previous,
        base_url: draft.baseUrl.trim(),
        api_key: draft.apiKey,
        model,
      },
      null,
      2,
    );
  }
  return draft.settingsJson;
}

export function parseDraftFromSettingsJson(
  appType: ProviderSettingsAppType,
  json: string,
): Omit<ProviderSettingsDraftSlice, "settingsJson"> | null {
  const parsed = parseSettingsObject(json);
  if (!parsed) return null;
  if (appType === "opencode") {
    const options = isRecord(parsed.options) ? parsed.options : {};
    const modelRows = rowsFromOpencodeModels(parsed.models);
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      baseUrl: String(options.baseURL ?? options.baseUrl ?? ""),
      apiKey: String(options.apiKey ?? ""),
      modelRows,
    };
  }
  if (appType === "openclaw") {
    const modelRows = rowsFromOpenclawModels(parsed.models);
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      baseUrl: String(parsed.baseUrl ?? parsed.baseURL ?? ""),
      apiKey: String(parsed.apiKey ?? ""),
      modelRows,
    };
  }
  if (appType === "hermes") {
    const model = String(parsed.model ?? "").trim();
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      baseUrl: String(parsed.base_url ?? parsed.baseUrl ?? ""),
      apiKey: String(parsed.api_key ?? parsed.apiKey ?? ""),
      modelRows: model
        ? [{ id: model, name: model, contextWindow: "", outputTokenLimit: "" }]
        : [],
    };
  }
  return null;
}

export function syncProviderDraftSettingsJson<T extends ProviderSettingsDraftSlice>(
  appType: ProviderSettingsAppType,
  current: T,
  patch: Partial<T>,
  source: "form" | "json",
): T {
  if (source === "json" && typeof patch.settingsJson === "string") {
    const settingsJson = canonicalizeSettingsJsonApiKey(patch.settingsJson, current.apiKey);
    const next = { ...current, ...patch, settingsJson };
    const fromJson = parseDraftFromSettingsJson(appType, settingsJson);
    if (!fromJson) return next;
    const modelRows =
      fromJson.modelRows.length > 0 ? fromJson.modelRows : current.modelRows;
    return {
      ...next,
      name: fromJson.name || next.name,
      baseUrl: fromJson.baseUrl,
      apiKey: fromJson.apiKey,
      modelRows,
    };
  }
  const next = { ...current, ...patch };
  if (appType === "opencode" || appType === "openclaw" || appType === "hermes") {
    next.settingsJson = stringifySettingsFromDraft(appType, next);
  }
  return next;
}
