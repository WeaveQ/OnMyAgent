#!/usr/bin/env node
import { runOnMyAgentPack } from './pack-onmyagent-marketplace.mjs';
import { runCodeBuddyPack } from './pack-codebuddy-plugin.mjs';
import { runOpenClawPack } from './pack-openclaw-skill.mjs';

const args = new Set(process.argv.slice(2));
const includeAll = args.has('--all');
const includeCodeBuddy = includeAll || args.has('--codebuddy');
const includeOpenClaw = includeAll || args.has('--openclaw');

console.log('开始构建发布包（主包：OnMyAgent）...');
runOnMyAgentPack();

if (includeCodeBuddy) {
  runCodeBuddyPack();
}
if (includeOpenClaw) {
  runOpenClawPack();
}

if (includeAll) {
  console.log('发布包构建完成（OnMyAgent + CodeBuddy + OpenClaw）。');
} else if (includeCodeBuddy || includeOpenClaw) {
  const extras = [
    includeCodeBuddy ? 'CodeBuddy' : null,
    includeOpenClaw ? 'OpenClaw' : null,
  ].filter(Boolean);
  console.log(`发布包构建完成（OnMyAgent + ${extras.join(' + ')}）。`);
} else {
  console.log('发布包构建完成（仅 OnMyAgent 主包）。');
}
