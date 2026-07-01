import type { DesktopPolicyKey } from "@onmyagent/types/den/desktop-policies";
import type { DenDesktopConfig } from "../lib/den";
import type { ModelRef } from "../types";
import { isBlockedProvider, BLOCKED_PROVIDER_IDS } from "./blocked-providers";

export type DesktopAppRestrictionKey = DesktopPolicyKey;

export type DesktopAppRestrictionChecker = (input: {
  restriction: DesktopAppRestrictionKey;
}) => boolean;

export const DESKTOP_RESTRICTION_OPENCODE_PROVIDER_ID = BLOCKED_PROVIDER_IDS[0];

export function checkDesktopAppRestriction(input: {
  config: DenDesktopConfig | null | undefined;
  restriction: DesktopAppRestrictionKey;
}) {
  return input.config?.[input.restriction] === false;
}

export function isDesktopProviderBlocked(input: {
  providerId: string;
  checkRestriction: DesktopAppRestrictionChecker;
}) {
  const providerId = input.providerId.trim().toLowerCase();
  if (!providerId) return false;

  return isBlockedProvider(providerId);
}

export function isDesktopModelBlocked(input: {
  model: ModelRef;
  checkRestriction: DesktopAppRestrictionChecker;
}) {
  return isDesktopProviderBlocked({
    providerId: input.model.providerID,
    checkRestriction: input.checkRestriction,
  });
}

type DesktopAppRestrictionSyncContext = {
  checkRestriction: DesktopAppRestrictionChecker;
  reconcileRestrictedModels?: () => void;
  ensureProjectProviderDisabledState?: (
    providerId: string,
    disabled: boolean,
  ) => Promise<unknown>;
  onError?: (
    error: Error,
    details: {
      restriction: DesktopAppRestrictionKey;
      action: string;
      providerId?: string;
    },
  ) => void;
};

export async function runDesktopAppRestrictionSyncEffects(
  input: DesktopAppRestrictionSyncContext,
) {
  input.reconcileRestrictedModels?.();

  if (input.ensureProjectProviderDisabledState) {
    for (const providerId of BLOCKED_PROVIDER_IDS) {
      try {
        await input.ensureProjectProviderDisabledState(providerId, true);
      } catch (error) {
        input.onError?.(
          error instanceof Error
            ? error
            : new Error(String(error ?? "Desktop restriction effect failed.")),
          {
            restriction: "allowZenModel",
            action: "ensureProjectProviderDisabledState",
            providerId,
          },
        );
      }
    }
  }
}
