import {
  readUserAgentRegistry,
  writeUserAgentRegistry,
} from "../../../app/lib/desktop";
import { isElectronRuntime } from "../../../app/utils";
import {
  createDefaultAgentRegistry,
  parseUserAgentRegistry,
  serializeUserAgentRegistry,
} from "./agent-registry";
import { useAgentRegistryStore } from "./agent-registry-store";
import type { AgentRecord, AgentRegistry } from "./agent-registry-types";
import {
  registerImportedMineExpert,
  type ImportedMineExpertSeed,
} from "./expert-creation-save-model";

export type { ImportedMineExpertSeed };

async function loadBaseRegistry(): Promise<AgentRegistry> {
  const cached = useAgentRegistryStore.getState().registry;
  if (cached) return cached;
  if (isElectronRuntime()) {
    try {
      const file = await readUserAgentRegistry();
      if (file?.content) return parseUserAgentRegistry(file.content);
    } catch {
      // Fall through to the in-memory default.
    }
  }
  return createDefaultAgentRegistry();
}

export async function persistImportedMineExpert(
  seed: ImportedMineExpertSeed,
): Promise<{ agent: AgentRecord; registry: AgentRegistry }> {
  const next = registerImportedMineExpert({
    ...seed,
    registry: await loadBaseRegistry(),
    nowIso: new Date().toISOString(),
  });
  if (isElectronRuntime()) {
    await writeUserAgentRegistry(serializeUserAgentRegistry(next.registry));
  }
  useAgentRegistryStore.getState().setRegistry(next.registry);
  return next;
}
