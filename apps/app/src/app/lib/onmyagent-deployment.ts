export const ONMYAGENT_DEPLOYMENT_ENV_VAR = "VITE_ONMYAGENT_DEPLOYMENT";

export type OnMyAgentDeployment = "desktop" | "web";

function normalizeDeployment(value: string | undefined): OnMyAgentDeployment {
  const normalized = value?.trim().toLowerCase();
  return normalized === "web" ? "web" : "desktop";
}

export function getOnMyAgentDeployment(): OnMyAgentDeployment {
  const envValue =
    typeof import.meta !== "undefined" && typeof import.meta.env?.VITE_ONMYAGENT_DEPLOYMENT === "string"
      ? import.meta.env.VITE_ONMYAGENT_DEPLOYMENT
      : undefined;

  return normalizeDeployment(envValue);
}

export function isWebDeployment(): boolean {
  return getOnMyAgentDeployment() === "web";
}

export function isDesktopDeployment(): boolean {
  return getOnMyAgentDeployment() === "desktop";
}
