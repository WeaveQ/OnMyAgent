/**
 * Telegram channel store. Wraps the shared channel store under
 * userData/telegram. Credentials are persisted locally, never in the repo.
 */

import { createChannelStore } from "../channels/agent-store.mjs";

export function createTelegramStore(userDataDir) {
  if (!userDataDir) throw new Error("userDataDir is required for Telegram store");
  return createChannelStore({ rootDir: userDataDir, platformDir: "telegram" });
}

export default createTelegramStore;
