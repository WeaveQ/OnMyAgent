#!/usr/bin/env python3
"""Generate one HTML preview and gated PDF/XLSX logistics-waybill artifacts."""

from __future__ import annotations

import argparse
import html
import json
import os
import re
import signal
import shutil
import subprocess
import sys
import tempfile
import time
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape as xml_escape


SKILL_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_TEMPLATE = SKILL_ROOT / "assets" / "logistics-waybill-template.html"
CUSTOMER_REQUIRED = (
    "document.number", "document.date", "route.origin", "route.destination",
    "shipper.name", "shipper.contact", "shipper.phone", "shipper.address",
    "consignee.name", "consignee.contact", "consignee.phone", "consignee.address",
    "timeline.pickup", "timeline.delivery", "payment.method", "handover",
)
DISPATCH_REQUIRED = (
    "vehicle.plate", "vehicle.licenseNumber", "vehicle.driverName", "vehicle.driverPhone",
)
FIELD_LABELS = {
    "document.number": "单号", "document.date": "发货日期",
    "route.origin": "起运地点", "route.destination": "目的地点",
    "shipper.name": "托运单位", "shipper.contact": "托运联系人",
    "shipper.phone": "托运电话", "shipper.address": "装货地址",
    "consignee.name": "收货单位", "consignee.contact": "收货联系人",
    "consignee.phone": "收货电话", "consignee.address": "卸货地址",
    "timeline.pickup": "计划提货时间", "timeline.delivery": "要求到达时间",
    "vehicleRequirement": "车型要求", "vehicle.plate": "车牌号",
    "vehicle.licenseNumber": "驾驶证号", "vehicle.driverName": "司机姓名",
    "vehicle.driverPhone": "司机电话", "vehicle.driverAddress": "司机家庭住址",
    "carrier.name": "承运方", "carrier.address": "承运方地址",
    "carrier.phone": "承运方电话", "payment.method": "结算方式",
    "payment.amount": "金额", "payment.amountUppercase": "金额大写",
    "handover": "提货方式", "remarks": "备注",
}


class WaybillError(Exception):
    pass


def get_value(data: dict[str, Any], path: str) -> Any:
    value: Any = data
    for part in path.split("."):
        if not isinstance(value, dict):
            return ""
        value = value.get(part, "")
    return value


def text_value(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "是" if value else "否"
    return str(value).strip()


def cargo_rows(data: dict[str, Any]) -> list[dict[str, Any]]:
    rows = data.get("cargo", [])
    if not isinstance(rows, list):
        return []
    return [row for row in rows if isinstance(row, dict)]


def missing_fields(data: dict[str, Any]) -> list[str]:
    missing = [path for path in CUSTOMER_REQUIRED if not text_value(get_value(data, path))]
    rows = cargo_rows(data)
    if not rows:
        return [*missing, "cargo"]
    for index, row in enumerate(rows, start=1):
        for key in ("name", "quantity", "packaging"):
            if not text_value(row.get(key)):
                missing.append(f"cargo[{index}].{key}")
        if not text_value(row.get("weight")) and not text_value(row.get("volume")):
            missing.append(f"cargo[{index}].weightOrVolume")
    return missing


def document_state(data: dict[str, Any]) -> tuple[str, list[str]]:
    missing = missing_fields(data)
    conflicts = data.get("conflicts", [])
    low_confidence = data.get("lowConfidenceFields", [])
    if not isinstance(conflicts, list) or not isinstance(low_confidence, list):
        raise WaybillError("conflicts 和 lowConfidenceFields 必须是数组")
    if missing or conflicts or low_confidence:
        return "collecting", missing
    if data.get("userConfirmed") is not True:
        return "awaiting_confirmation", []
    dispatch_missing = [path for path in DISPATCH_REQUIRED if not text_value(get_value(data, path))]
    if dispatch_missing:
        return "pending_dispatch", dispatch_missing
    return "final", []


def status_label(state: str) -> str:
    return {
        "collecting": "草稿·待补充",
        "awaiting_confirmation": "草稿·待确认",
        "pending_dispatch": "待派车确认稿",
        "final": "最终版",
    }[state]


def cargo_summary(data: dict[str, Any], key: str) -> str:
    parts: list[str] = []
    for row in cargo_rows(data):
        if key == "weightOrVolume":
            combined = " / ".join(filter(None, (text_value(row.get("weight")), text_value(row.get("volume")))))
            parts.append(combined)
        else:
            parts.append(text_value(row.get(key)))
    return "；".join(part for part in parts if part)


def template_values(data: dict[str, Any], state: str) -> dict[str, str]:
    remarks = [text_value(data.get("remarks"))]
    mapping = (
        ("计划提货", get_value(data, "timeline.pickup")),
        ("要求到达", get_value(data, "timeline.delivery")),
        ("车型要求", data.get("vehicleRequirement", "")),
    )
    for label, value in mapping:
        rendered = text_value(value)
        if rendered and f"{label}：" not in remarks[0]:
            remarks.append(f"{label}：{rendered}")
    values = {path: text_value(get_value(data, path)) for path in FIELD_LABELS}
    values.update({
        "document.status": status_label(state),
        "cargo.name": cargo_summary(data, "name"),
        "cargo.quantity": cargo_summary(data, "quantity"),
        "cargo.packaging": cargo_summary(data, "packaging"),
        "cargo.weightOrVolume": cargo_summary(data, "weightOrVolume"),
        "cargo.declaredValue": cargo_summary(data, "declaredValue"),
        "cargo.insuranceFee": cargo_summary(data, "insuranceFee"),
        "cargo.codAmount": cargo_summary(data, "codAmount"),
        "remarks": "；".join(part for part in remarks if part),
    })
    return values


def fill_html(template: str, values: dict[str, str], state: str, data: dict[str, Any]) -> str:
    rendered = template.replace('data-status="草稿·待确认"', f'data-status="{html.escape(status_label(state))}"')
    for field, value in values.items():
        pattern = re.compile(rf'(<(?P<tag>span|strong|td|div)\b(?P<attrs>[^>]*\bdata-field="{re.escape(field)}"[^>]*)>)(?P<body>.*?)(</(?P=tag)>)', re.DOTALL)
        match = pattern.search(rendered)
        if not match:
            continue
        attrs = match.group("attrs")
        shown = value or ("待补充" if "missing" in attrs or field in CUSTOMER_REQUIRED else "—")
        if value:
            attrs = re.sub(r'\s*\bmissing\b', "", attrs)
            attrs = re.sub(r'class="\s+', 'class="', attrs)
        elif "missing" not in attrs and field in CUSTOMER_REQUIRED:
            attrs = f'{attrs} class="missing"' if "class=" not in attrs else attrs.replace('class="', 'class="missing ')
        replacement = f'<{match.group("tag")}{attrs}>{html.escape(shown)}</{match.group("tag")}>'
        rendered = rendered[:match.start()] + replacement + rendered[match.end():]
    selected_checks = {
        "payment.collect": text_value(get_value(data, "payment.method")) == "到付",
        "payment.prepaid": text_value(get_value(data, "payment.method")) in ("已付", "现付"),
        "payment.receipt": text_value(get_value(data, "payment.method")) in ("回付", "回单付"),
        "payment.unpaid": text_value(get_value(data, "payment.method")) == "欠付",
        "handover.pickup": text_value(data.get("handover")) == "自提",
        "handover.delivery": text_value(data.get("handover")) in ("送货", "送货上门"),
    }
    for check, selected in selected_checks.items():
        if selected:
            rendered = rendered.replace(f'class="box" data-check="{check}"', f'class="box" data-check="{check}" style="background:#28242f"')
    return rendered


def inline_widget_fragment(rendered_html: str) -> str:
    style = re.search(r"<style>([\s\S]*?)</style>", rendered_html, re.IGNORECASE)
    main = re.search(r"(<main\b[\s\S]*?</main>)", rendered_html, re.IGNORECASE)
    if not style or not main:
        raise WaybillError("模板无法提取会话内预览片段")
    return f"<style>{style.group(1)}</style>{main.group(1)}"


def safe_name(value: str) -> str:
    name = re.sub(r'[\\/:*?"<>|\s]+', "-", value).strip("-.")
    return name[:80] or datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")


def xml_cell(ref: str, value: Any, style: int = 0, numeric: bool = False) -> str:
    style_attr = f' s="{style}"' if style else ""
    if numeric and text_value(value):
        try:
            number = float(text_value(value).replace(",", ""))
            return f'<c r="{ref}"{style_attr}><v>{number}</v></c>'
        except ValueError:
            pass
    text = xml_escape(text_value(value))
    preserve = ' xml:space="preserve"' if text.startswith(" ") or text.endswith(" ") else ""
    return f'<c r="{ref}" t="inlineStr"{style_attr}><is><t{preserve}>{text}</t></is></c>'


def xml_row(index: int, cells: list[str], height: int | None = None) -> str:
    height_attr = f' ht="{height}" customHeight="1"' if height else ""
    return f'<row r="{index}"{height_attr}>{"".join(cells)}</row>'


def display_identifier(value: Any) -> str:
    rendered = text_value(value)
    if re.fullmatch(r"\d{18}", rendered):
        return f"{rendered[:6]} {rendered[6:14]} {rendered[14:]}"
    return rendered


def print_sheet_xml(data: dict[str, Any], state: str) -> str:
    values = template_values(data, state)
    rows: list[str] = []
    rows.append(xml_row(1, [xml_cell("A1", "物流运输协议", 2), xml_cell("J1", f'NO. {values["document.number"] or "待补充"}', 3)], 30))
    rows.append(xml_row(2, [xml_cell("A2", "承揽全国各地整车零担业务 · 代收货款", 4), xml_cell("J2", status_label(state), 5)], 22))
    rows.append(xml_row(3, [xml_cell("A3", f'起运地点：{values["route.origin"] or "待补充"} 至 {values["route.destination"] or "待补充"}', 6), xml_cell("J3", f'发货日期：{values["document.date"] or "待补充"}', 6)], 24))
    party_rows = [
        ("托运单位", values["shipper.name"], "收货单位", values["consignee.name"]),
        ("姓名", values["shipper.contact"], "姓名", values["consignee.contact"]),
        ("电话", values["shipper.phone"], "电话", values["consignee.phone"]),
    ]
    for row_index, item in enumerate(party_rows, start=4):
        rows.append(xml_row(row_index, [xml_cell(f"A{row_index}", item[0], 7), xml_cell(f"C{row_index}", item[1] or "待补充", 8), xml_cell(f"G{row_index}", item[2], 7), xml_cell(f"I{row_index}", item[3] or "待补充", 8)], 26))
    headers = ("货物名称", "件数", "包装", "重量/体积", "保险金额", "保险费", "代收货款", "备注")
    header_refs = ("A7", "C7", "D7", "E7", "G7", "H7", "I7", "J7")
    rows.append(xml_row(7, [xml_cell(ref, label, 7) for ref, label in zip(header_refs, headers)], 28))
    cargo_values = (values["cargo.name"], values["cargo.quantity"], values["cargo.packaging"], values["cargo.weightOrVolume"], values["cargo.declaredValue"] or "—", values["cargo.insuranceFee"] or "—", values["cargo.codAmount"] or "—", values["remarks"] or "—")
    rows.append(xml_row(8, [xml_cell(ref.replace("7", "8"), value or "待补充", 8) for ref, value in zip(header_refs, cargo_values)], 48))
    rows.append(xml_row(9, [xml_cell("A9", "车牌号", 7), xml_cell("C9", values["vehicle.plate"] or "—", 8), xml_cell("G9", "家庭住址", 7), xml_cell("I9", values["vehicle.driverAddress"] or "—", 8)], 26))
    rows.append(xml_row(10, [xml_cell("A10", "驾驶证号", 7), xml_cell("C10", display_identifier(values["vehicle.licenseNumber"]) or "—", 13), xml_cell("G10", "司机姓名/电话", 7), xml_cell("I10", f'{values["vehicle.driverName"] or "—"} / {values["vehicle.driverPhone"] or "—"}', 13)], 26))
    rows.append(xml_row(11, [xml_cell("A11", f'运输结算方式：{values["payment.method"] or "待补充"}    提货方式：{values["handover"] or "待补充"}', 8)], 28))
    rows.append(xml_row(12, [xml_cell("A12", f'金额合计（大写）：{values["payment.amountUppercase"] or "待补充"}    ￥：{values["payment.amount"] or "待补充"}', 8)], 28))
    rows.append(xml_row(13, [xml_cell("A13", "发货单位\n\n年  月  日", 9), xml_cell("D13", "承运司机\n\n年  月  日", 9), xml_cell("G13", "本部经手人\n\n年  月  日", 9), xml_cell("J13", "收货单位\n\n年  月  日", 9)], 64))
    rows.append(xml_row(14, [xml_cell("A14", f'承运方地址：{values["carrier.address"] or "待补充"}    电话：{values["carrier.phone"] or "待补充"}', 10)], 24))
    rows.append(xml_row(15, [xml_cell("A15", "托运方在本公司托运货物时请仔细阅读客户联背面，本运单一经签署即生法律效用。", 10)], 24))
    merges = ("A1:I1", "J1:L1", "A2:I2", "J2:L2", "A3:I3", "J3:L3", "A4:B4", "C4:F4", "G4:H4", "I4:L4", "A5:B5", "C5:F5", "G5:H5", "I5:L5", "A6:B6", "C6:F6", "G6:H6", "I6:L6", "A7:B7", "E7:F7", "J7:L7", "A8:B8", "E8:F8", "J8:L8", "A9:B9", "C9:F9", "G9:H9", "I9:L9", "A10:B10", "C10:F10", "G10:H10", "I10:L10", "A11:L11", "A12:L12", "A13:C13", "D13:F13", "G13:I13", "J13:L13", "A14:L14", "A15:L15")
    merge_xml = "".join(f'<mergeCell ref="{item}"/>' for item in merges)
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView showGridLines="0" workbookViewId="0"/></sheetViews>
<cols><col min="1" max="12" width="10.5" customWidth="1"/></cols>
<sheetData>{"".join(rows)}</sheetData><mergeCells count="{len(merges)}">{merge_xml}</mergeCells>
<pageMargins left="0.25" right="0.25" top="0.35" bottom="0.35" header="0" footer="0"/>
<pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="1"/>
<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr><printOptions horizontalCentered="1" verticalCentered="1"/>
</worksheet>'''


def flatten_fields(data: dict[str, Any], state: str) -> list[tuple[str, str, str, str, str, str]]:
    meta = data.get("fieldMeta", {}) if isinstance(data.get("fieldMeta", {}), dict) else {}
    result: list[tuple[str, str, str, str, str, str]] = []
    paths = list(FIELD_LABELS)
    for path in paths:
        value = text_value(get_value(data, path))
        info = meta.get(path, {}) if isinstance(meta.get(path, {}), dict) else {}
        result.append((path, FIELD_LABELS[path], value, "已填写" if value else "待补充", text_value(info.get("source")), text_value(info.get("confidence"))))
    for index, cargo in enumerate(cargo_rows(data), start=1):
        for key, label in (("name", "货物名称"), ("quantity", "数量/件数"), ("packaging", "包装"), ("weight", "重量"), ("volume", "体积"), ("declaredValue", "声明价值"), ("insuranceFee", "保险费"), ("codAmount", "代收货款")):
            path = f"cargo[{index}].{key}"
            value = text_value(cargo.get(key))
            info = meta.get(path, {}) if isinstance(meta.get(path, {}), dict) else {}
            result.append((path, f"货物{index}-{label}", value, "已填写" if value else "待补充", text_value(info.get("source")), text_value(info.get("confidence"))))
    result.insert(0, ("document.status", "单据状态", status_label(state), "已确定", "系统门禁", "high"))
    result = [
        (path, label, display_identifier(value) if path == "vehicle.licenseNumber" else value, status, source, confidence)
        for path, label, value, status, source, confidence in result
    ]
    return result


def data_sheet_xml(data: dict[str, Any], state: str) -> str:
    headers = ("字段键", "字段名称", "字段值", "状态", "来源", "置信度")
    rows = [xml_row(1, [xml_cell(f"{column}1", value, 11) for column, value in zip("ABCDEF", headers)], 26)]
    for index, values in enumerate(flatten_fields(data, state), start=2):
        rows.append(xml_row(index, [xml_cell(f"{column}{index}", value, 13 if column == "C" else 12) for column, value in zip("ABCDEF", values)], 24))
    return f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView showGridLines="0" workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols><col min="1" max="1" width="28" customWidth="1"/><col min="2" max="2" width="22" customWidth="1"/><col min="3" max="3" width="42" customWidth="1"/><col min="4" max="6" width="16" customWidth="1"/></cols>
<sheetData>{"".join(rows)}</sheetData><autoFilter ref="A1:F{len(rows)}"/>
</worksheet>'''


def write_xlsx(path: Path, data: dict[str, Any], state: str) -> None:
    styles = '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Microsoft YaHei"/></font><font><b/><sz val="20"/><name val="SimSun"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Microsoft YaHei"/></font><font><color rgb="FF9C405B"/><sz val="12"/><name val="Microsoft YaHei"/></font></fonts>
<fills count="4"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFF1EAF0"/><bgColor indexed="64"/></patternFill></fill><fill><patternFill patternType="solid"><fgColor rgb="FF5B4050"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="3"><border/><border><left style="thin"><color rgb="FF5F5966"/></left><right style="thin"><color rgb="FF5F5966"/></right><top style="thin"><color rgb="FF5F5966"/></top><bottom style="thin"><color rgb="FF5F5966"/></bottom></border><border><bottom style="thin"><color rgb="FF5F5966"/></bottom></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="14"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="2" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="2" borderId="1" xfId="0" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="0" fontId="2" fillId="3" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf><xf numFmtId="49" fontId="0" fillId="0" borderId="1" xfId="0" quotePrefix="1" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment vertical="center" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'''
    files = {
        "[Content_Types].xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>''',
        "_rels/.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>''',
        "xl/workbook.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="物流单" sheetId="1" r:id="rId1"/><sheet name="字段数据" sheetId="2" r:id="rId2"/></sheets><calcPr calcId="191029" fullCalcOnLoad="1"/></workbook>''',
        "xl/_rels/workbook.xml.rels": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>''',
        "xl/worksheets/sheet1.xml": print_sheet_xml(data, state),
        "xl/worksheets/sheet2.xml": data_sheet_xml(data, state),
        "xl/styles.xml": styles,
        "docProps/app.xml": '''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>OnMyAgent 物流单专家</Application></Properties>''',
        "docProps/core.xml": f'''<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>物流单 {xml_escape(text_value(get_value(data, "document.number")))}</dc:title><dc:creator>OnMyAgent 物流单专家</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">{datetime.now(timezone.utc).isoformat()}</dcterms:created></cp:coreProperties>''',
    }
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as archive:
        for name, content in files.items():
            archive.writestr(name, content)


def find_chrome() -> str | None:
    candidates = [
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe",
    ]
    for command in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser", "microsoft-edge"):
        located = shutil.which(command)
        if located:
            candidates.append(located)
    return next((candidate for candidate in candidates if Path(candidate).is_file()), None)


def write_pdf(html_path: Path, pdf_path: Path) -> None:
    chrome = find_chrome()
    if not chrome:
        raise WaybillError("未找到 Chrome/Chromium/Edge，无法从 HTML 同源导出 PDF")
    with tempfile.TemporaryDirectory(prefix="waybill-chrome-") as profile:
        command = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--user-data-dir={profile}", f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()]
        if hasattr(os, "geteuid") and os.geteuid() == 0:
            command.insert(1, "--no-sandbox")
        process = subprocess.Popen(
            command,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
            start_new_session=os.name != "nt",
        )
        deadline = time.monotonic() + 45
        previous_size = -1
        stable_checks = 0
        try:
            while time.monotonic() < deadline:
                if pdf_path.is_file():
                    current_size = pdf_path.stat().st_size
                    stable_checks = stable_checks + 1 if current_size > 0 and current_size == previous_size else 0
                    previous_size = current_size
                    if stable_checks >= 3:
                        break
                if process.poll() is not None and not pdf_path.is_file():
                    raise WaybillError(f"PDF 导出失败：浏览器退出码 {process.returncode}")
                time.sleep(0.2)
            else:
                raise WaybillError("PDF 导出超时：浏览器未在 45 秒内生成稳定文件")
        finally:
            if process.poll() is None:
                if os.name == "nt":
                    process.terminate()
                else:
                    os.killpg(process.pid, signal.SIGTERM)
                try:
                    process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    if os.name == "nt":
                        process.kill()
                    else:
                        os.killpg(process.pid, signal.SIGKILL)
                    process.wait(timeout=3)
    if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
        raise WaybillError("PDF 导出失败：浏览器未生成文件")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Generate logistics waybill preview and gated final artifacts")
    parser.add_argument("--input", required=True, type=Path, help="waybill-data.json")
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--template", type=Path, default=DEFAULT_TEMPLATE)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        data = json.loads(args.input.read_text(encoding="utf-8"))
        if not isinstance(data, dict):
            raise WaybillError("输入 JSON 顶层必须是对象")
        template = args.template.read_text(encoding="utf-8")
        state, blockers = document_state(data)
        args.output_dir.mkdir(parents=True, exist_ok=True)
        number = safe_name(text_value(get_value(data, "document.number")))
        html_path = args.output_dir / f"物流单_{number}_当前预览.html"
        rendered_html = fill_html(template, template_values(data, state), state, data)
        html_path.write_text(rendered_html, encoding="utf-8")
        generated = [str(html_path)]
        if args.mode == "export":
            if state not in ("pending_dispatch", "final"):
                raise WaybillError(f"当前状态 {state} 不允许导出，请先补齐并确认信息；阻塞项：{', '.join(blockers) or 'userConfirmed'}")
            edition = "待派车确认稿" if state == "pending_dispatch" else "最终版"
            xlsx_path = args.output_dir / f"物流单_{number}_{edition}.xlsx"
            pdf_path = args.output_dir / f"物流单_{number}_{edition}.pdf"
            write_xlsx(xlsx_path, data, state)
            write_pdf(html_path, pdf_path)
            generated.extend((str(pdf_path), str(xlsx_path)))
        print(json.dumps({
            "ok": True,
            "state": state,
            "label": status_label(state),
            "blockers": blockers,
            "files": generated,
            "inlineWidget": {
                "title": "当前物流单",
                "widget_code": inline_widget_fragment(rendered_html),
            },
        }, ensure_ascii=False))
        return 0
    except (OSError, json.JSONDecodeError, WaybillError, subprocess.TimeoutExpired) as error:
        print(json.dumps({"ok": False, "error": str(error)}, ensure_ascii=False), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
