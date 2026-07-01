import type { HubSkillRepo } from "../../../../app/types";
import { parseStoredHubRepos, serializeHubRepos } from "./extensions-store-model";

const HUB_REPOS_STORAGE_KEY = "onmyagent.skills.hubRepos.v1";

type HubRepoStorage = Pick<Storage, "getItem" | "setItem">;

export function persistStoredHubReposToStorage(
  storage: HubRepoStorage,
  input: { selected: HubSkillRepo | null; repos: HubSkillRepo[] },
) {
  storage.setItem(HUB_REPOS_STORAGE_KEY, serializeHubRepos(input));
}

export function readStoredHubReposFromStorage(storage: Pick<Storage, "getItem">) {
  return parseStoredHubRepos(storage.getItem(HUB_REPOS_STORAGE_KEY));
}

export function persistStoredHubRepos(input: { selected: HubSkillRepo | null; repos: HubSkillRepo[] }) {
  if (typeof window === "undefined") return;
  try {
    persistStoredHubReposToStorage(window.localStorage, input);
  } catch {}
}

export function readStoredHubRepos() {
  if (typeof window === "undefined") return null;
  try {
    return readStoredHubReposFromStorage(window.localStorage);
  } catch {
    return null;
  }
}
