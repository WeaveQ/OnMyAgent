import type { ServerConfig } from "@onmyagent/types/server";
import type { ApprovalService } from "./approvals.js";
import { startPrimaryRuntimeArchiveProjector } from "./primary-runtime-archive-projector.js";
import {
  createPrimaryRuntimeServices,
  type PrimaryRuntimeServerPolicy,
} from "./primary-runtime-composition.js";
import type { AgentRuntimeAdapter } from "./primary-runtime-registry.js";
export type { PrimaryRuntimeServerPolicy, AgentRuntimeAdapter };

export function startPrimaryRuntimeServerLifecycle(input: {
  config: ServerConfig;
  approvals: ApprovalService;
  policy?: PrimaryRuntimeServerPolicy;
  additionalAdapters?: readonly AgentRuntimeAdapter[];
}) {
  const services = createPrimaryRuntimeServices({
    config: input.config,
    approvals: input.approvals,
    policy: input.policy,
    additionalAdapters: input.additionalAdapters,
  });
  const archive = startPrimaryRuntimeArchiveProjector({
    events: services.events,
    workspaces: input.config.workspaces,
    onError: (error) => {
      console.error("[onmyagent-server] Primary runtime archive projection failed", error);
    },
  });
  return {
    services,
    async stop() {
      services.registry.beginDrain();
      input.approvals.cancelAll();
      await services.registry.stop();
      await archive.stop();
    },
  };
}
