import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = new URL("../..", import.meta.url).pathname.replace(/\/$/, "");

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

  const appAgents = read("apps/app/AGENTS.md");
  if (appAgents.includes("domains/session/pages/expert.tsx")) {
    findings.push("apps/app/AGENTS.md: still lists 14-line expert.tsx as a file-size hotspot");
  }
  if (!appAgents.includes("session-route/render.tsx")) {
    findings.push("apps/app/AGENTS.md: hotspot list missing session-route/render.tsx");
  }

  const release = read("docs/release.md");
  if (/run on PRs\/pushes to `dev`/.test(release)) {
    findings.push("release.md: claims Tests/Gates run on dev");
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
