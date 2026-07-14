import type { OnMyAgentServerClient } from "./client";
import { splitOnMyAgentServerClient } from "./domains";

declare const client: OnMyAgentServerClient;

const domains = splitOnMyAgentServerClient(client);

void domains.system.health();
void domains.workspace.listWorkspaces();

// @ts-expect-error A workspace view must not expose system methods.
void domains.workspace.health();
// @ts-expect-error A system view must not expose workspace methods.
void domains.system.listWorkspaces();
