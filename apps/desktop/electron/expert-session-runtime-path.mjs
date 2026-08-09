import path from "node:path";

export function resolveExpertSessionRuntimeRoot(userDataDir) {
  return path.join(userDataDir, "expert-sessions");
}
