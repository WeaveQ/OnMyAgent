import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const pluginsRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins",
);

const INTRO_SKILLS = [
  {
    packageName: "order-dispatch-specialist",
    skillName: "introduce-order-dispatch",
    slug: "order-dispatch",
    title: "接单调度专员",
    capabilities: ["物流单", "报价", "运力调配"],
  },
  {
    packageName: "fleet-management-specialist",
    skillName: "introduce-fleet-management",
    slug: "fleet-management",
    title: "车队管理专员",
    capabilities: ["油费稽查", "挂靠车管理", "货损理赔"],
  },
  {
    packageName: "logistics-finance-specialist",
    skillName: "introduce-logistics-finance",
    slug: "logistics-finance",
    title: "财务专员",
    capabilities: ["回单对账", "开票管理", "回款催收"],
  },
] as const;

describe("expert onboarding guide skills", () => {
  for (const intro of INTRO_SKILLS) {
    test(`${intro.packageName} teaches usage before HTML preview`, () => {
      const skillRoot = join(
        pluginsRoot,
        intro.packageName,
        "skills",
        intro.skillName,
      );
      const packageRoot = join(pluginsRoot, intro.packageName);
      const expertManifest = JSON.parse(
        readFileSync(
          join(packageRoot, ".expert-plugin", "plugin.json"),
          "utf8",
        ),
      );
      const compatibilityManifest = JSON.parse(
        readFileSync(
          join(packageRoot, ".onmyagent-plugin", "plugin.json"),
          "utf8",
        ),
      );
      expect(compatibilityManifest.promptTemplates).toBe(
        expertManifest.promptTemplates,
      );
      const promptTemplates = JSON.parse(
        readFileSync(
          join(packageRoot, expertManifest.promptTemplates),
          "utf8",
        ),
      );
      expect(promptTemplates).toHaveLength(3);
      const capabilityMap = JSON.parse(
        readFileSync(join(skillRoot, "assets/capability-map.json"), "utf8"),
      );
      expect(
        capabilityMap.capabilities.map((capability) => capability.templateId),
      ).toEqual(promptTemplates.map((template) => template.id));
      for (const template of promptTemplates) {
        for (const locale of ["zh", "en"]) {
          const localizedTemplate = template.template[locale];
          const placeholderLabels = [
            ...localizedTemplate.matchAll(/<([^<>\r\n]+)>/g),
          ].map((match) => match[1]);
          const declaredLabels = [
            ...template.requiredSlots[locale],
            ...template.conditionalSlots[locale],
          ];
          expect(placeholderLabels).toEqual([...new Set(placeholderLabels)]);
          expect(new Set(placeholderLabels)).toEqual(new Set(declaredLabels));
          const numberedLines = [
            ...localizedTemplate.matchAll(/^(\d+)\.\s/gm),
          ].map((match) => Number(match[1]));
          expect(numberedLines).toEqual(
            numberedLines.map((_, index) => index + 1),
          );
        }
      }
      const skill = readFileSync(join(skillRoot, "SKILL.md"), "utf8");
      expect(skill.indexOf("立即告诉用户该怎么开始")).toBeLessThan(
        skill.indexOf("立即输出照着问的示例表"),
      );
      expect(skill.indexOf("立即输出照着问的示例表")).toBeLessThan(
        skill.indexOf("最后生成 HTML 使用路线图"),
      );
      expect(skill).toContain("禁止改用 Mermaid");
      expect(skill).toContain("路线图完成后立即结束");
      expect(skill).toContain(
        "脚本返回的 `inlineWidget` 是本轮唯一且最终的上手路线图",
      );
      expect(skill).toContain(
        "不再调用 `render_visual`、`show_widget`、`visualizer`",
      );
      expect(skill).toContain("图谱必须是本轮最后一个可见内容");

      const workspace = mkdtempSync(join(tmpdir(), "expert-intro-"));
      try {
        const result = spawnSync(
          "python3",
          [join(skillRoot, "scripts/render_capability_map.py")],
          { cwd: workspace, encoding: "utf8" },
        );
        expect(result.status, result.stderr).toBe(0);
        const payload = JSON.parse(result.stdout) as {
          inlineWidget: { terminal: boolean; title: string; widget_code: string };
        };
        expect(payload.inlineWidget.terminal).toBe(true);
        expect(payload.inlineWidget.title).toContain(intro.title);
        expect(payload.inlineWidget.widget_code).toContain("<section");
        expect(payload.inlineWidget.title).toContain("上手指南");
        expect(payload.inlineWidget.widget_code).toContain("data-expert-guide");
        expect(
          payload.inlineWidget.widget_code.match(/data-guide-entry/g),
        ).toHaveLength(3);
        expect(payload.inlineWidget.widget_code).toContain("width:100%");
        expect(payload.inlineWidget.widget_code).toContain("一次任务怎么完成");
        expect(payload.inlineWidget.widget_code).toContain("可以直接这样说");
        expect(payload.inlineWidget.widget_code).toContain(
          "onmyagent:prompt-template",
        );
        expect(payload.inlineWidget.widget_code).toContain("最少准备");
        expect(payload.inlineWidget.widget_code).toContain("你会得到");
        expect(payload.inlineWidget.widget_code.toLowerCase()).not.toContain("<svg");
        expect(payload.inlineWidget.widget_code.toLowerCase()).not.toContain("mermaid");
        for (const capability of intro.capabilities) {
          expect(payload.inlineWidget.widget_code).toContain(capability);
        }
        const outputPath = join(
          workspace,
          ".process",
          `${intro.slug}-capability-map.html`,
        );
        expect(readFileSync(outputPath, "utf8")).toContain("<!doctype html>");
      } finally {
        rmSync(workspace, { recursive: true, force: true });
      }
    });
  }
});
