import { describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { isSandboxedHtmlVisual } from "../src/react-app/domains/session/surface/transcript/inline-visual";

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
  processDir?: string;
  removed?: string[];
  formats?: string[];
  inlineWidget: {
    title: string;
    widget_code: string;
    artifactCopies: Array<{
      key: string;
      label: string;
      pdf: string;
      xlsx: string;
    }>;
  };
}

function isArtifactCopy(value: unknown): boolean {
  return typeof value === "object" &&
    value !== null &&
    "key" in value && typeof value.key === "string" &&
    "label" in value && typeof value.label === "string" &&
    "pdf" in value && typeof value.pdf === "string" &&
    "xlsx" in value && typeof value.xlsx === "string";
}

function isExportResponse(value: unknown): value is ExportResponse {
  if (
    typeof value !== "object" ||
    value === null ||
    !("state" in value) ||
    !("files" in value) ||
    !("inlineWidget" in value) ||
    typeof value.inlineWidget !== "object" ||
    value.inlineWidget === null ||
    !("title" in value.inlineWidget) ||
    !("widget_code" in value.inlineWidget) ||
    !("artifactCopies" in value.inlineWidget)
  ) return false;
  return typeof value.state === "string" &&
    Array.isArray(value.files) &&
    value.files.every((file) => typeof file === "string") &&
    typeof value.inlineWidget.title === "string" &&
    typeof value.inlineWidget.widget_code === "string" &&
    Array.isArray(value.inlineWidget.artifactCopies) &&
    value.inlineWidget.artifactCopies.every(isArtifactCopy);
}

function runGenerator(
  fixtureName: string,
  outputDir: string,
  mode: "preview" | "export",
  extraArgs: string[] = [],
) {
  const script = join(expertRoot, "skills/order-entry/scripts/generate_waybill.py");
  const fixture = join(import.meta.dir, `fixtures/order-entry-clerk/${fixtureName}`);
  return spawnSync("python3", [
    script,
    "--input",
    fixture,
    "--output-dir",
    outputDir,
    "--mode",
    mode,
    ...extraArgs,
  ], {
    encoding: "utf8",
  });
}

describe("order entry clerk expert contract", () => {
  test("generates a template-first logistics document with a progressive HTML preview", () => {
    const agent = readExpertFile("agents/order-entry-clerk.md");
    const skill = readExpertFile("skills/order-entry/SKILL.md");
    const template = readExpertFile("skills/order-entry/assets/logistics-waybill-template.html");
    const documentTypes = readExpertFile("skills/order-entry/references/document-types.md");
    const protocol = readExpertFile("skills/order-entry/references/waybill-data-protocol.md");

    expect(agent).toContain("制作物流单、发货单、发车单/派车单或运单前，都先询问用户是否有要求的模板");
    expect(agent).toContain("output/.process/");
    expect(agent).toContain("PDF 与/或 XLSX");
    expect(agent).toContain("白、红、黄三联");
    expect(agent).toContain("待派车确认稿");
    expect(agent).toContain("最终版");
    expect(agent).toContain("waybill-data.json");
    expect(agent).toContain("```show_widget");
    expect(agent).toContain("会话内直接展示");
    expect(agent).toContain("禁止自由发挥或另行设计");
    expect(agent).toContain("在文件夹中显示");
    expect(agent).toContain("artifact:output/");
    expect(agent).toContain("不是会话工作区目录");
    expect(agent).toContain("~/.onmyagent/marketplaces/experts/order-entry-clerk/skills/order-entry/assets/logistics-waybill-template.html");
    expect(agent).toContain("生成 PDF 和 Excel");
    expect(agent).toContain("先不生成");
    expect(agent).toContain("编辑字段");
    expect(skill).toContain("assets/logistics-waybill-template.html");
    expect(skill).toContain("禁止增删区块、重排字段、改变合并单元格");
    expect(skill).toContain("专家模板安装异常");
    expect(skill).toContain("不要每轮新建预览");
    expect(skill).toContain("scripts/generate_waybill.py");
    expect(skill).toContain("物流单` 与 `字段数据");
    expect(skill).toContain("只有导出脚本成功且返回的 PDF/XLSX 文件存在");
    expect(skill).toContain("[放大查看](preview:output/.process/实际文件名.html)");
    expect(skill).toContain("禁止调用浏览器打开本地 HTML");
    expect(skill).toContain("HTML 只是“草稿”");
    expect(skill).toContain("在文件夹中显示");
    expect(skill).toContain("artifact:output/");
    expect(skill).toContain("output/.process/");
    expect(skill).toContain("--formats");
    expect(skill).toContain("waybill-patch");
    expect(skill).toContain("禁止");
    expect(skill).toContain("remarks");
    expect(protocol).toContain("output/.process/");
    expect(protocol).toContain("export-fingerprint");
    expect(protocol).toContain("结果产物呈现规范");
    const fields = readExpertFile("skills/order-entry/references/waybill-fields.md");
    expect(fields).toContain("字段抽取铁律");
    expect(fields).toContain("备注精简规则");
    expect(fields).toContain("≤ 40 字");
    expect(fields).toContain("备注二次精简");
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
    expect(template).toContain('data-copy="white"');
    expect(template).toContain('data-copy="red"');
    expect(template).toContain('data-copy="yellow"');
    expect(template).toContain("page-break-inside: avoid");
    expect(documentTypes).toContain("GB/T 33449-2016");
    expect(documentTypes).toContain("已废止");
    expect(documentTypes).toContain("GB/T 41833-2022");
  });

  test("keeps both plugin manifests aligned", () => {
    const expertManifest = readExpertFile(".expert-plugin/plugin.json");
    const onMyAgentManifest = readExpertFile(".onmyagent-plugin/plugin.json");

    expect(onMyAgentManifest).toBe(expertManifest);
    expect(JSON.parse(expertManifest).version).toBe("1.3.1");
    expect(JSON.parse(expertManifest).displayDescription.zh).toContain("白、红、黄三联");
  });

  test("exports three final PDF and three two-sheet Excel copies from one confirmed data source", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "order-entry-clerk-"));
    try {
      const result = runGenerator("complete-waybill.json", outputDir, "export", ["--formats", "pdf,xlsx"]);
      expect(result.status, result.stderr).toBe(0);
      const response: unknown = JSON.parse(result.stdout);
      expect(isExportResponse(response)).toBe(true);
      if (!isExportResponse(response)) return;
      expect(response.state).toBe("final");
      expect(response.files).toHaveLength(9);
      expect(response.files.every(existsSync)).toBe(true);
      expect(response.processDir).toContain(".process");
      for (const copyLabel of ["一联-白色存根", "二联-红色收货单位", "三联-黄色发货单位"]) {
        expect(response.files.some((file) => file.includes(".process") && file.endsWith(`${copyLabel}_当前预览.html`))).toBe(true);
        expect(response.files.some((file) => file.endsWith(`${copyLabel}_最终版.pdf`))).toBe(true);
        expect(response.files.some((file) => file.endsWith(`${copyLabel}_最终版.xlsx`))).toBe(true);
      }
      expect(response.inlineWidget.title).toBe("物流单三联最终预览");
      expect(response.inlineWidget.artifactCopies).toHaveLength(3);
      expect(response.inlineWidget.artifactCopies.map((copy) => copy.key)).toEqual([
        "white",
        "red",
        "yellow",
      ]);
      for (const copy of response.inlineWidget.artifactCopies) {
        expect(response.files).toContain(copy.pdf);
        expect(response.files).toContain(copy.xlsx);
        expect(existsSync(copy.pdf)).toBe(true);
        expect(existsSync(copy.xlsx)).toBe(true);
      }
      expect(response.inlineWidget.widget_code).toStartWith("<style>");
      expect(response.inlineWidget.widget_code).toContain('data-template="common-logistics-transport-agreement-v2"');
      expect(response.inlineWidget.widget_code).not.toContain("<!doctype");
      expect(response.inlineWidget.widget_code).toContain('role="tablist"');
      expect(response.inlineWidget.widget_code).toContain('data-copy-tab="white"');
      expect(response.inlineWidget.widget_code).toContain('data-copy-tab="red"');
      expect(response.inlineWidget.widget_code).toContain('data-copy-tab="yellow"');
      expect(response.inlineWidget.widget_code).toContain('data-copy-panel="white"');
      expect(response.inlineWidget.widget_code).toContain("onmyagent:waybill-copy");
      expect(response.inlineWidget.widget_code).toContain("编辑字段");
      expect(response.inlineWidget.widget_code).toContain("onmyagent:waybill-fields");
      expect(response.inlineWidget.widget_code).toContain("color:#28242f");
      expect(response.inlineWidget.widget_code).toContain("waybill-copy-tabs");
      expect(response.inlineWidget.widget_code).toContain('class="dot"');
      expect(response.inlineWidget.widget_code).toContain("inset 0 -2px 0 #c45b72");
      expect(isSandboxedHtmlVisual(response.inlineWidget.widget_code)).toBe(true);
      const xlsxPaths = response.files.filter((file) => file.endsWith(".xlsx"));
      expect(xlsxPaths).toHaveLength(3);
      for (const xlsxPath of xlsxPaths) {
        const sheetNames = spawnSync("unzip", ["-p", xlsxPath, "xl/workbook.xml"], { encoding: "utf8" });
        expect(sheetNames.status, sheetNames.stderr).toBe(0);
        expect(sheetNames.stdout).toContain('name="物流单"');
        expect(sheetNames.stdout).toContain('name="字段数据"');
      }
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 30_000);

  test("keeps the pending preview readable without exposing export actions", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "order-entry-clerk-preview-"));
    try {
      const result = runGenerator("incomplete-waybill.json", outputDir, "preview");
      expect(result.status, result.stderr).toBe(0);
      const response: unknown = JSON.parse(result.stdout);
      expect(isExportResponse(response)).toBe(true);
      if (!isExportResponse(response)) return;
      expect(response.inlineWidget.title).toBe("当前物流单三联预览");
      expect(response.inlineWidget.artifactCopies).toEqual([]);
      expect(response.inlineWidget.widget_code).toContain("color:#28242f");
      expect(response.inlineWidget.widget_code).not.toContain("opacity:.35");
      expect(response.files).toHaveLength(3);
      expect(response.files.every((file) => file.includes(".process") && file.endsWith(".html"))).toBe(true);
      expect(existsSync(join(outputDir, ".process"))).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test("labels an export without vehicle and driver details as a pending-dispatch confirmation draft", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "order-entry-clerk-pending-"));
    try {
      const result = runGenerator("pending-dispatch-waybill.json", outputDir, "export", ["--formats", "pdf,xlsx"]);
      expect(result.status, result.stderr).toBe(0);
      const response: unknown = JSON.parse(result.stdout);
      expect(isExportResponse(response)).toBe(true);
      if (!isExportResponse(response)) return;
      expect(response.state).toBe("pending_dispatch");
      expect(response.files.filter((file) => file.endsWith("待派车确认稿.pdf"))).toHaveLength(3);
      expect(response.files.filter((file) => file.endsWith("待派车确认稿.xlsx"))).toHaveLength(3);
      expect(response.files.filter((file) => file.includes(".process") && file.endsWith("当前预览.html"))).toHaveLength(3);
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
      expect(existsSync(join(outputDir, ".process", "物流单_WX-20260721-003_一联-白色存根_当前预览.html"))).toBe(true);
      expect(existsSync(join(outputDir, ".process", "物流单_WX-20260721-003_二联-红色收货单位_当前预览.html"))).toBe(true);
      expect(existsSync(join(outputDir, ".process", "物流单_WX-20260721-003_三联-黄色发货单位_当前预览.html"))).toBe(true);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  });

  test("supports format selection and deletes stale result artifacts after data changes", () => {
    const outputDir = mkdtempSync(join(tmpdir(), "order-entry-clerk-formats-"));
    const script = join(expertRoot, "skills/order-entry/scripts/generate_waybill.py");
    const fixture = join(import.meta.dir, "fixtures/order-entry-clerk/complete-waybill.json");
    const inputPath = join(outputDir, "waybill-data.json");
    try {
      writeFileSync(inputPath, readFileSync(fixture, "utf8"), "utf8");
      const first = spawnSync("python3", [
        script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export", "--formats", "pdf,xlsx",
      ], { encoding: "utf8" });
      expect(first.status, first.stderr).toBe(0);
      const firstResponse = JSON.parse(first.stdout) as ExportResponse;
      const oldPdf = firstResponse.inlineWidget.artifactCopies[0]?.pdf;
      expect(oldPdf && existsSync(oldPdf)).toBe(true);

      const pdfOnly = spawnSync("python3", [
        script, "--input", inputPath, "--output-dir", outputDir, "--mode", "export", "--formats", "pdf",
      ], { encoding: "utf8" });
      expect(pdfOnly.status, pdfOnly.stderr).toBe(0);
      const pdfOnlyResponse = JSON.parse(pdfOnly.stdout) as ExportResponse;
      expect(pdfOnlyResponse.formats).toEqual(["pdf"]);
      expect(pdfOnlyResponse.files.filter((file) => file.endsWith(".pdf"))).toHaveLength(3);
      expect(pdfOnlyResponse.files.filter((file) => file.endsWith(".xlsx"))).toHaveLength(0);
      expect(pdfOnlyResponse.removed && pdfOnlyResponse.removed.length > 0).toBe(true);

      const patchPath = join(outputDir, "patch.json");
      writeFileSync(patchPath, JSON.stringify({ "shipper.phone": "13811112222" }), "utf8");
      const patched = spawnSync("python3", [
        script,
        "--input", inputPath,
        "--output-dir", outputDir,
        "--mode", "preview",
        "--patch", patchPath,
        "--write-input",
      ], { encoding: "utf8" });
      expect(patched.status, patched.stderr).toBe(0);
      const patchedResponse = JSON.parse(patched.stdout) as ExportResponse;
      expect(patchedResponse.inlineWidget.artifactCopies).toEqual([]);
      expect(JSON.parse(readFileSync(inputPath, "utf8")).shipper.phone).toBe("13811112222");
      expect(JSON.parse(readFileSync(inputPath, "utf8")).userConfirmed).toBe(false);
      // Stale final PDFs must be removed after data change.
      expect(existsSync(join(outputDir, "物流单_WX-20260721-001_一联-白色存根_最终版.pdf"))).toBe(false);
    } finally {
      rmSync(outputDir, { recursive: true, force: true });
    }
  }, 45_000);
});
