import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/order-entry-clerk",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

describe("order entry clerk expert contract", () => {
  test("generates a template-first logistics document with a progressive HTML preview", () => {
    const agent = readExpertFile("agents/order-entry-clerk.md");
    const skill = readExpertFile("skills/order-entry/SKILL.md");
    const template = readExpertFile("skills/order-entry/assets/logistics-waybill-template.html");
    const documentTypes = readExpertFile("skills/order-entry/references/document-types.md");

    expect(agent).toContain("制作物流单、发货单、发车单/派车单或运单前，都先询问用户是否有要求的模板");
    expect(agent).toContain("用户补充一次就更新一次同一份 HTML");
    expect(agent).toContain("默认交付单据本身");
    expect(agent).toContain("禁止自由发挥或另行设计");
    expect(agent).toContain("不是会话工作区目录");
    expect(agent).toContain("~/.onmyagent/marketplaces/experts/order-entry-clerk/skills/order-entry/assets/logistics-waybill-template.html");
    expect(skill).toContain("assets/logistics-waybill-template.html");
    expect(skill).toContain("禁止增删区块、重排字段、改变合并单元格");
    expect(skill).toContain("专家模板安装异常");
    expect(skill).toContain("不要每轮新建一份预览");
    expect(skill).toContain("[查看当前效果](preview:output/实际文件名.html)");
    expect(skill).toContain("禁止调用浏览器打开本地 HTML");
    expect(skill).toContain("HTML 只是“草稿”");
    expect(template).toContain("物流运输协议");
    expect(template).toContain("草稿·待确认");
    expect(template).toContain("承揽全国各地整车零担业务 · 代收货款");
    expect(template).toContain("运输结算方式");
    expect(template).toContain("一联存根（白）");
    expect(template).toContain("二联收货单位（红）");
    expect(template).toContain("三联发货单位（黄）");
    expect(template).toContain("发货单位");
    expect(template).toContain("承运司机");
    expect(template).toContain("本部经手人");
    expect(template).toContain("收货单位");
    expect(documentTypes).toContain("GB/T 33449-2016");
    expect(documentTypes).toContain("已废止");
    expect(documentTypes).toContain("GB/T 41833-2022");
  });

  test("keeps both plugin manifests aligned", () => {
    const expertManifest = readExpertFile(".expert-plugin/plugin.json");
    const onMyAgentManifest = readExpertFile(".onmyagent-plugin/plugin.json");

    expect(onMyAgentManifest).toBe(expertManifest);
    expect(JSON.parse(expertManifest).displayDescription.zh).toContain("HTML 物流单效果图");
  });
});
