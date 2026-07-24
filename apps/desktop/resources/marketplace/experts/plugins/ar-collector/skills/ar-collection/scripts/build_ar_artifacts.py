#!/usr/bin/env python3
"""Build AR collection board / follow-up list / Excel+CSV / automation proposals from ar-ledger.json."""

from __future__ import annotations

import argparse
import csv
import json
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time as _time
import zipfile
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from xml.sax.saxutils import escape
from zoneinfo import ZoneInfo


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


STYLE_PATTERN = re.compile(r"<style>([\s\S]*?)</style>", re.IGNORECASE)
AR_SECTION_PATTERN = re.compile(r'(<section\s+class="ar-preview">[\s\S]*?</section>)', re.IGNORECASE)
PRINT_MEDIA_PATTERN = re.compile(r"@media\s+print\s*\{(?:[^{}]|\{[^{}]*\})*\}", re.IGNORECASE)


def inline_widget_fragment(preview_html: str) -> str:
    """
    Inline widget fragment: extract <style> and the main ar-preview <section>,
    strip @media print rules to shrink payload. Mirrors order-entry's
    inline_widget_fragment handling so the host receives a trimmed fragment
    instead of the raw preview HTML.
    """
    style = STYLE_PATTERN.search(preview_html)
    section = AR_SECTION_PATTERN.search(preview_html)
    if not style or not section:
        return preview_html
    screen_css = PRINT_MEDIA_PATTERN.sub("", style.group(1))
    return f"<style>{screen_css}</style>{section.group(1)}"


def parse_date(value: str) -> date | None:
    raw = text(value)
    if not raw:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d"):
        try:
            return datetime.strptime(raw[:10], fmt).date()
        except ValueError:
            continue
    return None


def aging_days(due: date | None, as_of: date) -> int | None:
    if due is None:
        return None
    return (as_of - due).days


def node_for_row(due: date | None, as_of: date) -> str:
    days = aging_days(due, as_of)
    if days is None:
        return "unknown"
    if days < -7:
        return "open"
    if -7 <= days < 0:
        return "D-7"
    if days == 0:
        return "due"
    if 1 <= days <= 3:
        return "+3"
    if 4 <= days <= 15:
        return "+15"
    return f"+{days}" if days > 15 else "open"


def stage_for_node(node: str) -> str:
    if node in {"open"}:
        return "L0-watch"
    if node in {"D-7"}:
        return "L1-polite"
    if node in {"due", "+3"}:
        return "L2-formal"
    return "L3-escalate"


def load_ledger(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("ar-ledger.json must be an object")
    rows = data.get("rows")
    if not isinstance(rows, list):
        data["rows"] = []
    return data


def process_dir(output_dir: Path) -> Path:
    path = output_dir / ".process"
    path.mkdir(parents=True, exist_ok=True)
    return path


def slug(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:48] or "task"


def build_board(rows: list[dict[str, Any]], as_of: date) -> str:
    lines = [
        f"# AR collection board ({as_of.isoformat()})",
        "",
        "| Customer | Invoice | Open | Due | Aging | Node | Stage | Owner | Risk |",
        "| --- | --- | ---: | --- | ---: | --- | --- | --- | --- |",
    ]
    for row in rows:
        due = parse_date(text(row.get("dueDate")))
        node = text(row.get("nextNode")) or node_for_row(due, as_of)
        aging = aging_days(due, as_of)
        risk = ",".join(row.get("riskFlags") or []) if isinstance(row.get("riskFlags"), list) else text(row.get("riskFlags"))
        lines.append(
            "| {customer} | {invoice} | {open_amt} | {due} | {aging} | {node} | {stage} | {owner} | {risk} |".format(
                customer=text(row.get("customer")) or "-",
                invoice=text(row.get("invoiceNo")) or "-",
                open_amt=text(row.get("amountOpen")) or "0",
                due=due.isoformat() if due else "-",
                aging="" if aging is None else aging,
                node=node,
                stage=stage_for_node(node),
                owner=text(row.get("owner")) or "-",
                risk=risk or "-",
            )
        )
    lines.append("")
    return "\n".join(lines)


def build_follow_ups(rows: list[dict[str, Any]], as_of: date) -> str:
    buckets: dict[str, list[dict[str, Any]]] = {"D-7": [], "due": [], "+3": [], "+15": [], "other": []}
    for row in rows:
        status = text(row.get("status"))
        if status == "paid":
            continue
        open_amt = float(row.get("amountOpen") or 0)
        if open_amt <= 0:
            continue
        due = parse_date(text(row.get("dueDate")))
        node = text(row.get("nextNode")) or node_for_row(due, as_of)
        if node in buckets:
            buckets[node].append(row)
        elif node.startswith("+") and node not in {"+3", "+15"}:
            buckets["+15"].append(row)
        elif node == "D-7":
            buckets["D-7"].append(row)
        else:
            buckets["other"].append(row)

    lines = [f"# Follow-ups ({as_of.isoformat()})", ""]
    for key in ("D-7", "due", "+3", "+15", "other"):
        items = buckets[key]
        lines.append(f"## {key} ({len(items)})")
        if not items:
            lines.append("- (none)")
            lines.append("")
            continue
        for row in items:
            lines.append(
                "- **{customer}** `{invoice}` open={open_amt} owner={owner} stage={stage}".format(
                    customer=text(row.get("customer")) or "-",
                    invoice=text(row.get("invoiceNo")) or "-",
                    open_amt=text(row.get("amountOpen")) or "0",
                    owner=text(row.get("owner")) or "-",
                    stage=stage_for_node(text(row.get("nextNode")) or node_for_row(parse_date(text(row.get("dueDate"))), as_of)),
                )
            )
        lines.append("")
    return "\n".join(lines)


LEDGER_FIELDS = [
    "customer",
    "invoiceNo",
    "amountInvoiced",
    "amountPaid",
    "amountOpen",
    "dueDate",
    "agingDays",
    "status",
    "nextNode",
    "owner",
    "riskFlags",
]


def row_risk_flags(row: dict[str, Any]) -> str:
    risk = row.get("riskFlags")
    if isinstance(risk, list):
        return ",".join(text(item) for item in risk if text(item))
    return text(risk)


def row_has_risk(row: dict[str, Any], as_of: date) -> bool:
    flags = row_risk_flags(row)
    if flags:
        return True
    status = text(row.get("status")).lower()
    if status in {"overdue", "chronic_late", "disputed"}:
        return True
    due = parse_date(text(row.get("dueDate")))
    days = aging_days(due, as_of) if due else None
    if days is not None and days > 15:
        return True
    return False


def ledger_export_rows(rows: list[dict[str, Any]], as_of: date) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    for row in rows:
        due = parse_date(text(row.get("dueDate")))
        out.append({
            "customer": text(row.get("customer")),
            "invoiceNo": text(row.get("invoiceNo")),
            "amountInvoiced": text(row.get("amountInvoiced")),
            "amountPaid": text(row.get("amountPaid")),
            "amountOpen": text(row.get("amountOpen")),
            "dueDate": due.isoformat() if due else text(row.get("dueDate")),
            "agingDays": "" if aging_days(due, as_of) is None else str(aging_days(due, as_of)),
            "status": text(row.get("status")),
            "nextNode": text(row.get("nextNode")) or node_for_row(due, as_of),
            "owner": text(row.get("owner")),
            "riskFlags": row_risk_flags(row),
            "_risk": "1" if row_has_risk(row, as_of) else "",
        })
    return out


def write_csv(path: Path, rows: list[dict[str, Any]], as_of: date) -> None:
    export_rows = ledger_export_rows(rows, as_of)
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=LEDGER_FIELDS, extrasaction="ignore")
        writer.writeheader()
        for row in export_rows:
            writer.writerow(row)


def _col_letter(index: int) -> str:
    # 0 -> A
    n = index + 1
    letters = ""
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def write_xlsx(path: Path, rows: list[dict[str, Any]], as_of: date) -> None:
    """Write a minimal .xlsx (stdlib only) with risk rows highlighted in red."""
    export_rows = ledger_export_rows(rows, as_of)
    headers = LEDGER_FIELDS

    # style 0 = header, 1 = normal, 2 = risk (red fill)
    sheet_rows: list[str] = []
    # header
    cells = []
    for col, header in enumerate(headers):
        ref = f"{_col_letter(col)}1"
        cells.append(
            f'<c r="{ref}" t="inlineStr" s="1"><is><t>{escape(header)}</t></is></c>'
        )
    sheet_rows.append(f'<row r="1">{"".join(cells)}</row>')

    for r_idx, row in enumerate(export_rows, start=2):
        style = "2" if row.get("_risk") else "0"
        cells = []
        for col, field in enumerate(headers):
            ref = f"{_col_letter(col)}{r_idx}"
            value = escape(row.get(field, "") or "")
            cells.append(
                f'<c r="{ref}" t="inlineStr" s="{style}"><is><t>{value}</t></is></c>'
            )
        sheet_rows.append(f'<row r="{r_idx}">{"".join(cells)}</row>')

    sheet_xml = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        f'<sheetData>{"".join(sheet_rows)}</sheetData>'
        "</worksheet>"
    )

    styles_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill>
  </fills>
  <borders count="1"><border/></borders>
  <cellStyleXfs count="1"><xf/></cellStyleXfs>
  <cellXfs count="3">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
    <xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/>
  </cellXfs>
</styleSheet>
"""

    workbook_xml = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"
 xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="应收台账" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>
"""

    workbook_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>
"""

    root_rels = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>
"""

    content_types = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
</Types>
"""

    path.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED) as zf:
        zf.writestr("[Content_Types].xml", content_types)
        zf.writestr("_rels/.rels", root_rels)
        zf.writestr("xl/workbook.xml", workbook_xml)
        zf.writestr("xl/_rels/workbook.xml.rels", workbook_rels)
        zf.writestr("xl/styles.xml", styles_xml)
        zf.writestr("xl/worksheets/sheet1.xml", sheet_xml)


def write_scripts_pack(path: Path, rows: list[dict[str, Any]], as_of: date) -> None:
    lines = [f"# Collection scripts pack ({as_of.isoformat()})", ""]
    for row in rows:
        open_amt = float(row.get("amountOpen") or 0)
        if open_amt <= 0 or text(row.get("status")) == "paid":
            continue
        due = parse_date(text(row.get("dueDate")))
        node = text(row.get("nextNode")) or node_for_row(due, as_of)
        stage = stage_for_node(node)
        customer = text(row.get("customer")) or "客户"
        invoice = text(row.get("invoiceNo")) or ""
        amount = text(row.get("amountOpen")) or "0"
        due_s = due.isoformat() if due else text(row.get("dueDate")) or ""
        lines.append(f"## {customer} / {invoice} ({stage})")
        if stage == "L1-polite":
            lines.append(
                f"您好，我是贵司合作物流对接人。票号 {invoice} 余额 {amount} 元，"
                f"约定到期日 {due_s}，临近付款节点，烦请安排对账付款，感谢支持。"
            )
        elif stage == "L2-formal":
            lines.append(
                f"您好，票号 {invoice}（余额 {amount} 元）已到/刚过约定付款日 {due_s}。"
                f"请于今日确认付款计划或回传付款凭证，便于我司账务核销。"
            )
        else:
            lines.append(
                f"您好，票号 {invoice} 仍有未清余额 {amount} 元，账龄已超约定。"
                f"请今日内反馈明确付款日；若有争议请书面列明，否则我司将按内部风控升级跟进。"
            )
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_daily_automation_proposal(path: Path) -> None:
    payload = {
        "scene": "office",
        "title": "应收催收·每日看板",
        "prompt": (
            "你是应收催收作业专家。请读取工作区 ar-ledger.json，"
            "按 aging-nodes 与 data-protocol 刷新今日催收清单与话术档，"
            "更新 .process 看板；禁止编造金额与承诺。无新数据时简短说明。"
        ),
        "schedule": {
            "mode": "interval",
            "day": "daily",
            "time": "09:00",
            "intervalMinutes": 1440,
            "timezone": "Asia/Shanghai",
        },
        "enabled": True,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def next_reminder(due: date, not_before: date) -> tuple[date, str] | None:
    candidates = [
        (due - timedelta(days=7), "到期前7天"),
        (due, "到期日"),
        (due + timedelta(days=3), "逾期3天"),
        (due + timedelta(days=15), "逾期15天"),
    ]
    return next((item for item in candidates if item[0] >= not_before), None)


def write_invoice_proposals(
    proposal_dir: Path,
    rows: list[dict[str, Any]],
    as_of: date,
) -> list[Path]:
    proposal_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    not_before = max(as_of, date.today())
    timezone = ZoneInfo("Asia/Shanghai")
    for row in rows:
        if text(row.get("status")) == "paid" or float(row.get("amountOpen") or 0) <= 0:
            continue
        due = parse_date(text(row.get("dueDate")))
        if due is None:
            continue
        reminder = next_reminder(due, not_before)
        if reminder is None:
            continue
        reminder_date, node = reminder
        customer = text(row.get("customer")) or "客户"
        invoice = text(row.get("invoiceNo")) or "未编号"
        amount = text(row.get("amountOpen")) or "0"
        when = datetime.combine(reminder_date, time(hour=9), timezone)
        payload = {
            "scene": "office",
            "title": f"应收催收·{customer}·{invoice}·{node}",
            "prompt": (
                f"你是应收催收作业专家。读取 ar-ledger.json，只核对客户 {customer}、票号 {invoice} "
                f"当前余额与回款状态；若仍未结清，按 {node} 阶段生成可转发但不自动发送的催收话术，"
                "并提示负责人确认。禁止编造金额、承诺或付款状态。"
            ),
            "schedule": {
                "mode": "once",
                "day": "daily",
                "time": "09:00",
                "onceAt": int(when.timestamp() * 1000),
                "timezone": "Asia/Shanghai",
            },
            "enabled": True,
            "metadata": {
                "customer": customer,
                "invoiceNo": invoice,
                "amountOpenAtProposal": amount,
                "node": node,
            },
        }
        path = proposal_dir / f"ar-{slug(customer)}-{slug(invoice)}-next.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


PREVIEW_STYLE = """
.ar-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1080px;margin:0 auto;background:#fff}
.ar-preview *{box-sizing:border-box}
.ar-preview .ap-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#4c1d95,#6d28d9);color:#fff;border-radius:12px 12px 0 0}
.ar-preview .ap-top .title{font-size:17px;font-weight:600}
.ar-preview .ap-top .sub{font-size:12px;color:#ddd6fe;margin-top:4px}
.ar-preview .ap-top .meta{text-align:right;font-size:11px;color:#c4b5fd;line-height:1.6}
.ar-preview .ap-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.ar-preview .stats{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px}
.ar-preview .stat{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc}
.ar-preview .stat .k{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
.ar-preview .stat .v{font-size:20px;font-weight:700;color:#0f172a;margin-top:4px}
.ar-preview .stat.overdue .v{color:#dc2626}
.ar-preview .stat.watch .v{color:#d97706}
.ar-preview .buckets{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}
.ar-preview .bucket{border-radius:10px;padding:12px;border:1px solid #e2e8f0}
.ar-preview .bucket.d7{background:#fffbeb;border-color:#fde68a}
.ar-preview .bucket.due{background:#fef3c7;border-color:#fcd34d}
.ar-preview .bucket.p3{background:#fed7aa;border-color:#fb923c}
.ar-preview .bucket.p15{background:#fee2e2;border-color:#fca5a5}
.ar-preview .bucket .bk{font-size:12px;font-weight:700;color:#475569}
.ar-preview .bucket .bv{font-size:16px;font-weight:700;color:#0f172a;margin-top:4px}
.ar-preview .bucket .bn{font-size:11px;color:#64748b}
.ar-preview table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
.ar-preview th{background:#f1f5f9;padding:8px 10px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
.ar-preview td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.ar-preview tr.late td{background:#fef2f2}
.ar-preview tr.late td:first-child{border-left:3px solid #dc2626}
.ar-preview .num{text-align:right;font-variant-numeric:tabular-nums}
.ar-preview .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.ar-preview .tag.l0{background:#dcfce7;color:#15803d}
.ar-preview .tag.l1{background:#fef3c7;color:#b45309}
.ar-preview .tag.l2{background:#fed7aa;color:#c2410c}
.ar-preview .tag.l3{background:#fee2e2;color:#b91c1c}
.ar-preview .section-title{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
.ar-preview .ap-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
"""


def _stage_tag(node: str) -> str:
    stage = stage_for_node(node)
    cls = {"L0-watch": "l0", "L1-polite": "l1", "L2-formal": "l2", "L3-escalate": "l3"}.get(stage, "l0")
    label = {"L0-watch": "观察", "L1-polite": "礼貌提醒", "L2-formal": "正式催告", "L3-escalate": "升级"}.get(stage, stage)
    return f'<span class="tag {cls}">{escape(label)}</span>'


def _money(value: Any) -> str:
    return f"¥{float(value or 0):,.2f}"


def ar_preview_html(data: dict[str, Any], rows: list[dict[str, Any]], as_of: date) -> str:
    open_rows = [r for r in rows if text(r.get("status")) != "paid" and float(r.get("amountOpen") or 0) > 0]
    total_open = sum(float(r.get("amountOpen") or 0) for r in open_rows)
    overdue_total = sum(float(r.get("amountOpen") or 0) for r in open_rows if (aging_days(parse_date(text(r.get("dueDate"))), as_of) or 0) > 0)
    d7_count = sum(1 for r in open_rows if node_for_row(parse_date(text(r.get("dueDate"))), as_of) == "D-7")
    due_count = sum(1 for r in open_rows if node_for_row(parse_date(text(r.get("dueDate"))), as_of) == "due")
    risk_count = sum(1 for r in open_rows if (r.get("riskFlags") if isinstance(r.get("riskFlags"), list) else text(r.get("riskFlags"))))
    buckets: dict[str, list] = {"D-7": [], "due": [], "+3": [], "+15": []}
    for r in open_rows:
        node = text(r.get("nextNode")) or node_for_row(parse_date(text(r.get("dueDate"))), as_of)
        if node in buckets:
            buckets[node].append(r)
        elif node.startswith("+"):
            buckets["+15"].append(r)
    bucket_html = ""
    for key, label, cls in [("D-7", "D-7 待到期", "d7"), ("due", "到期", "due"), ("+3", "+3 逾期", "p3"), ("+15", "+15 逾期", "p15")]:
        items = buckets[key]
        amt = sum(float(r.get("amountOpen") or 0) for r in items)
        bucket_html += f'<div class="bucket {cls}"><div class="bk">{label}</div><div class="bv">{escape(_money(amt))}</div><div class="bn">{len(items)} 票</div></div>'
    table_rows = ""
    for r in open_rows:
        due = parse_date(text(r.get("dueDate")))
        node = text(r.get("nextNode")) or node_for_row(due, as_of)
        aging = aging_days(due, as_of)
        late = (aging or 0) > 0
        risk = r.get("riskFlags")
        risk_text = "、".join(risk) if isinstance(risk, list) else text(risk)
        table_rows += (
            f'<tr class="{"late" if late else ""}"><td>{escape(text(r.get("customer")) or "-")}</td>'
            f'<td>{escape(text(r.get("invoiceNo")) or "-")}</td><td class="num">{escape(_money(r.get("amountOpen")))}</td>'
            f'<td>{escape(due.isoformat() if due else "-")}</td><td class="num">{aging if aging is not None else "-"}</td>'
            f'<td>{escape(node)}</td><td>{_stage_tag(node)}</td>'
            f'<td>{escape(text(r.get("owner")) or "-")}</td><td>{escape(risk_text or "-")}</td></tr>'
        )
    table = f'<table><thead><tr><th>客户</th><th>票号</th><th>未结清</th><th>到期日</th><th>账龄天</th><th>节点</th><th>阶段</th><th>负责人</th><th>风险</th></tr></thead><tbody>{table_rows}</tbody></table>'
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="ar-preview">'
        f'<div class="ap-top"><div><div class="title">应收催收看板 · {escape(as_of.isoformat())}</div>'
        f'<div class="sub">{len(open_rows)} 笔未结清 · {len(rows)} 笔台账</div></div>'
        f'<div class="meta">未结清合计<br><b style="font-size:15px">{escape(_money(total_open))}</b></div></div>'
        f'<div class="ap-body"><div class="stats">'
        f'<div class="stat"><div class="k">未结清</div><div class="v">{escape(_money(total_open))}</div></div>'
        f'<div class="stat overdue"><div class="k">逾期金额</div><div class="v">{escape(_money(overdue_total))}</div></div>'
        f'<div class="stat watch"><div class="k">D-7</div><div class="v">{d7_count}</div></div>'
        f'<div class="stat"><div class="k">到期</div><div class="v">{due_count}</div></div>'
        f'<div class="stat overdue"><div class="k">风险笔数</div><div class="v">{risk_count}</div></div>'
        f'</div><div class="section-title">账龄节点分桶</div><div class="buckets">{bucket_html}</div>'
        f'<div class="section-title">应收台账</div>{table}'
        '<div class="ap-foot">本预览为过程看板，不自动入账/催收。确认后导出 Excel / PDF 正式交付物。</div></div></section>'
    )


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
    return next((c for c in candidates if Path(c).is_file()), None)


def write_pdfs(jobs: list[tuple[Path, Path]]) -> None:
    if not jobs:
        return
    chrome = find_chrome()
    if not chrome:
        raise RuntimeError("未找到 Chrome/Chromium/Edge，无法从 HTML 导出 PDF")
    with tempfile.TemporaryDirectory(prefix="ar-chrome-") as profile:
        for html_path, pdf_path in jobs:
            if pdf_path.exists():
                pdf_path.unlink()
            command = [
                chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer",
                "--hide-scrollbars", "--run-all-compositor-stages-before-draw",
                "--virtual-time-budget=5000", f"--user-data-dir={profile}",
                f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri(),
            ]
            if hasattr(os, "geteuid") and os.geteuid() == 0:
                command.insert(1, "--no-sandbox")
            process = subprocess.Popen(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=os.name != "nt")
            deadline = _time.monotonic() + 45
            previous_size = -1
            stable = 0
            try:
                while _time.monotonic() < deadline:
                    if pdf_path.is_file():
                        cur = pdf_path.stat().st_size
                        stable = stable + 1 if cur > 0 and cur == previous_size else 0
                        previous_size = cur
                        if stable >= 2:
                            break
                    if process.poll() is not None and not pdf_path.is_file():
                        raise RuntimeError(f"PDF 导出失败：浏览器退出码 {process.returncode}")
                    _time.sleep(0.1)
                else:
                    raise RuntimeError("PDF 导出超时：浏览器未在 45 秒内生成稳定文件")
            finally:
                if process.poll() is None:
                    if os.name == "nt":
                        process.terminate()
                    else:
                        os.killpg(process.pid, signal.SIGTERM)
                    try:
                        process.wait(timeout=2)
                    except subprocess.TimeoutExpired:
                        if os.name == "nt":
                            process.kill()
                        else:
                            os.killpg(process.pid, signal.SIGKILL)
                        process.wait(timeout=2)
            if not pdf_path.is_file() or pdf_path.stat().st_size == 0:
                raise RuntimeError("PDF 导出失败：浏览器未生成文件")


def _ledger_html(data: dict[str, Any], rows: list[dict[str, Any]], as_of: date) -> str:
    body = ar_preview_html(data, rows, as_of)
    return (
        '<!DOCTYPE html><html lang="zh"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>应收台账 · {escape(as_of.isoformat())}</title><body style="margin:0;padding:20px;background:#fff">{body}</body></html>'
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    ledger = load_ledger(args.input)
    as_of = parse_date(text(ledger.get("asOfDate"))) or date.today()
    rows = [row for row in ledger.get("rows", []) if isinstance(row, dict)]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    proc = process_dir(args.output_dir)
    preview_html = ar_preview_html(ledger, rows, as_of)
    preview_path = proc / "ar-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    files = [str(preview_path)]

    payload: dict[str, Any] = {
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "rowCount": len(rows),
        "files": files,
        "inlineWidget": {"title": "应收催收看板预览", "widget_code": inline_widget_fragment(preview_html)},
    }

    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        xlsx_path = args.output_dir / f"应收台账_{stamp}.xlsx"
        pdf_path = args.output_dir / f"应收台账_{stamp}.pdf"
        scripts_path = args.output_dir / f"催收话术_{stamp}.md"
        proposal_path = args.output_dir / "automations" / "proposals" / "ar-daily-board.json"
        write_xlsx(xlsx_path, rows, as_of)
        write_scripts_pack(scripts_path, rows, as_of)
        write_daily_automation_proposal(proposal_path)
        invoice_proposals = write_invoice_proposals(proposal_path.parent, rows, as_of)
        files.append(str(xlsx_path))
        files.append(str(scripts_path))
        ledger_html = _ledger_html(ledger, rows, as_of)
        html_tmp = proc / f"ledger_{stamp}.html"
        html_tmp.write_text(ledger_html, encoding="utf-8")
        try:
            write_pdfs([(html_tmp, pdf_path)])
            files.append(str(pdf_path))
        except Exception as error:
            payload["pdfError"] = str(error)
        files.append(str(proposal_path))
        files.extend(str(path) for path in invoice_proposals)
        payload["files"] = files

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
