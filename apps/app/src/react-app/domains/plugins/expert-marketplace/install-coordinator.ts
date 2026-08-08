import type { ExpertPackageInstallInput } from "@onmyagent/types/desktop-ipc";

export type ExpertPackageInstaller = (
  input: ExpertPackageInstallInput,
) => Promise<unknown>;

function installationKey(input: ExpertPackageInstallInput) {
  return `${input.source}:${input.marketplace}:${input.packageName}`;
}

/**
 * Shares destructive expert installs between the summon and first-prompt paths.
 * A successful install remains valid for this renderer lifetime; a failure is
 * deliberately not cached so a later summon can retry it.
 */
export function createExpertPackageInstallCoordinator(
  install: ExpertPackageInstaller,
) {
  const installed = new Set<string>();
  const inFlight = new Map<string, Promise<void>>();

  return {
    ensure(input: ExpertPackageInstallInput): Promise<void> {
      const key = installationKey(input);
      if (installed.has(key)) return Promise.resolve();

      const existing = inFlight.get(key);
      if (existing) return existing;

      const operation = Promise.resolve()
        .then(() => install(input))
        .then(() => {
          installed.add(key);
        })
        .finally(() => {
          inFlight.delete(key);
        });
      inFlight.set(key, operation);
      return operation;
    },
  };
}
