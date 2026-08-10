/**
 * Org skill helpers + active-org session glue built on the Den client.
 */

import type { DenOrgSkillCard } from "../types";
import { createDenClient } from "./den-client";
import { readDenSettings, writeDenSettings } from "./den-session";

export async function saveInstalledSkillToOnMyAgentOrg(input: {
  skillText: string;
  shared?: "org" | "public" | null;
  skillHubId?: string | null;
}): Promise<{ skillId: string; orgId: string; orgName: string }> {
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  if (!token) {
    throw new Error("Sign in to OnMyAgent Cloud in Settings to share with your team.");
  }

  const cloudClient = createDenClient({ baseUrl: settings.baseUrl, apiBaseUrl: settings.apiBaseUrl, token });
  let orgId = settings.activeOrgId?.trim() ?? "";
  let orgSlug = settings.activeOrgSlug?.trim() ?? "";
  let orgName = settings.activeOrgName?.trim() ?? "";

  if (!orgSlug || !orgName || !orgId) {
    const response = await cloudClient.listOrgs();
    const match = orgId
      ? response.orgs.find((org) => org.id === orgId)
      : response.orgs.find((org) => org.slug === orgSlug) ?? response.orgs[0];
    if (!match) {
      throw new Error("Choose an organization in Settings -> Cloud before sharing with your team.");
    }
    orgId = match.id;
    orgSlug = match.slug;
    orgName = match.name;
    writeDenSettings({
      ...settings,
      baseUrl: settings.baseUrl,
      authToken: token,
      activeOrgId: orgId,
      activeOrgSlug: orgSlug,
      activeOrgName: orgName,
    });
  }

  const created = await cloudClient.createOrgSkill(orgId, {
    skillText: input.skillText,
    shared: input.shared === undefined ? null : input.shared,
  });

  const hubId = input.skillHubId?.trim() ?? "";
  if (hubId) {
    await cloudClient.addOrgSkillToHub(orgId, hubId, created.id);
  }

  return { skillId: created.id, orgId, orgName };
}

export async function fetchDenOrgSkillsCatalog(
  client: ReturnType<typeof createDenClient>,
  orgId: string,
): Promise<DenOrgSkillCard[]> {
  const [hubs, flatSkills] = await Promise.all([client.listOrgSkillHubs(orgId), client.listOrgSkills(orgId)]);
  const hubNameBySkillId = new Map<string, string>();
  for (const hub of hubs) {
    for (const skill of hub.skills) {
      if (!hubNameBySkillId.has(skill.id)) {
        hubNameBySkillId.set(skill.id, hub.name);
      }
    }
  }
  const byId = new Map<string, DenOrgSkillCard>();
  for (const skill of flatSkills) {
    byId.set(skill.id, {
      ...skill,
      hubName: hubNameBySkillId.get(skill.id) ?? null,
    });
  }
  return Array.from(byId.values()).toSorted((a, b) => a.title.localeCompare(b.title));
}

export async function ensureDenActiveOrganization(options?: { forceServerSync?: boolean }) {
  const settings = readDenSettings();
  const token = settings.authToken?.trim() ?? "";
  if (!token) {
    return null;
  }

  const client = createDenClient({
    baseUrl: settings.baseUrl,
    apiBaseUrl: settings.apiBaseUrl,
    token,
  });

  const response = await client.listOrgs();
  const selectedOrgId = settings.activeOrgId?.trim() ?? "";
  const selectedOrgSlug = settings.activeOrgSlug?.trim() ?? "";
  const targetOrg =
    response.orgs.find((org) => org.id === selectedOrgId) ??
    response.orgs.find((org) => org.slug === selectedOrgSlug) ??
    response.orgs.find((org) => org.id === response.activeOrgId) ??
    response.orgs.find((org) => org.slug === response.activeOrgSlug) ??
    response.orgs[0] ??
    null;

  if (!targetOrg) {
    writeDenSettings({
      ...settings,
      activeOrgId: null,
      activeOrgSlug: null,
      activeOrgName: null,
    }, { persistBootstrap: false });
    return null;
  }

  if (
    options?.forceServerSync &&
    (!response.activeOrgId || response.activeOrgId !== targetOrg.id)
  ) {
    await client.setActiveOrganization({ organizationId: targetOrg.id });
  }

  writeDenSettings({
    ...settings,
    activeOrgId: targetOrg.id,
    activeOrgSlug: targetOrg.slug,
    activeOrgName: targetOrg.name,
  }, { persistBootstrap: false });

  return targetOrg;
}
