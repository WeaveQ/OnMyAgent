#!/usr/bin/env python3
"""Generate rebate contracts from an approved DOCX template and an Excel table."""

from __future__ import annotations

import argparse
import json
import re
import sys
import zipfile
from pathlib import Path
from xml.etree import ElementTree


WORD_NS = "http://schemas.openxmlformats.org/wordprocessingml/2006/main"
PLACEHOLDER_RE = re.compile(r"\{\{\s*([a-zA-Z0-9_]+)\s*\}\}")
REQUIRED_FIELDS = (
    "counterparty_name",
    "unified_social_credit_code",
    "bank_account",
    "bank_name",
    "invoice_content",
    "invoice_type",
    "rebate_amount",
    "cooperation_period",
)
FIELD_ALIASES = {
    "project_name": ("project_name", "项目", "项目名称", "合作项目"),
    "counterparty_name": ("counterparty_name", "主体名称", "对公主体", "公司名称", "甲方名称"),
    "unified_social_credit_code": ("unified_social_credit_code", "统一社会信用代码", "税号", "纳税人识别号"),
    "bank_account": ("bank_account", "银行账号", "账号"),
    "bank_name": ("bank_name", "开户行", "开户银行"),
    "registered_address": ("registered_address", "注册地址", "地址"),
    "phone": ("phone", "电话", "公司电话"),
    "contact_name": ("contact_name", "联系人", "联系人姓名"),
    "contact_phone": ("contact_phone", "联系人电话", "联系电话"),
    "signing_method": ("signing_method", "签署方式"),
    "invoice_content": ("invoice_content", "发票内容", "开票内容", "开票项目"),
    "invoice_type": ("invoice_type", "发票类型", "开票类型"),
    "rebate_amount": ("rebate_amount", "返点金额", "渠道服务费"),
    "cooperation_period": ("cooperation_period", "合作周期", "合同周期"),
    "payment_method": ("payment_method", "付款方式", "支付方式"),
}


def _display_value(value: object) -> str:
    if value is None:
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def _load_json(value: str | None) -> dict[str, object]:
    if not value:
        return {}
    if value.lstrip().startswith("{"):
        content = value
    else:
        candidate = Path(value)
        content = candidate.read_text(encoding="utf-8") if candidate.exists() else value
    parsed = json.loads(content)
    if not isinstance(parsed, dict):
        raise ValueError("列映射必须是 JSON 对象")
    return parsed


def _header_mapping(headers: list[str], custom: dict[str, object]) -> dict[str, list[int]]:
    aliases = {key: set(values) for key, values in FIELD_ALIASES.items()}
    for key, source in custom.items():
        if key in aliases:
            values = source if isinstance(source, list) else [source]
            aliases[key].update(str(item).strip() for item in values)
    mapping: dict[str, list[int]] = {}
    for canonical, values in aliases.items():
        indexes = [index for index, header in enumerate(headers) if header in values]
        if indexes:
            mapping[canonical] = indexes
    return mapping


def _normalise_record(values: list[object], mapping: dict[str, list[int]]) -> tuple[dict[str, str], list[str]]:
    record: dict[str, str] = {}
    conflicts: list[str] = []
    for canonical, indexes in mapping.items():
        candidates = [_display_value(values[index]) for index in indexes if index < len(values)]
        nonempty = list(dict.fromkeys(value for value in candidates if value))
        record[canonical] = nonempty[0] if nonempty else ""
        if len(nonempty) > 1:
            conflicts.append(canonical)
    for field in FIELD_ALIASES:
        record.setdefault(field, "")
    return record, conflicts


def validate_record(record: dict[str, str], conflicts: list[str] | None = None) -> tuple[list[str], list[str]]:
    missing = [field for field in REQUIRED_FIELDS if not record.get(field, "").strip()]
    return missing, sorted(conflicts or [])


def _replace_xml(xml_bytes: bytes, values: dict[str, str]) -> tuple[bytes, set[str]]:
    root = ElementTree.fromstring(xml_bytes)
    text_tag = f"{{{WORD_NS}}}t"
    paragraph_tag = f"{{{WORD_NS}}}p"
    for paragraph in root.iter(paragraph_tag):
        nodes = list(paragraph.iter(text_tag))
        if not nodes:
            continue
        original_nodes = [node.text or "" for node in nodes]
        combined = "".join(original_nodes)
        matches = list(PLACEHOLDER_RE.finditer(combined))
        if not matches:
            continue

        owners: list[int] = []
        for index, text in enumerate(original_nodes):
            owners.extend([index] * len(text))
        rendered_nodes = [""] * len(nodes)
        cursor = 0
        for match in matches:
            for position in range(cursor, match.start()):
                rendered_nodes[owners[position]] += combined[position]
            replacement = values.get(match.group(1), match.group(0))
            owner = owners[match.start()] if match.start() < len(owners) else 0
            rendered_nodes[owner] += replacement
            cursor = match.end()
        for position in range(cursor, len(combined)):
            rendered_nodes[owners[position]] += combined[position]
        for node, text in zip(nodes, rendered_nodes):
            node.text = text
    rendered = ElementTree.tostring(root, encoding="utf-8", xml_declaration=True)
    unresolved = set(PLACEHOLDER_RE.findall("".join(root.itertext())))
    return rendered, unresolved


def render_docx(template_path: Path, output_path: Path, values: dict[str, str]) -> list[str]:
    unresolved: set[str] = set()
    with zipfile.ZipFile(template_path, "r") as source, zipfile.ZipFile(output_path, "w") as target:
        for item in source.infolist():
            data = source.read(item.filename)
            if item.filename.startswith("word/") and item.filename.endswith(".xml"):
                data, remaining = _replace_xml(data, values)
                unresolved.update(remaining)
            target.writestr(item, data)
    return sorted(unresolved)


def template_placeholders(template_path: Path) -> set[str]:
    placeholders: set[str] = set()
    with zipfile.ZipFile(template_path, "r") as source:
        for name in source.namelist():
            if name.startswith("word/") and name.endswith(".xml"):
                try:
                    root = ElementTree.fromstring(source.read(name))
                except ElementTree.ParseError:
                    continue
                placeholders.update(PLACEHOLDER_RE.findall("".join(root.itertext())))
    return placeholders


def _safe_filename(value: str, row_number: int) -> str:
    cleaned = re.sub(r"[\\/:*?\"<>|\s]+", "_", value).strip("_")
    return cleaned or f"第{row_number}行"


def _excel_safe(value: object) -> object:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@")):
        return "'" + value
    return value


def _write_report(rows: list[dict[str, object]], output_path: Path) -> None:
    try:
        from openpyxl import Workbook
    except ImportError as error:
        raise RuntimeError("缺少 openpyxl，无法读写 Excel；请使用桌面应用打包运行时") from error

    workbook = Workbook()
    log_sheet = workbook.active
    log_sheet.title = "生成日志"
    headers = ["来源行", "项目", "对公主体", "状态", "输出文件", "缺失字段", "冲突字段", "模板问题", "未替换占位符", "人工复核"]
    log_sheet.append([_excel_safe(value) for value in headers])
    for row in rows:
        log_sheet.append([_excel_safe(row.get(header, "")) for header in headers])
    todo_sheet = workbook.create_sheet("待处理事项")
    todo_sheet.append([_excel_safe(value) for value in headers])
    for row in rows:
        if row.get("状态") != "已生成":
            todo_sheet.append([_excel_safe(row.get(header, "")) for header in headers])
    output_path.parent.mkdir(parents=True, exist_ok=True)
    workbook.save(output_path)


def generate(args: argparse.Namespace) -> dict[str, int]:
    input_path = Path(args.input)
    template_path = Path(args.template)
    output_dir = Path(args.output_dir)
    report_path = Path(args.report)
    if template_path.suffix.lower() != ".docx" or not template_path.exists():
        raise ValueError("必须提供业务方批准的 DOCX 合同模板")
    if not input_path.exists():
        raise ValueError("对公返点信息 Excel 不存在")

    try:
        from openpyxl import load_workbook
    except ImportError as error:
        raise RuntimeError("缺少 openpyxl，无法读写 Excel；请使用桌面应用打包运行时") from error

    custom_mapping = _load_json(args.column_map)
    placeholders = template_placeholders(template_path)
    unknown_placeholders = sorted(placeholders.difference(FIELD_ALIASES))
    missing_template_fields = sorted(set(REQUIRED_FIELDS).difference(placeholders))
    template_issues = [f"未知占位符 {{{{{field}}}}}" for field in unknown_placeholders]
    template_issues.extend(f"缺少关键占位符 {{{{{field}}}}}" for field in missing_template_fields)
    workbook = load_workbook(input_path, read_only=True, data_only=True)
    if args.sheet and args.sheet not in workbook.sheetnames:
        raise ValueError(f"输入工作表不存在：{args.sheet}")
    sheet = workbook[args.sheet] if args.sheet else workbook.active
    rows = sheet.iter_rows(values_only=True)
    try:
        first_row = next(rows)
    except StopIteration as error:
        raise ValueError("输入工作表为空") from error
    headers = [_display_value(value) for value in first_row]
    mapping = _header_mapping(headers, custom_mapping)
    output_dir.mkdir(parents=True, exist_ok=True)
    logs: list[dict[str, object]] = []
    generated = 0
    incomplete = 0

    for row_number, values in enumerate(rows, start=2):
        if not any(_display_value(value) for value in values):
            continue
        record, conflicts = _normalise_record(list(values), mapping)
        missing, conflicts = validate_record(record, conflicts)
        log: dict[str, object] = {
            "来源行": row_number,
            "项目": record.get("project_name", ""),
            "对公主体": record.get("counterparty_name", ""),
            "状态": "待补材料",
            "输出文件": "",
            "缺失字段": "、".join(missing),
            "冲突字段": "、".join(conflicts),
            "模板问题": "；".join(template_issues),
            "未替换占位符": "",
            "人工复核": "是",
        }
        if missing or conflicts or template_issues:
            incomplete += 1
            logs.append(log)
            continue
        filename = f"返点合同_{_safe_filename(record['counterparty_name'], row_number)}_{row_number}.docx"
        output_path = output_dir / filename
        unresolved = render_docx(template_path, output_path, record)
        if unresolved:
            output_path.unlink(missing_ok=True)
            log["未替换占位符"] = "、".join(unresolved)
            incomplete += 1
        else:
            log["状态"] = "已生成"
            log["输出文件"] = filename
            generated += 1
        logs.append(log)

    workbook.close()
    _write_report(logs, report_path)
    return {"generated": generated, "incomplete": incomplete}


def self_test() -> dict[str, object]:
    complete = {field: "示例值" for field in FIELD_ALIASES}
    complete["rebate_amount"] = "1000"
    incomplete = dict(complete)
    incomplete["bank_account"] = ""
    complete_missing, complete_conflicts = validate_record(complete)
    incomplete_missing, _ = validate_record(incomplete)
    sample = b'<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>{{counterparty_</w:t></w:r><w:r><w:t>name}}</w:t></w:r></w:p></w:body></w:document>'
    _, unresolved = _replace_xml(sample, complete)
    return {
        "complete_records": int(not complete_missing and not complete_conflicts),
        "incomplete_records": int(bool(incomplete_missing)),
        "unresolved_placeholders": sorted(unresolved),
    }


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="根据批准的 DOCX 模板批量生成返点合同")
    parser.add_argument("--input", help="对公返点信息 Excel")
    parser.add_argument("--template", help="业务方批准的 DOCX 合同模板")
    parser.add_argument("--output-dir", help="合同输出目录")
    parser.add_argument("--report", help="生成报告 Excel")
    parser.add_argument("--sheet", help="输入工作表名称")
    parser.add_argument("--column-map", help="列映射 JSON 文件或 JSON 字符串")
    parser.add_argument("--self-test", action="store_true")
    return parser


def main() -> int:
    args = build_parser().parse_args()
    if args.self_test:
        print(json.dumps(self_test(), ensure_ascii=False))
        return 0
    if not all((args.input, args.template, args.output_dir, args.report)):
        print("必须提供 --input、--template、--output-dir 和 --report", file=sys.stderr)
        return 2
    try:
        result = generate(args)
    except (OSError, ValueError, RuntimeError, zipfile.BadZipFile) as error:
        print(f"生成失败：{error}", file=sys.stderr)
        return 1
    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
