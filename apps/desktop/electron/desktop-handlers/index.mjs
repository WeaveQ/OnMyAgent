import { HANDLER_COMMAND_NAMES as messagingCommands, createMessagingDomainHandlers } from "./messaging.mjs";
import { HANDLER_COMMAND_NAMES as localAgentsCommands, createLocalAgentsDomainHandlers } from "./local-agents.mjs";
import { HANDLER_COMMAND_NAMES as agentManagementCommands, createAgentManagementDomainHandlers } from "./agent-management.mjs";
import { HANDLER_COMMAND_NAMES as workspaceCommands, createWorkspaceDomainHandlers } from "./workspace.mjs";
import { HANDLER_COMMAND_NAMES as runtimeCommands, createRuntimeDomainHandlers } from "./runtime.mjs";
import { HANDLER_COMMAND_NAMES as opencodeCommands, createOpencodeDomainHandlers } from "./opencode.mjs";
import { HANDLER_COMMAND_NAMES as skillsCommands, createSkillsDomainHandlers } from "./skills.mjs";
import { HANDLER_COMMAND_NAMES as systemCommands, createSystemDomainHandlers } from "./system.mjs";

export {
  createMessagingDomainHandlers,
  createLocalAgentsDomainHandlers,
  createAgentManagementDomainHandlers,
  createWorkspaceDomainHandlers,
  createRuntimeDomainHandlers,
  createOpencodeDomainHandlers,
  createSkillsDomainHandlers,
  createSystemDomainHandlers,
};

/**
 * Static command names implemented by domain handler modules (no services required).
 *
 * Contract: must match `@onmyagent/types` `desktopCommandNames` **exactly**
 * (same multiset / sorted equality). Enforced by
 * `desktop-command-contract.test.mjs` and `domain-smoke.test.mjs`.
 * Each domain module exports `HANDLER_COMMAND_NAMES` for its slice; this list
 * is the flat union used by parity tests and bridge checks.
 *
 * @type {readonly string[]}
 */
export const DESKTOP_HANDLER_COMMANDS = Object.freeze([
  ...workspaceCommands,
  ...systemCommands,
  ...localAgentsCommands,
  ...messagingCommands,
  ...agentManagementCommands,
  ...opencodeCommands,
  ...runtimeCommands,
  ...skillsCommands,
]);

/**
 * Merge domain handler maps into one command → handler registry.
 * Later maps win on key collision (should not happen).
 * @param {...Record<string, Function>} maps
 */
export function mergeHandlers(...maps) {
  /** @type {Record<string, Function>} */
  const merged = {};
  for (const map of maps) {
    if (!map) continue;
    for (const [command, handler] of Object.entries(map)) {
      if (Object.prototype.hasOwnProperty.call(merged, command)) {
        throw new Error(`Desktop command is registered more than once: ${command}`);
      }
      merged[command] = handler;
    }
  }
  return merged;
}

/**
 * @param {Record<string, any>} deps
 */
export function createAllDesktopDomainHandlers(deps) {
  return mergeHandlers(
    createWorkspaceDomainHandlers(deps),
    createSystemDomainHandlers(deps),
    createLocalAgentsDomainHandlers(deps),
    createMessagingDomainHandlers(deps),
    createAgentManagementDomainHandlers(deps),
    createOpencodeDomainHandlers(deps),
    createRuntimeDomainHandlers(deps),
    createSkillsDomainHandlers(deps),
  );
}

/** @returns {readonly string[]} */
export function listImplementedDesktopCommands() {
  return DESKTOP_HANDLER_COMMANDS;
}
