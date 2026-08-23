/**
 * Persistent memory of catalog agents that have already been auto-adopted into
 * the user's custom-agent store. Keyed by a stable agent fingerprint so that
 * reopening 管理 does not re-run `personalLocalAgentCreateCustomAgent` (which
 * used to trigger a forced core rescan after every adopt sweep).
 *
 * Storage shape:
 *   {
 *     version: 1,
 *     adopted: { [fingerprint]: { adoptedAt: number } }
 *   }
 *
 * The fingerprint includes id + provider + executable path so that an upgrade
 * that moves the binary re-adopts once, while the same install keeps hitting
 * the cache across restarts.
 */

const STORAGE_KEY = "onmyagent.agentManagement.autoAdopted.v1";
const STORAGE_VERSION = 1;

type AdoptedMap = Record<string, { adoptedAt: number }>;
type AdoptedStore = { version: number; adopted: AdoptedMap };

function canUseStorage(): boolean {
  try {
    return typeof window !== "undefined" && !!window.localStorage;
  } catch {
    return false;
  }
}

// In-memory fallback used when localStorage is unavailable (SSR, tests,
// security mode, quota errors). It still de-dups within a process so the
// auto-adopt sweep does not loop in the same session.
const memoryStore: AdoptedStore = { version: STORAGE_VERSION, adopted: {} };

function readStore(): AdoptedStore {
  if (!canUseStorage()) return memoryStore;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return { version: STORAGE_VERSION, adopted: {} };
    const parsed = JSON.parse(raw) as Partial<AdoptedStore>;
    if (parsed.version !== STORAGE_VERSION || !parsed.adopted) {
      return { version: STORAGE_VERSION, adopted: {} };
    }
    return { version: STORAGE_VERSION, adopted: parsed.adopted };
  } catch {
    return memoryStore;
  }
}

function writeStore(store: AdoptedStore): void {
  if (!canUseStorage()) {
    memoryStore.adopted = store.adopted;
    return;
  }
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // localStorage quota / security mode — fall back to in-memory only.
    memoryStore.adopted = store.adopted;
  }
}

/**
 * Fingerprint used to decide whether an agent has already been adopted on this
 * machine. We use id + provider + executable path (when known); version is not
 * part of the key because auto-adopt is idempotent against the store and a
 * version bump should not resurface a "new agent" toast.
 */
export function autoAdoptFingerprint(agent: {
  id?: string | null;
  provider?: string | null;
  executablePath?: string | null;
}): string {
  const id = String(agent.id ?? "").trim().toLowerCase();
  const provider = String(agent.provider ?? "").trim().toLowerCase();
  const path = String(agent.executablePath ?? "").trim();
  return `${id}|${provider}|${path}`;
}

/** True when this exact agent has already been auto-adopted in a prior run. */
export function hasAutoAdopted(agent: {
  id?: string | null;
  provider?: string | null;
  executablePath?: string | null;
}): boolean {
  const store = readStore();
  return Boolean(store.adopted[autoAdoptFingerprint(agent)]);
}

/** Remember that an agent was successfully adopted. */
export function markAutoAdopted(agent: {
  id?: string | null;
  provider?: string | null;
  executablePath?: string | null;
}): void {
  const store = readStore();
  const key = autoAdoptFingerprint(agent);
  if (store.adopted[key]) return;
  store.adopted[key] = { adoptedAt: Date.now() };
  writeStore(store);
}

/** Test helper: wipe the persisted memory. */
export function resetAutoAdoptedForTests(): void {
  memoryStore.adopted = {};
  writeStore({ version: STORAGE_VERSION, adopted: {} });
}
