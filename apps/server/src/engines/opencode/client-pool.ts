/**
 * Re-export of the OpenCode client pool from the legacy services location.
 * The pool itself stays put so existing importers (server composition root,
 * workspace routes) are untouched during P1; the SDK-bound leaf module moves
 * under engines/opencode/.
 */
export {
  createOpencodeClientPool,
  defaultOpencodeClientPool,
  getWorkspaceOpencodeClient,
  clearWorkspaceOpencodeClients,
  type OpencodeClientFactory,
  type OpencodeClientPool,
} from "../../services/opencode-client-pool.js";
