const allowedDomainDependencies = new Set([
  "agents>connections",
  "agents>plugins",
  "agents>shell-feedback",
  "messaging>agents",
  "session>agents",
  "session>connections",
  "session>local-agents",
  "session>messaging",
  "session>shell-feedback",
  "session>workspace",
  "settings>connections",
  "settings>plugins",
  "settings>shell-feedback",
]);

export function domainDependencyIsAllowed(fromDomain, toDomain) {
  return allowedDomainDependencies.has(`${fromDomain}>${toDomain}`);
}

export function domainImportUsesPublicEntrypoint(domainRelativePath, toDomain) {
  return domainRelativePath === toDomain
    || domainRelativePath === `${toDomain}/index.ts`
    || domainRelativePath === `${toDomain}/index.tsx`
    || domainRelativePath === `${toDomain}/index.js`
    || domainRelativePath === `${toDomain}/index.jsx`
    || domainRelativePath === `${toDomain}/index.mjs`;
}

export function listAllowedDomainDependencies() {
  return [...allowedDomainDependencies].sort();
}
