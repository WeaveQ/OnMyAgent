/**
 * Expert package skills materialize into ~/.onmyagent/skills for load_skill.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  dematerializeExpertPackageSkills,
  listExpertPackageSkillSources,
  listExpertPackageSkillDeclarations,
  materializeExpertPackageSkills,
  materializeExpertPackageSkillsState,
  materializeExpertPackageSkillsAndRefresh,
  removeRetiredExpertPackageSkills,
} from "./expert-package-skills.mjs";

const LEGACY_CREATOR_OPS_SKILLS = {
  "kol-content-risk-checklist": "---\nname: kol-content-risk-checklist\ndescription: 对通知、话术、稿件、Brief、复盘框架等做脚本/风控/格式/遗漏检查，提前排雷。当用户说“帮我检查一下有没有坑”“过一遍风控”“查漏”时使用。\n---\n\n# 通用内容风控与遗漏检查\n\n对各类产出物做发布前/提报前的风险与遗漏扫描。\n\n## 输入\n\n- 待检查文本或文件；\n- 场景：通知/话术/稿件/Brief/复盘/提报材料；\n- 用户检查清单（可选，**优先**）。\n\n## 处理（默认）\n\n1. 内容风险：夸大、敏感、导流、侵权嫌疑表述  \n2. 合规与平台风险提示  \n3. 格式与结构完整性  \n4. 遗漏项：关键字段、时间、金额、负责人、下一步  \n\n输出：问题 → 位置 → 建议。高风险必须置顶。\n\n## 输出\n\n- 风险与遗漏清单；\n- 修改建议；\n- 可选“可发布/需修改后再发”结论（非法务意见）。\n\n## 边界\n\n- 不替代法务/平台官方审核\n- 不替用户发布\n\n\n## 模板优先（强制）\n\n1. 用户提供了模板文件、示例文件，或在对话中给出示例结构 → **严格按用户结构、字段顺序、标题与表述风格输出**；输出开头标注：`已严格按您提供的模板/示例输出`。\n2. 用户未提供任何模板/示例 → 使用本技能默认最佳实践结构；可标注：`按默认最佳实践输出`。\n3. 用户模板与内部模板冲突时，**用户提供的永远优先**。\n4. 多模态输入（PDF / Word / Excel / 图片截图等）先完成解析与理解，再进入上述逻辑。\n\n## 文件交付\n\n- 需要导出业务表/文档时：用 `document-processing` + spreadsheets `write-xlsx` / `write` **真正写入**会话目录并 `verify`，产物卡才会出现。\n- **跟进轮同样必须真写入**；禁止只在正文宣称「已生成」；禁止 `文件路径：`；临时 JSON 只放 `os.tmpdir()` / `.opencode/tmp/`。\n- 正文用粗体标文件名；先结论后展开。\n",
  "kol-rebate-invoice-audit": "---\nname: kol-rebate-invoice-audit\ndescription: 从返点合同提取关键信息，整理发票开具清单与待人工确认项，并标明精确/模糊匹配。当用户说“整理返点合同”“对一下发票”“开票信息提取”时使用。\n---\n\n# 返点合同/发票信息提取与核对\n\n把返点合同与开票资料抽成可对账清单，降低漏项。\n\n## 输入\n\n- 返点合同/补充协议/聊天确认；\n- 发票清单、开票信息、订单金额（可选）；\n- 用户核对模板（可选，**优先**）。\n\n## 处理\n\n1. 提取：甲乙方、项目、达人/执行、金额、返点比例/方式、开票主体、税号、账户、账期、特殊条款。\n2. 与发票清单字段对齐；空缺与冲突单列。\n3. 每个填空标注来源定位，并标记 **精确匹配 / 模糊匹配**。\n4. 列出必须人工确认项（金额对不上、主体不一致、缺附件等）。\n\n## 输出\n\n- 合同关键信息表；\n- 发票开具/核对清单；\n- 待人工确认项。\n\n## 边界\n\n- 不替代财务/法务终审与真实开票操作\n- 无依据不编造金额与税号\n- 不对外提交开票申请\n\n\n## 模板优先（强制）\n\n1. 用户提供了模板文件、示例文件，或在对话中给出示例结构 → **严格按用户结构、字段顺序、标题与表述风格输出**；输出开头标注：`已严格按您提供的模板/示例输出`。\n2. 用户未提供任何模板/示例 → 使用本技能默认最佳实践结构；可标注：`按默认最佳实践输出`。\n3. 用户模板与内部模板冲突时，**用户提供的永远优先**。\n4. 多模态输入（PDF / Word / Excel / 图片截图等）先完成解析与理解，再进入上述逻辑。\n\n## 文件交付\n\n- 需要导出业务表/文档时：用 `document-processing` + spreadsheets `write-xlsx` / `write` **真正写入**会话目录并 `verify`，产物卡才会出现。\n- **跟进轮同样必须真写入**；禁止只在正文宣称「已生成」；禁止 `文件路径：`；临时 JSON 只放 `os.tmpdir()` / `.opencode/tmp/`。\n- 正文用粗体标文件名；先结论后展开。\n",
  "kol-script-risk-review": "---\nname: kol-script-risk-review\ndescription: 从卖点清晰度、表达自然度、种草感、平台风险、功效夸大风险五个维度检查脚本，先列问题再给修改建议。当用户说“帮我审脚本”“看看这段口播有没有风险”“优化一下脚本”时使用。\n---\n\n# 脚本初审与风险检查\n\n拍摄前对 KOL 口播/图文脚本做初审与风险提示。\n\n## 输入\n\n- 脚本正文；\n- KOL brief / 客户偏好 / 好脚本或未过审示例（可选）；\n- 用户检查清单或输出模板（可选，**优先**）。\n\n## 处理（默认 5 维）\n\n1. 卖点清晰度  \n2. 表达自然度  \n3. 种草感  \n4. 平台风险（引流、导流、敏感表述等）  \n5. 功效夸大 / 广告法风险  \n\n每维：问题 → 依据 → 修改建议。先列问题再改写，不空夸“整体不错”。\n\n## 输出\n\n- 问题清单（按维度）；\n- 修改建议与可选改写片段；\n- 高风险句标注（建议人工终审）。\n\n## 边界\n\n- 不做法务终审或医疗/功效背书\n- 不替用户直接发布内容\n- 用户给了检查维度时按用户维度执行\n\n\n## 模板优先（强制）\n\n1. 用户提供了模板文件、示例文件，或在对话中给出示例结构 → **严格按用户结构、字段顺序、标题与表述风格输出**；输出开头标注：`已严格按您提供的模板/示例输出`。\n2. 用户未提供任何模板/示例 → 使用本技能默认最佳实践结构；可标注：`按默认最佳实践输出`。\n3. 用户模板与内部模板冲突时，**用户提供的永远优先**。\n4. 多模态输入（PDF / Word / Excel / 图片截图等）先完成解析与理解，再进入上述逻辑。\n\n## 文件交付\n\n- 需要导出业务表/文档时：用 `document-processing` + spreadsheets `write-xlsx` / `write` **真正写入**会话目录并 `verify`，产物卡才会出现。\n- **跟进轮同样必须真写入**；禁止只在正文宣称「已生成」；禁止 `文件路径：`；临时 JSON 只放 `os.tmpdir()` / `.opencode/tmp/`。\n- 正文用粗体标文件名；先结论后展开。\n",
};

async function withTempDir(run) {
  const root = await mkdtemp(path.join(os.tmpdir(), "oma-expert-skills-"));
  try {
    return await run(root);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

async function writeExpertPackage(packageDir, skillName = "order-entry") {
  await mkdir(path.join(packageDir, ".onmyagent-plugin"), { recursive: true });
  await mkdir(path.join(packageDir, "skills", skillName), { recursive: true });
  await writeFile(
    path.join(packageDir, ".onmyagent-plugin", "plugin.json"),
    `${JSON.stringify({
      name: "order-entry-clerk",
      skills: [`./skills/${skillName}`],
    }, null, 2)}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageDir, "skills", skillName, "SKILL.md"),
    `---\nname: ${skillName}\ndescription: test skill for expert package\n---\n\n# ${skillName}\n`,
    "utf8",
  );
  await writeFile(
    path.join(packageDir, "skills", skillName, "notes.txt"),
    "asset\n",
    "utf8",
  );
}

describe("expert-package-skills", () => {
  it("lists skill sources from plugin.json", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "order-entry-clerk");
      await writeExpertPackage(packageDir);
      const sources = await listExpertPackageSkillSources(packageDir);
      assert.equal(sources.length, 1);
      assert.equal(sources[0].skillName, "order-entry");
      assert.ok(sources[0].sourceDir.endsWith(`${path.sep}order-entry`));
    });
  });

  it("materializes expert skills into the user skills root", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "order-entry-clerk");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      await writeExpertPackage(packageDir);
      const installed = await materializeExpertPackageSkills({
        packageDir,
        skillsRoot,
      });
      assert.deepEqual(installed, ["order-entry"]);
      const skillMd = path.join(skillsRoot, "order-entry", "SKILL.md");
      assert.equal(existsSync(skillMd), true);
      const content = await readFile(skillMd, "utf8");
      assert.match(content, /name: order-entry/);
      assert.equal(
        existsSync(path.join(skillsRoot, "order-entry", "notes.txt")),
        true,
      );
    });
  });

  it("returns declared, installed, and missing skill lists from canonical metadata", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "declared");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      await writeExpertPackage(packageDir, "present-skill");
      const manifest = JSON.parse(
        await readFile(path.join(packageDir, ".onmyagent-plugin", "plugin.json"), "utf8"),
      );
      manifest.skills.push("./skills/missing-skill");
      await writeFile(
        path.join(packageDir, ".onmyagent-plugin", "plugin.json"),
        JSON.stringify(manifest),
        "utf8",
      );

      assert.deepEqual(
        await listExpertPackageSkillDeclarations(packageDir),
        ["present-skill", "missing-skill"],
      );
      assert.deepEqual(
        await materializeExpertPackageSkillsState({ packageDir, skillsRoot }),
        {
          declared: ["present-skill", "missing-skill"],
          installed: ["present-skill"],
          missing: ["missing-skill"],
        },
      );
    });
  });

  it("refreshes runtime skill links after materializing an updated expert", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "order-entry-clerk");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      await writeExpertPackage(packageDir, "introduce-order-dispatch");
      let refreshCount = 0;

      const installed = await materializeExpertPackageSkillsAndRefresh({
        packageDir,
        skillsRoot,
        refreshSkillLinks: async () => {
          refreshCount += 1;
        },
      });

      assert.deepEqual(installed, ["introduce-order-dispatch"]);
      assert.equal(refreshCount, 1);
      assert.equal(
        existsSync(
          path.join(skillsRoot, "introduce-order-dispatch", "SKILL.md"),
        ),
        true,
      );
    });
  });

  it("removes only the retired self-introduction skill for an updated logistics expert", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "order-dispatch-specialist");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      await writeExpertPackage(packageDir, "shipment-data-structuring");
      await mkdir(path.join(skillsRoot, "introduce-order-dispatch"), {
        recursive: true,
      });
      await mkdir(path.join(skillsRoot, "keep-user-skill"), {
        recursive: true,
      });

      const removed = await removeRetiredExpertPackageSkills({
        packageDir,
        skillsRoot,
      });

      assert.deepEqual(removed, ["introduce-order-dispatch"]);
      assert.equal(
        existsSync(path.join(skillsRoot, "introduce-order-dispatch")),
        false,
      );
      assert.equal(existsSync(path.join(skillsRoot, "keep-user-skill")), true);
    });
  });

  it("removes only superseded skills for updated creator ops experts", async () => {
    await withTempDir(async (root) => {
      const retirements = {
        "kol-media-specialist": ["kol-content-risk-checklist"],
        "kol-content-ops-specialist": [
          "kol-content-risk-checklist",
          "kol-rebate-invoice-audit",
          "kol-script-risk-review",
        ],
        "kol-project-review-specialist": ["kol-content-risk-checklist"],
      };
      for (const [packageName, retiredSkills] of Object.entries(retirements)) {
        const skillsRoot = path.join(root, packageName, ".onmyagent", "skills");
        for (const retiredSkill of retiredSkills) {
          await mkdir(path.join(skillsRoot, retiredSkill), { recursive: true });
          await writeFile(
            path.join(skillsRoot, retiredSkill, "SKILL.md"),
            LEGACY_CREATOR_OPS_SKILLS[retiredSkill],
            "utf8",
          );
        }
        await mkdir(path.join(skillsRoot, "keep-user-skill"), { recursive: true });
        const packageDir = path.join(root, "packages", packageName);
        await writeExpertPackage(packageDir, "replacement-skill");
        const removed = await removeRetiredExpertPackageSkills({ packageDir, skillsRoot });
        assert.deepEqual(removed, retiredSkills);
        for (const retiredSkill of retiredSkills) {
          assert.equal(existsSync(path.join(skillsRoot, retiredSkill)), false);
        }
        assert.equal(existsSync(path.join(skillsRoot, "keep-user-skill")), true);
      }
    });
  });

  it("preserves a user-created skill that reuses a retired creator-ops id", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "packages", "kol-media-specialist");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      const customSkill = path.join(skillsRoot, "kol-content-risk-checklist");
      await writeExpertPackage(packageDir, "replacement-skill");
      await mkdir(customSkill, { recursive: true });
      await writeFile(
        path.join(customSkill, "SKILL.md"),
        "---\nname: kol-content-risk-checklist\ndescription: my custom workflow\n---\n\n# 我的自定义检查\n",
        "utf8",
      );

      const removed = await removeRetiredExpertPackageSkills({ packageDir, skillsRoot });

      assert.deepEqual(removed, []);
      assert.equal(existsSync(customSkill), true);
    });
  });

  it("preserves a customized legacy skill even when its id and title still match", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "packages", "kol-content-ops-specialist");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      const customSkill = path.join(skillsRoot, "kol-script-risk-review");
      await writeExpertPackage(packageDir, "replacement-skill");
      await mkdir(customSkill, { recursive: true });
      await writeFile(
        path.join(customSkill, "SKILL.md"),
        `${LEGACY_CREATOR_OPS_SKILLS["kol-script-risk-review"]}\n## 我的补充规则\n保留这段用户定制。\n`,
        "utf8",
      );

      const removed = await removeRetiredExpertPackageSkills({ packageDir, skillsRoot });

      assert.deepEqual(removed, []);
      assert.equal(existsSync(customSkill), true);
    });
  });

  it("preserves a legacy skill folder when the user added supporting files", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "packages", "kol-media-specialist");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      const customSkill = path.join(skillsRoot, "kol-content-risk-checklist");
      await writeExpertPackage(packageDir, "replacement-skill");
      await mkdir(customSkill, { recursive: true });
      await writeFile(
        path.join(customSkill, "SKILL.md"),
        LEGACY_CREATOR_OPS_SKILLS["kol-content-risk-checklist"],
        "utf8",
      );
      await writeFile(path.join(customSkill, "my-rules.md"), "用户补充规则\n", "utf8");

      const removed = await removeRetiredExpertPackageSkills({ packageDir, skillsRoot });

      assert.deepEqual(removed, []);
      assert.equal(existsSync(path.join(customSkill, "my-rules.md")), true);
    });
  });

  it("keeps a shared identical skill until the last owning expert is removed", async () => {
    await withTempDir(async (root) => {
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      const mediaPackage = path.join(root, "kol-media-specialist");
      const reviewPackage = path.join(root, "kol-project-review-specialist");
      await writeExpertPackage(mediaPackage, "kol-data-clean-merge");
      await writeExpertPackage(reviewPackage, "kol-data-clean-merge");

      await materializeExpertPackageSkills({ packageDir: mediaPackage, skillsRoot });
      await materializeExpertPackageSkills({ packageDir: reviewPackage, skillsRoot });
      const destination = path.join(skillsRoot, "kol-data-clean-merge");
      const ownership = JSON.parse(
        await readFile(path.join(destination, ".onmyagent-expert-owners.json"), "utf8"),
      );
      assert.deepEqual(ownership.owners, [
        "kol-media-specialist",
        "kol-project-review-specialist",
      ]);

      const firstRemoved = await dematerializeExpertPackageSkills({
        packageDir: mediaPackage,
        skillsRoot,
      });
      assert.deepEqual(firstRemoved, []);
      assert.equal(existsSync(destination), true);

      const secondRemoved = await dematerializeExpertPackageSkills({
        packageDir: reviewPackage,
        skillsRoot,
      });
      assert.deepEqual(secondRemoved, ["kol-data-clean-merge"]);
      assert.equal(existsSync(destination), false);
    });
  });

  it("rejects conflicting declarations that reuse an owned skill name", async () => {
    await withTempDir(async (root) => {
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      const firstPackage = path.join(root, "first-expert");
      const secondPackage = path.join(root, "second-expert");
      await writeExpertPackage(firstPackage, "shared-skill");
      await writeExpertPackage(secondPackage, "shared-skill");
      await writeFile(
        path.join(secondPackage, "skills", "shared-skill", "SKILL.md"),
        "---\nname: shared-skill\ndescription: conflicting implementation\n---\n\n# Different\n",
        "utf8",
      );

      await materializeExpertPackageSkills({ packageDir: firstPackage, skillsRoot });
      await assert.rejects(
        () => materializeExpertPackageSkills({ packageDir: secondPackage, skillsRoot }),
        /Expert skill collision for shared-skill/,
      );
    });
  });

  it("refreshes runtime skill links when a retired self-introduction skill is removed", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "fulfillment-specialist");
      const skillsRoot = path.join(root, ".onmyagent", "skills");
      await mkdir(path.join(packageDir, ".onmyagent-plugin"), {
        recursive: true,
      });
      await writeFile(
        path.join(packageDir, ".onmyagent-plugin", "plugin.json"),
        `${JSON.stringify({
          name: "fulfillment-specialist",
          skills: [],
        })}\n`,
        "utf8",
      );
      await mkdir(path.join(skillsRoot, "introduce-fulfillment"), {
        recursive: true,
      });
      let refreshCount = 0;

      const installed = await materializeExpertPackageSkillsAndRefresh({
        packageDir,
        skillsRoot,
        refreshSkillLinks: async () => {
          refreshCount += 1;
        },
      });

      assert.deepEqual(installed, []);
      assert.equal(refreshCount, 1);
      assert.equal(
        existsSync(path.join(skillsRoot, "introduce-fulfillment")),
        false,
      );
    });
  });

  it("skips skills whose frontmatter name does not match the folder", async () => {
    await withTempDir(async (root) => {
      const packageDir = path.join(root, "broken");
      await mkdir(path.join(packageDir, ".expert-plugin"), { recursive: true });
      await mkdir(path.join(packageDir, "skills", "foo"), { recursive: true });
      await writeFile(
        path.join(packageDir, ".expert-plugin", "plugin.json"),
        JSON.stringify({ skills: ["./skills/foo"] }),
        "utf8",
      );
      await writeFile(
        path.join(packageDir, "skills", "foo", "SKILL.md"),
        "---\nname: bar\ndescription: mismatch\n---\n",
        "utf8",
      );
      const sources = await listExpertPackageSkillSources(packageDir);
      assert.deepEqual(sources, []);
    });
  });
});
