/**
 * Leaf Den types shared by den.ts and den-session-events.ts.
 * Kept free of side-effect imports so event helpers do not cycle through den.
 */

export type DenSettings = {
  baseUrl: string;
  apiBaseUrl?: string;
  authToken?: string | null;
  activeOrgId?: string | null;
  activeOrgSlug?: string | null;
  activeOrgName?: string | null;
};

export type DenUser = {
  id: string;
  email: string;
  name: string | null;
};
