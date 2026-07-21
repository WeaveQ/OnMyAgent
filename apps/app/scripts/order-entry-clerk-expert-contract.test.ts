import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const repoRoot = join(import.meta.dir, "../../..");
const expertRoot = join(
  repoRoot,
  "apps/desktop/resources/marketplace/experts/plugins/order-entry-clerk",
);

function readExpertFile(path: string): string {
  return readFileSync(join(expertRoot, path), "utf8");
}

interface ExportResponse {
  state: string;
  files: string[];
}

function isExportResponse(value: unknown): value is ExportResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("state" in value) ||
    !("files" in value)
  ) return false;
  return typeof value.state === "string" &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string");
}

function runGenerator(fixtureName: string, outputDir: string, mode: "preview" | "export") {
  const script = join(expertRoot, "skills/order-entry/scripts/generate_waybill.py");
  const fixture = join(import.meta.dir, `fixtures/order-entry-clerk/${fixtureName}`);
  return spawnSync("python3", [script, "--input", fixture, "--output-dir", outputDir, "--mode", mode], {
    encoding: "utf8",
  });
}

describe("order entry clerk expert contract", () => {
  test("generates a template-first logistics document with a progressive HTML preview", () => {
    const agent = readExpertFile("agents/order-entry-clerk.md");
    const skill = readExpertFile("skills/order-entry/SKILL.md");
    const template = readExpertFile("skills/order-entry/assets/logistics-waybill-template.html");
    const documentTypes = readExpertFile("skills/order-entry/references/document-types.md");

    expect(agent).toContain("制作物流单、发货单、发车单/派车单或运单前，都先询问用户是否有要求的模板");
    expect(agent).toContain("用户补充一次就更新一次同一份 HTML");
    expect(agent).toContain("默认同时交付 PDF 与 XLSX");
    expect(agent).toContain("待派车确认稿");
    expect(agent).toContain("最终版");
    expect(agent).toContain("waybill-data.json");
    expect(agent).toContain("禁止自由发挥或另行设计");
    expect(agent).toContain("不是会话工作区目录");
    expect(agent).toContain("~/.onmyagent/marketplaces/experts/order-entry-clerk/skills/order-entry/assets/logistics-waybill-template.html");
    expect(skill).toContain("assets/logistics-waybill-template.html");
    expect(skill).toContain("禁止增删区块、重排字段、改变合并单元格");
    expect(skill).toContain("专家模板安装异常");
    expect(skill).toContain("不要每轮新建预览");
    expect(skill).toContain("scripts/generate_waybill.py");
    expect(skill).toContain("物流单` 与 `字段数据");
    expect(skill).toContain("只有导出脚本成功且 PDF/XLSX 文件存在");
    expect(skill).toContain("preview:output/实际文件名.html");
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
    expect(template).toContain('data-template="common-logistics-transport-agreement-v2"');
    expect(template).toContain('data-field="document.number"');
    expect(template).toContain('data-field="vehicle.driverPhone"');
    expect(template).toContain('data-check="payment.collect"');
    expect(documentTypes).toContain("GB/T 33449-2016");
    expect(documentTypes).toContain("已废止");
    expect(documentTypes).toContain("GB/T 41833-2022");
  });

  test("keeps both plugin manifests aligned", () => {
    const expertManifest = readExpertFile(".expert-plugin/plugin.json");
    const onMyAgentManifest = readExpertFile(".onmyagent-plugin/plugin.json");

    expect(onMyAgentManifest).toBe(expertManifest);
    expect(JSON.parse(expertManifest).version).toBe("1.1.0");
    expect(JSON.parse(expertManifest).displayDescription.zh).toContain("PDF 与双 Sheet Excel");
  });

  test("exports a final PDF and two-sheet Excel from one confirmed data source", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "order-entry-clerk-"));
    try {
      const result = runGenerator("complete-waybill.json", outputDir, "export");
      expect(result.status, result.stderr).toBe(0);
      const response: unknown = JSON.parse(result.stdout);
      expect(isExportResponse(response)).toBe(true);
      if (!isExportResponse(response)) return;
      expect(response.state).toBe("final");
      expect(response.files).toHaveLength(3);
      expect(response.files.every(existsSync)).toBe(true);
      expect(response.files.some((file) => file.endsWith("最终版.pdf"))).toBe(true);
      expect(response.files.some((file) => file.endsWith("最终版.xlsx"))).toBe(true);
      const xlsxPath = response.files.find((file) => file.endsWith(".xlsx"));
      expect(xlsxPath).toBeDefined();
      if (!xlsxPath) return;
      const sheetNames = spawnSync("unzip", ["-p", xlsxPath, "xl/workbook.xml"], { encoding: "utf8" });
      expect(sheetNames.status, sheetNames.stderr).toBe(0);
      expect(sheetNames.stdout).toContain('name="物流单"');
      expect(sheetNames.stdout).toContain('name="字段数据"');
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  test("labels an export without vehicle and driver details as a pending-dispatch confirmation draft", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "order-entry-clerk-pending-"));
    try {
      const result = runGenerator("pending-dispatch-waybill.json", outputDir, "export");
      expect(result.status, result.stderr).toBe(0);
      const response: unknown = JSON.parse(result.stdout);
      expect(isExportResponse(response)).toBe(true);
      if (!isExportResponse(response)) return;
      expect(response.state).toBe("pending_dispatch");
      expect(response.files.some((file) => file.endsWith("待派车确认稿.pdf"))).toBe(true);
      expect(response.files.some((file) => file.endsWith("待派车确认稿.xlsx"))).toBe(true);
      expect(response.files.some((file) => file.includes("最终版"))).toBe(false);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  test("refuses PDF and Excel export while customer-required fields are incomplete", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "order-entry-clerk-incomplete-"));
    try {
      const result = runGenerator("incomplete-waybill.json", outputDir, "export");
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("不允许导出");
      expect(existsSync(join(outputDir, "物流单_WX-20260721-003_当前预览.html"))).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });
});
