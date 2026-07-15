/**
 * Discord channel store. Wraps the shared channel store under
 * userData/discord. Credentials are persisted locally, never in the repo.
 */

import { createChannelStore } from "../channels/agent-store.mjs";

export function createDiscordStore(userDataDir) {
  if (!userDataDir) throw new Error("userDataDir is required for Discord store");
  return createChannelStore({ rootDir: userDataDir, platformDir: "discord" });
}

export default createDiscordStore;
