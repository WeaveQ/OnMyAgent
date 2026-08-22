import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

export const TEST_GATE_WORKFLOW_FILES = [
  ".github/workflows/ci-tests.yml",
  ".github/workflows/pr-gates.yml",
];

export const TEST_GATE_REQUIRED_BRANCHES = ["dev", "release/0.6"];

/** Collect `on.pull_request.branches` / `on.push.branches` list items. */
export function extractWorkflowOnBranches(yamlText) {
  const onBlock = yamlText.match(
    /^on:\n([\s\S]*?)(?=\n(?:permissions|jobs|env|concurrency|defaults|run-name):|\n[A-Za-z])/m,
  );
  if (!onBlock) return new Set();
  const names = new Set();
  let inBranches = false;
  for (const rawLine of onBlock[1].split("\n")) {
    const line = rawLine.replace(/\s+#.*$/, "");
    if (/^\s+branches:\s*$/.test(line)) {
      inBranches = true;
      continue;
    }
    if (inBranches) {
      const item = line.match(/^\s+- (\S+)\s*$/);
      if (item) {
        names.add(item[1]);
        continue;
      }
      inBranches = false;
    }
  }
  return names;
}

function readRepo(relPath) {
  return readFileSync(join(repoRoot, relPath), "utf8");
}

export function checkDocsCommandSot(root = repoRoot) {
  const findings = [];
  const read = (relPath) => readFileSync(join(root, relPath), "utf8");

  const commandFiles = [
    "README.md",
    "README-zh.md",
    "docs/Architecture.md",
    "docs/loop/rules.md",
    ".agents/skills/documentation-audit/SKILL.md",
    ".agents/skills/frontend-primitive-refactor/SKILL.md",
    ".agents/skills/ui-regression-audit/SKILL.md",
  ];

  for (const file of commandFiles) {
    const text = read(file);
    if (/(?:^|[^\n])pnpm test:app /.test(text) && !text.includes("pnpm --filter @onmyagent/app test:app")) {
      findings.push(`${file}: root pnpm test:app without the app filter`);
    }
    if (file === "docs/Architecture.md") {
      if (!text.includes("pnpm --filter @onmyagent/app test:app desktop-fetch-policy")) {
        findings.push(`${file}: missing filtered desktop-fetch-policy test command`);
      }
      if (!text.includes("pnpm --filter @onmyagent/app test:app dev-log")) {
        findings.push(`${file}: missing filtered dev-log test command`);
      }
    }
    if (file === "README.md" || file === "README-zh.md" || file === "docs/loop/rules.md") {
      if (!text.includes("pnpm task graphify build")) {
        findings.push(`${file}: missing pnpm task graphify build`);
      }
    }
    if (/不要常规使用 `--force`|Do not use `graphify update \. --force` unless/.test(text)) {
      findings.push(`${file}: still forbids --force against the graphify wrapper`);
    }
  }

  const skillFiles = [
    ".agents/skills/documentation-audit/SKILL.md",
    ".agents/skills/frontend-primitive-refactor/SKILL.md",
    ".agents/skills/ui-regression-audit/SKILL.md",
  ];
  for (const file of skillFiles) {
    const text = read(file);
    if (/sed -n '1,220p' docs\/design\/theme-system\.md/.test(text)) {
      findings.push(`${file}: still reads theme-system.md as the first UI SoT`);
    }
    if (/Keep tracked state docs such as `docs\/LOOP-RUN-LOG\.md`/.test(text)) {
      findings.push(`${file}: still treats deleted stub files as keep-pointers`);
    }
  }

  const audit = read(".agents/skills/documentation-audit/SKILL.md");
  for (const needle of [
    "officecli-oss-release.md",
    "windows-compat.md",
    "windows-remote-debug-from-mac.md",
    "docs/superpowers/",
  ]) {
    if (!audit.includes(needle)) {
      findings.push(`documentation-audit SKILL.md: missing ${needle}`);
    }
  }

  const zhSettings = read("website/docs/guide/settings.md");
  const enSettings = read("website/docs/en/guide/settings.md");
  const zhMemory = read("website/docs/guide/memory.md");
  const enMemory = read("website/docs/en/guide/memory.md");
  if (!zhSettings.includes("| 个人 | **资料** |")) {
    findings.push("zh settings handbook: tab is not 资料");
  }
  if (!enSettings.includes("| Personal | **Profile** |")) {
    findings.push("en settings handbook: tab is not Profile");
  }
  if (!zhMemory.includes("## 1. 资料")) {
    findings.push("zh memory handbook: Profile section is not 资料");
  }
  if (!enMemory.includes("## 1. Profile")) {
    findings.push("en memory handbook: Profile section is not Profile");
  }

  const overview = read("website/docs/guide/overview.md");
  const projects = read("website/docs/guide/projects.md");
  if (!overview.includes("主栏入口已隐藏")) {
    findings.push("zh overview: Projects rail is not described as hidden");
  }
  if (!projects.includes("不再显示")) {
    findings.push("zh projects: rail hide copy missing");
  }

  const design = read("DESIGN.md");
  if (/document:\s*radix-slate-9/.test(design)) {
    findings.push("DESIGN.md: document hue is still radix-slate-9");
  }
  if (!/document:\s*radix-indigo-9/.test(design)) {
    findings.push("DESIGN.md: artifact-hue.document is not indigo");
  }
  if (design.includes("solid `--ow-primary`")) {
    findings.push("DESIGN.md: Do's still prescribe solid --ow-primary");
  }
  if (/for engineers, tinkerers/.test(design)) {
    findings.push("DESIGN.md: §1 audience is still engineer/tinkerer/knowledge-worker only");
  }

  const architecture = read("docs/Architecture.md");
  if (!architecture.includes("    task-center/")) {
    findings.push("Architecture.md: domain tree missing task-center/");
  }
  for (const group of ["knowledge", "company", "computerUse", "managedTools"]) {
    if (!architecture.includes(group)) {
      findings.push(`Architecture.md: desktop-handler groups missing ${group}`);
    }
  }
  if (!architecture.includes("session→knowledge") && !architecture.includes("session>knowledge")) {
    findings.push("Architecture.md: missing session→knowledge policy edge");
  }
  if (/settings→session/.test(architecture)) {
    findings.push("Architecture.md: lists settings→session which policy does not allow");
  }
  if (architecture.includes("GRAPH_REPORT.md")) {
    findings.push("Architecture.md: still presents GRAPH_REPORT.md as a reading artifact");
  }

  const reactArch = read("apps/app/src/react-app/ARCHITECTURE.md");
  if (!reactArch.includes("account-avatar/")) {
    findings.push("ARCHITECTURE.md: capabilities tree missing account-avatar/");
  }
  if (!reactArch.includes("context-usage/")) {
    findings.push("ARCHITECTURE.md: capabilities tree missing context-usage/");
  }
  if (/session\/voice|├── voice\//.test(reactArch)) {
    findings.push("ARCHITECTURE.md: still lists deleted session/voice/");
  }
  if (!reactArch.includes("expert-surface-machine.ts")) {
    findings.push("ARCHITECTURE.md: Expert surface files not described at pages/");
  }
  if (/Appshot is macOS-only/.test(reactArch)) {
    findings.push("ARCHITECTURE.md: Appshot is still described as macOS-only");
  }
  if (!/Appshot/.test(reactArch) || !/Windows/.test(reactArch) || !/Linux/.test(reactArch)) {
    findings.push("ARCHITECTURE.md: Appshot must name macOS, Windows, and Linux");
  }
  if (!reactArch.includes("session-archive-resume")) {
    findings.push("ARCHITECTURE.md: local-agents missing archive-resume Dual Runtime exception");
  }

  if (/opencode\.ts\(SDK\) ← opencode binary/.test(architecture)) {
    findings.push("Architecture.md: still presents SDK ← opencode binary as shipped topology");
  }
  if (/OpenCode \+ approval router \/ Slack \/ Telegram/.test(architecture)) {
    findings.push("Architecture.md: still hangs Slack/Telegram off the optional orchestrator as the IM path");
  }
  if (!architecture.includes("`#task`/`/task`")) {
    findings.push("Architecture.md: Dual Runtime IM path missing #task / /task");
  }
  const dualRuntimeHeading = architecture.indexOf("## Dual Runtime Boundary");
  const archiveRuntimeHeading = architecture.indexOf("## Server Archive Runtime");
  const dualRuntime =
    dualRuntimeHeading >= 0 && archiveRuntimeHeading > dualRuntimeHeading
      ? architecture.slice(dualRuntimeHeading, archiveRuntimeHeading)
      : "";
  if (!dualRuntime.includes("session-archive-resume") || !dualRuntime.includes("useArchiveResume")) {
    findings.push("Architecture.md: Dual Runtime missing archive-resume named exception");
  }
  if (!dualRuntime.includes("单向")) {
    findings.push("Architecture.md: archive-resume exception must be named as a one-way copy");
  }

  const appshotHeading = architecture.indexOf("Computer Use / Appshot");
  const appshotImpl = architecture.indexOf("实现入口");
  const appshotSection =
    appshotHeading >= 0 && appshotImpl > appshotHeading
      ? architecture.slice(appshotHeading, appshotImpl)
      : "";
  if (!appshotSection.includes("Composer Appshot")) {
    findings.push("Architecture.md: product-platform table missing Composer Appshot");
  }
  if (!/macOS/.test(appshotSection) || !/Windows/.test(appshotSection) || !/Linux/.test(appshotSection)) {
    findings.push("Architecture.md: Appshot product-platform table must name macOS, Windows, and Linux");
  }
  const appshotRow = appshotSection.split("\n").find((line) => line.includes("Composer Appshot")) ?? "";
  if (/非产品目标|勿当支持承诺/.test(appshotRow)) {
    findings.push("Architecture.md: Appshot row still treats a platform as unsupported");
  }

  const filesSpec = read("docs/design/files-module-product-spec.md");
  if (/默认打开 Tab[：:].*用户上传/.test(filesSpec)) {
    findings.push("files-module-product-spec.md: default Files tab is still 用户上传");
  }
  if (!/默认打开 Tab[：:].*任务/.test(filesSpec) && !/DEFAULT_FILES_SOURCE_TAB/.test(filesSpec)) {
    findings.push("files-module-product-spec.md: default Files tab is not 任务 / task");
  }
  if (/文件跟工作区、不跟会话陪葬/.test(filesSpec) || /删会话\/归档默认不删文件/.test(filesSpec)) {
    findings.push("files-module-product-spec.md: leftover keep-files default contradicts C1 unlink");
  }
  if (/删会话默认留生成文件/.test(filesSpec)) {
    findings.push("files-module-product-spec.md: leftover keep-generated-files default");
  }
  const filesP0 = filesSpec.split("\n").find((line) => line.includes("**P0**")) ?? "";
  if (!/C1/.test(filesP0) || !/连删|unlink/.test(filesP0)) {
    findings.push("files-module-product-spec.md: P0 row missing landed C1 unlink");
  }

  const memoryPlan = read("docs/design/2026-08-02-work-memory-plan.md");
  if (/默认 `autoCaptureMode = confirm_first`/.test(memoryPlan)) {
    findings.push("work-memory-plan.md: still states confirm_first as the shipped default");
  }
  if (/^\| 6 \| confirm_first；pending 与 UI 同交付 \|/m.test(memoryPlan)) {
    findings.push("work-memory-plan.md: decision #6 still locks pending confirm_first as shipped");
  }
  if (!memoryPlan.includes("enabled=false") || !memoryPlan.includes("autoCapture=false")) {
    findings.push("work-memory-plan.md: shipped default is not capture off");
  }
  if (!memoryPlan.includes("applyAutoCaptureMemory")) {
    findings.push("work-memory-plan.md: missing immediate applyAutoCaptureMemory write path");
  }
  const memorySettings = memoryPlan.split("\n").find((line) => line.includes("settings.json")) ?? "";
  if (memorySettings.includes("autoCaptureMode") && !memorySettings.includes("未落地")) {
    findings.push("work-memory-plan.md: settings.json still lists autoCaptureMode as a live field");
  }

  const isolation = read("docs/design/expert-runtime-isolation.md");
  if (/isolationVersion.*current \*\*2\*\*/.test(isolation)) {
    findings.push("expert-runtime-isolation.md: isolationVersion current is still 2");
  }
  if (!/isolationVersion.*current \*\*3\*\*/.test(isolation)) {
    findings.push("expert-runtime-isolation.md: isolationVersion current is not 3");
  }

  const appAgents = read("apps/app/AGENTS.md");
  if (appAgents.includes("domains/session/pages/expert.tsx")) {
    findings.push("apps/app/AGENTS.md: still lists 14-line expert.tsx as a file-size hotspot");
  }
  if (!appAgents.includes("session-route/render.tsx")) {
    findings.push("apps/app/AGENTS.md: hotspot list missing session-route/render.tsx");
  }

  const release = read("docs/release.md");
  const yamlBranches = new Set();
  for (const file of TEST_GATE_WORKFLOW_FILES) {
    const fileBranches = extractWorkflowOnBranches(read(file));
    for (const branch of fileBranches) yamlBranches.add(branch);
    for (const branch of TEST_GATE_REQUIRED_BRANCHES) {
      if (!fileBranches.has(branch)) {
        findings.push(`${file}: on.pull_request/push branches missing \`${branch}\``);
      }
    }
  }

  const testsGatesLine = release.split("\n").find(
    (line) =>
      /`OnMyAgent Tests`/.test(line) &&
      /`PR Gates`/.test(line) &&
      /`on\.pull_request\.branches`/.test(line),
  );
  if (!testsGatesLine) {
    findings.push(
      "release.md: missing Tests/Gates on.pull_request.branches / on.push.branches line",
    );
  } else {
    if (/\(not `dev`\)/.test(testsGatesLine)) {
      findings.push("release.md: Tests/Gates still claims not to run on `dev`");
    }
    const listing = testsGatesLine
      .replace(/\(not [^)]*\)/g, "")
      .replace(/`Protect dev`[\s\S]*/, "")
      .replace(/^[\s\S]*?are /, "");
    const listed = [...listing.matchAll(/`([^`]+)`/g)].map((item) => item[1]);
    const mustList = new Set([...TEST_GATE_REQUIRED_BRANCHES, ...yamlBranches]);
    for (const branch of mustList) {
      if (!listed.includes(branch)) {
        findings.push(
          `release.md: Tests/Gates trigger branches missing \`${branch}\` (must match workflow YAML)`,
        );
      }
    }
  }
  if (/Keep deletion\s+disabled/.test(release)) {
    findings.push("release.md: Expert migration still says Keep deletion disabled as current stage");
  }

  return { ok: findings.length === 0, findings };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const result = checkDocsCommandSot();
  if (!result.ok) {
    console.error(result.findings.join("\n"));
    process.exit(1);
  }
  console.log("docs command/SoT contract ok");
}
