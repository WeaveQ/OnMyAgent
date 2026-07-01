import fs from 'fs';
import path from 'path';
import { spawnSync } from 'child_process';
import { checkNodeEnv } from './node-env-check.mjs';

export const CACHE_TTL_MS = 60 * 60 * 1000;
export const SKILL_TARGET_VERSION = '2.1.2';
export const ONMYAGENT_REQUIRED_PLUGINS = [
  'pptx',
  'pdf',
  'docx',
  'xlsx',
  'playwright-cli',
  'find-skills',
];

export const ONMYAGENT_RELEVANT_TIER1_SKILLS = [
  'deep-research',
  'multi-search-engine',
  'citation-manager',
  'minimax-docx',
  'minimax-pdf',
  'content-ops',
  'deck-generator',
  'pptx-generator',
  'content-factory',
  'content-repurposer',
  'notebooklm-studio',
  'autoresearch',
  'humanizer',
  'web-search-exa',
  'wechat-article-search',
  'nano-pdf',
  'agent-team-orchestration',
];

function pathExists(targetPath) {
  return !!targetPath && fs.existsSync(targetPath);
}

function safeReadJson(filePath, fallback = null) {
  if (!pathExists(filePath)) return fallback;
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return fallback;
  }
}

function uniqueSorted(values) {
  return [...new Set((values || []).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'en'));
}

function intersect(left = [], right = []) {
  const rightSet = new Set(right);
  return left.filter(item => rightSet.has(item));
}

function detectGit(cwd) {
  try {
    const result = spawnSync('git', ['--version'], { cwd, encoding: 'utf8', timeout: 3000 });
    if (result.status === 0) {
      const version = (result.stdout || '').trim().split(' ').pop();
      return { available: true, version };
    }
  } catch {
    // ignore
  }
  return { available: false };
}

function readVersionFromJson(filePath, pointer) {
  const json = safeReadJson(filePath, null);
  if (!json) return null;
  try {
    const parts = String(pointer || '').split('.').filter(Boolean);
    let node = json;
    for (const key of parts) {
      node = node?.[key];
      if (node == null) return null;
    }
    return typeof node === 'string' ? node.trim() || null : null;
  } catch {
    return null;
  }
}

function collectSkillVersionObservability(skillRoot) {
  const manifestVersion = readVersionFromJson(path.join(skillRoot, 'onmyagent', 'channel-manifest.json'), 'skill.version');
  const packageVersion = readVersionFromJson(path.join(skillRoot, 'package.json'), 'version');
  const pluginMetaVersion = readVersionFromJson(path.join(skillRoot, '_plugin_meta.json'), 'version');
  const runtimeVersion = manifestVersion || packageVersion || pluginMetaVersion || null;
  const mismatch = uniqueSorted([manifestVersion, packageVersion, pluginMetaVersion].filter(Boolean)).length > 1;
  return {
    runtime: runtimeVersion,
    target: SKILL_TARGET_VERSION,
    sources: {
      onmyagentChannelManifest: manifestVersion,
      packageJson: packageVersion,
      pluginMeta: pluginMetaVersion,
    },
    mismatch,
    upgradeMode: 'overwrite-code',
    recommendUpgrade: !!runtimeVersion && runtimeVersion !== SKILL_TARGET_VERSION,
  };
}

function evaluateDataCompatibility(bookRoot, markers) {
  const fbsDir = path.join(bookRoot, '.fbs');
  const issues = [];
  const resumePath = path.join(fbsDir, 'onmyagent-resume.json');
  const hostCapPath = path.join(fbsDir, 'host-capability.json');
  if (pathExists(resumePath)) {
    const resume = safeReadJson(resumePath, null);
    if (resume) {
      if (resume.$schema !== 'fbs-session-resume-v1') {
        issues.push('resume_schema_legacy');
      }
      if (!Object.prototype.hasOwnProperty.call(resume, 'nextRecommendations')) {
        issues.push('resume_missing_next_recommendations');
      }
    } else {
      issues.push('resume_json_invalid');
    }
  }
  if (pathExists(hostCapPath)) {
    const hostCap = safeReadJson(hostCapPath, null);
    if (hostCap && !hostCap.$schema) {
      issues.push('host_capability_schema_legacy');
    }
  }
  if (!markers?.memoryDirExists && markers?.legacyMemeryDirExists) {
    issues.push('legacy_memery_only');
  }

  return {
    status: issues.length > 0 ? 'needs_migration' : 'compatible',
    issueCount: issues.length,
    issues,
    mode: issues.length > 0 ? 'compatibility' : 'standard',
    note:
      issues.length > 0
        ? '覆盖升级后检测到历史数据结构差异，已进入兼容模式（不阻断主流程）。'
        : '当前数据结构与 2.1.2 兼容。',
  };
}

export function resolveOnMyAgentHome(env = process.env) {
  const explicitHome = env.ONMYAGENT_HOME;
  if (explicitHome) return path.resolve(explicitHome);

  const homeDir = env.USERPROFILE || env.HOME || '';
  if (!homeDir) return path.resolve('.onmyagent');
  return path.join(homeDir, '.onmyagent');
}

export function resolveOnMyAgentPaths(env = process.env) {
  const homeDir = resolveOnMyAgentHome(env);
  const skillsMarketplaceRoot = path.join(homeDir, 'skills-marketplace');
  return {
    homeDir,
    settingsPath: path.join(homeDir, 'settings.json'),
    skillsMarketplaceRoot,
    skillsMarketplaceSkillsDir: path.join(skillsMarketplaceRoot, 'skills'),
    installedSkillsDir: path.join(homeDir, 'skills'),
    connectorsMarketplaceDir: path.join(homeDir, 'connectors-marketplace'),
    userProfilePath: path.join(homeDir, 'USER.md'),
    identityPath: path.join(homeDir, 'IDENTITY.md'),
    soulPath: path.join(homeDir, 'SOUL.md'),
    memoryDir: path.join(homeDir, 'memory'),
    legacyMemeryDir: path.join(homeDir, 'memery'),
  };
}


function parseEnabledPlugins(settingsJson) {
  const enabledPlugins = settingsJson?.enabledPlugins || {};
  return uniqueSorted(
    Object.entries(enabledPlugins)
      .filter(([, enabled]) => enabled === true)
      .map(([pluginId]) => String(pluginId).split('@')[0].trim()),
  );
}

function collectTier1Availability(skillsDir, skillNames = ONMYAGENT_RELEVANT_TIER1_SKILLS) {
  const checked = uniqueSorted(skillNames);
  const available = checked.filter((skillName) => pathExists(path.join(skillsDir, skillName)));
  const missing = checked.filter((skillName) => !available.includes(skillName));
  return {
    checked,
    available,
    missing,
    availableCount: available.length,
  };
}

function detectHostType(markers) {
  if (
    markers.onmyagentHomeExists
    || markers.settingsExists
    || markers.skillsMarketplaceRootExists
    || markers.installedSkillsDirExists
  ) {
    return 'onmyagent';
  }
  return 'node-cli';
}

function resolveRoutingMode(hostType, nodeEnv) {
  const hasScript = nodeEnv.ok;
  if (hostType === 'onmyagent' && hasScript) return 'hybrid';
  if (hasScript) return 'script-only';
  return 'dialog-only';
}

/** 读取 ~/.onmyagent/binaries/.cache/registry.json（托管运行时登记） */
export function readBinaryToolchainRegistry(homeDir) {
  const p = path.join(homeDir, 'binaries', '.cache', 'registry.json');
  if (!pathExists(p)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const pyVersions = raw.binaries?.python ? Object.keys(raw.binaries.python) : [];
    const pyLatest = pyVersions.length ? pyVersions.sort().slice(-1)[0] : null;
    const nodeCached = raw.systemDetectionCache?.node;
    return {
      registryVersion: raw.version ?? null,
      lastUpdated: raw.lastUpdated ?? null,
      pythonManagedVersion: pyLatest,
      pythonManagedPath: pyLatest && raw.binaries?.python?.[pyLatest]?.executablePath
        ? raw.binaries.python[pyLatest].executablePath
        : null,
      nodeDetectedPath: nodeCached?.path || null,
      nodeDetectedVersion: nodeCached?.version || null,
    };
  } catch {
    return null;
  }
}

function buildRecommendedActions(hostType, tier1Availability, enabledPlugins, missingPlugins) {
  const actions = [];
  if (hostType === 'onmyagent') {
    actions.push('优先读取 .fbs/onmyagent-resume.json，走恢复优先开场');
    if (tier1Availability.availableCount > 0) {
      actions.push(`可优先使用 OnMyAgent 本地市场技能：${tier1Availability.available.slice(0, 6).join('、')}`);
    }
    if (enabledPlugins.length > 0) {
      actions.push(`已启用 OnMyAgent 插件：${enabledPlugins.join('、')}`);
    }
    if (missingPlugins.length > 0) {
      actions.push(`以下插件当前未启用：${missingPlugins.join('、')}`);
    }
    return actions;
  }

  actions.push('未检测到 OnMyAgent 宿主，按脚本模式降级运行');
  return actions;
}

export function createOnMyAgentHostSnapshot({ bookRoot, skillRoot } = {}) {
  const resolvedBookRoot = path.resolve(bookRoot || process.cwd());
  const resolvedSkillRoot = path.resolve(skillRoot || process.cwd());
  const onmyagent = resolveOnMyAgentPaths();
  const settings = safeReadJson(onmyagent.settingsPath, {});
  const nodeEnv = checkNodeEnv('18.0.0');
  const git = detectGit(resolvedBookRoot);

  const markers = {
    onmyagentHomeExists: pathExists(onmyagent.homeDir),
    settingsExists: pathExists(onmyagent.settingsPath),
    skillsMarketplaceRootExists: pathExists(onmyagent.skillsMarketplaceRoot),
    skillsMarketplaceSkillsExists: pathExists(onmyagent.skillsMarketplaceSkillsDir),
    installedSkillsDirExists: pathExists(onmyagent.installedSkillsDir),
    userProfileExists: pathExists(onmyagent.userProfilePath),
    identityExists: pathExists(onmyagent.identityPath),
    soulExists: pathExists(onmyagent.soulPath),
    memoryDirExists: pathExists(onmyagent.memoryDir),
    legacyMemeryDirExists: pathExists(onmyagent.legacyMemeryDir),
    channelManifestExists: pathExists(path.join(resolvedSkillRoot, 'onmyagent', 'channel-manifest.json')),
  };


  const hostType = detectHostType(markers);
  const enabledPlugins = parseEnabledPlugins(settings);
  const availablePlugins = intersect(ONMYAGENT_REQUIRED_PLUGINS, enabledPlugins);
  const missingPlugins = ONMYAGENT_REQUIRED_PLUGINS.filter(name => !availablePlugins.includes(name));
  const tier1Availability = collectTier1Availability(onmyagent.skillsMarketplaceSkillsDir);
  const routingMode = resolveRoutingMode(hostType, nodeEnv);
  const binaryToolchain = readBinaryToolchainRegistry(onmyagent.homeDir);
  const onmyagentGenieVersion = process.env.ONMYAGENT_GENIE_VERSION || process.env.ONMYAGENT_VERSION || null;
  const skillVersion = collectSkillVersionObservability(resolvedSkillRoot);
  const dataCompatibility = evaluateDataCompatibility(resolvedBookRoot, markers);

  return {
    $schema: 'fbs-onmyagent-host-capability-v2',
    detectedAt: new Date().toISOString(),
    cacheTtlMinutes: 60,
    channel: 'onmyagent-marketplace',
    hostType,
    bookRoot: resolvedBookRoot,
    skillRoot: resolvedSkillRoot,
    nodeEnv: {
      ok: nodeEnv.ok,
      version: nodeEnv.version,
      execPath: nodeEnv.execPath,
      minRequired: '18.0.0',
      ...(nodeEnv.error ? { warning: nodeEnv.error } : {}),
    },
    git,
    onmyagent: {
      homeDir: onmyagent.homeDir,
      settingsPath: onmyagent.settingsPath,
      skillsMarketplaceRoot: onmyagent.skillsMarketplaceRoot,
      skillsMarketplaceSkillsDir: onmyagent.skillsMarketplaceSkillsDir,
      installedSkillsDir: onmyagent.installedSkillsDir,
      profilePaths: {
        userProfilePath: onmyagent.userProfilePath,
        identityPath: onmyagent.identityPath,
        soulPath: onmyagent.soulPath,
        preferredMemoryDir: onmyagent.memoryDir,
        memoryDir: onmyagent.memoryDir,
        legacyMemeryDir: onmyagent.legacyMemeryDir,
      },

    },
    markers,
    plugins: {
      requiredTier2: ONMYAGENT_REQUIRED_PLUGINS,
      enabled: enabledPlugins,
      available: availablePlugins,
      missing: missingPlugins,
    },
    tier1: {
      marketplaceAvailable: markers.skillsMarketplaceSkillsExists,
      relevantSkills: tier1Availability,
      marketplaceSummary: `${tier1Availability.available.length}/${tier1Availability.checked.length}`,
      marketplaceSummaryNote:
        '已安装/可探测的 Tier1 技能数与仓库声明的相关技能总数之比；未全部安装为正常情况，将按 provider 降级链路执行',
    },
    onmyagentFeatures: {
      resumeSnapshotSupported: true,
      profileBridgeAvailable: markers.userProfileExists || markers.identityExists || markers.soulExists || markers.memoryDirExists || markers.legacyMemeryDirExists,
      presentationBridgeSupported: true,
      packagedChannelManifest: markers.channelManifestExists ? path.join(resolvedSkillRoot, 'onmyagent', 'channel-manifest.json') : null,
    },
    binaryToolchain,
    onmyagentGenieVersion,
    skillVersion,
    dataCompatibility,

    routingMode,
    routingModeExplain: {
      hybrid: 'OnMyAgent 宿主能力 + 本地脚本双轨可用，按恢复优先模式运行',
      'script-only': '仅脚本能力可用，宿主增强信息缺失',
      'dialog-only': '脚本与宿主增强均不可用，全部降级为对话模式',
    }[routingMode] || routingMode,
    recommendedEntry: hostType === 'onmyagent' ? 'resume-first' : 'script-only',
    compatibilityMode: dataCompatibility.mode,
    recommendedActions: buildRecommendedActions(hostType, tier1Availability, availablePlugins, missingPlugins),
  };
}

export function readCachedHostSnapshot(cachePath) {
  const cached = safeReadJson(cachePath, null);
  if (!cached?.detectedAt) return null;
  const age = Date.now() - new Date(cached.detectedAt).getTime();
  if (Number.isNaN(age) || age > CACHE_TTL_MS) return null;
  return cached;
}

export function writeHostSnapshot(cachePath, snapshot) {
  fs.mkdirSync(path.dirname(cachePath), { recursive: true });
  fs.writeFileSync(cachePath, JSON.stringify(snapshot, null, 2), 'utf8');
  return cachePath;
}
