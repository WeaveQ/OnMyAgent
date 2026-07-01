#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { runChannelPack } from './lib/channel-pack.mjs';

export function runOnMyAgentPack() {
  return runChannelPack({
    version: '2.1.2',
    packageName: 'fbs-bookwriter-v212-onmyagent',
    packageRootName: 'fbs-bookwriter',
    channelLabel: 'OnMyAgent Marketplace',
    requiredDirs: [
      'onmyagent/',
      'codebuddy/',
      '.codebuddy/agents/',
      '.codebuddy/providers/',
      '.codebuddy-plugin/',
    ],
    coreFiles: [
      'onmyagent/channel-manifest.json',
      'codebuddy/channel-manifest.json',
      'codebuddy/agents/fbs-team-lead.md',
      '.codebuddy/agents/fbs-team-lead.md',
      '.codebuddy/providers/provider-registry.yml',
      '.codebuddy-plugin/plugin.json',
      'releases/onmyagent-review-v2.1.2.md',
    ],
  });
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1] === fileURLToPath(import.meta.url)) {
  runOnMyAgentPack();
}
