/**
 * Client-only persistent store for the "hidden models" set used by the model
 * picker. Kept in localStorage; no cross-window sync (the picker is modal and
 * the container reads once per render tick).
 *
 * Extracted from `session/modals/model-picker-modal.tsx` so that consumers
 * outside the modal (e.g. `session/components/model-select`) do not depend on
 * the modal's internals.
 */
import type { ModelOption } from "../../../../app/types";
import { isDefaultVisibleModel } from "../../../../app/defaults";

const HIDDEN_MODELS_KEY = "onmyagent.hiddenModels";
const HIDDEN_MODELS_SEEDED_KEY = "onmyagent.hiddenModelsSeeded";

export function readHiddenModels(): Set<string> {
  try {
    const raw = window.localStorage.getItem(HIDDEN_MODELS_KEY);
    return new Set(raw ? JSON.parse(raw) : []);
  } catch {
    return new Set();
  }
}

export function writeHiddenModels(hidden: Set<string>): void {
  try {
    window.localStorage.setItem(HIDDEN_MODELS_KEY, JSON.stringify([...hidden]));
  } catch {
    // localStorage may be unavailable (private mode, quota); the modal will
    // fall back to in-memory state for the current session.
  }
}

export function hasSeededHiddenModels(): boolean {
  try {
    return window.localStorage.getItem(HIDDEN_MODELS_SEEDED_KEY) === "1";
  } catch {
    return false;
  }
}

export function markSeededHiddenModels(): void {
  try {
    window.localStorage.setItem(HIDDEN_MODELS_SEEDED_KEY, "1");
  } catch {
    // ignore
  }
}

/**
 * Seed the hidden models set on first run. For providers with curated
 * default-visible lists (OpenAI, Anthropic), hide everything except the top
 * picks defined in app/defaults/models.ts.
 */
export function seedHiddenModels(options: ModelOption[]): Set<string> {
  const hidden = new Set<string>();
  for (const opt of options) {
    if (!isDefaultVisibleModel(opt.providerID, opt.modelID)) {
      hidden.add(`${opt.providerID}/${opt.modelID}`);
    }
  }
  return hidden;
}
