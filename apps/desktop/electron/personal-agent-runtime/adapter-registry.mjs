import { createCodexAdapter } from "./adapters/codex.mjs";
import { createClaudeAdapter } from "./adapters/claude.mjs";
import { createHermesAdapter } from "./adapters/hermes.mjs";
import { createOpenClawAdapter } from "./adapters/openclaw.mjs";
import { createOpenCodeAdapter } from "./adapters/opencode.mjs";
import { createGenericAcpAdapter } from "./adapters/acp-generic.mjs";
import { createRemoteAcpAdapter } from "./adapters/remote-acp.mjs";
import { resolveAdapterFactoryForProvider } from "./run-helpers.mjs";

/**
 * Personal-runtime adapter factory map + provider lookup.
 * Injected adapters override built-ins for the same provider key.
 *
 * @param {{ injectedAdapters?: Record<string, any> }} [options]
 */
export function createAdapterRegistry({ injectedAdapters = {} } = {}) {
  const adapterFactories = {
    opencode: createOpenCodeAdapter,
    codex: createCodexAdapter,
    hermes: createHermesAdapter,
    claude: createClaudeAdapter,
    openclaw: createOpenClawAdapter,
    remote: createRemoteAcpAdapter,
    ...injectedAdapters,
  };

  function adapterFactoryForProvider(provider, agent = null) {
    return resolveAdapterFactoryForProvider(
      provider,
      agent,
      injectedAdapters,
      adapterFactories,
      createGenericAcpAdapter,
      createRemoteAcpAdapter,
    );
  }

  return { adapterFactories, adapterFactoryForProvider };
}
