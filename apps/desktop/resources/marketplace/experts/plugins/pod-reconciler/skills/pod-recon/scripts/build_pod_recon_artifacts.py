#!/usr/bin/env python3
"""Build POD reconciliation HTML preview, Excel, PDF and automation artifacts."""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import signal
import subprocess
import tempfile
import time
import zipfile
from datetime import date, datetime
from html import escape
from pathlib import Path
from typing import Any


FEE_FIELDS = (
    "freight", "emptyRun", "waiting", "unloading",
    "fuelSubsidy", "informationFee", "penalty", "other",
)
REASON_CODES = {
    "WAITING_FEE", "EMPTY_RUN", "UNLOADING_FEE", "FUEL_SUBSIDY",
    "INFORMATION_FEE", "PENALTY", "DUPLICATE_LINE", "MISSING_LINE", "WAIT_VERIFY",
}
REASON_LABELS = {
    "WAITING_FEE": "等候费差异", "EMPTY_RUN": "放空费差异", "UNLOADING_FEE": "卸货费差异",
    "FUEL_SUBSIDY": "油补差异", "INFORMATION_FEE": "信息费差异", "PENALTY": "罚款差异",
    "DUPLICATE_LINE": "重复计费", "MISSING_LINE": "漏记行", "WAIT_VERIFY": "待查证",
}


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    raw = text(value).replace(",", "")
    if not raw:
        return None
    try:
        parsed = float(raw)
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def parse_date(value: Any) -> date | None:
    raw = text(value)
    if not raw:
        return None
    try:
        return datetime.strptime(raw[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:64] or "recon"


def load_data(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("pod-recon-data.json must be an object")
    return data


def pod_satisfies(status: str, rule: str) -> bool:
    if rule == "pod_not_required":
        return True
    if rule == "electronic_allowed":
        return status in {"original", "electronic", "photo"}
    return status == "original"


def build_rows(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    as_of = parse_date(data.get("asOfDate")) or date.today()
    threshold = number(data.get("varianceThreshold")) or 50
    large_threshold = number(data.get("largeVarianceThreshold")) or 2000
    rule = text(data.get("settlementRule")) or "original_required"
    raw_rows = data.get("records") if isinstance(data.get("records"), list) else []
    rows: list[dict[str, Any]] = []
    unmatched: list[dict[str, Any]] = []
    for index, raw in enumerate(raw_rows, start=1):
        if not isinstance(raw, dict):
            unmatched.append({"row": index, "reason": "记录不是对象"})
            continue
        waybill = text(raw.get("waybillNo"))
        fees = raw.get("fees") if isinstance(raw.get("fees"), dict) else {}
        fee_values = [number(fees.get(field)) for field in FEE_FIELDS]
        counterparty = number(raw.get("counterpartyAmount"))
        missing_fields: list[str] = []
        if not waybill:
            missing_fields.append("waybillNo")
        missing_fields.extend(
            f"fees.{field}" for field, value in zip(FEE_FIELDS, fee_values) if value is None
        )
        if counterparty is None:
            missing_fields.append("counterpartyAmount")
        if missing_fields:
            unmatched.append({"row": index, "waybillNo": waybill, "reason": "缺少 " + "、".join(missing_fields)})
            continue
        own_amount = round(sum(value for value in fee_values if value is not None), 2)
        variance = round(counterparty - own_amount, 2)
        pod_status = text(raw.get("podStatus")) or "missing"
        due_date = parse_date(raw.get("dueDate"))
        overdue_days = max(0, (as_of - due_date).days) if due_date else None
        reason_code = text(raw.get("varianceReasonCode"))
        if reason_code not in REASON_CODES:
            reason_code = "WAIT_VERIFY"
        has_variance = abs(variance) > threshold
        large_variance = abs(variance) > large_threshold
        pod_ok = pod_satisfies(pod_status, rule)
        recommendation = "建议结算"
        if not pod_ok:
            recommendation = "暂缓：回单条件未满足"
        if has_variance:
            recommendation = "暂缓：费用差异待核"
        if large_variance:
            recommendation = "人工拍板：大额差异"
        rows.append({
            "waybillNo": waybill, "route": text(raw.get("route")), "driverName": text(raw.get("driverName")),
            "podStatus": pod_status, "podHolder": text(raw.get("podHolder")), "dueDate": text(raw.get("dueDate")),
            "overdueDays": overdue_days, "ownAmount": own_amount, "counterpartyAmount": round(counterparty, 2),
            "variance": variance, "hasVariance": has_variance, "largeVariance": large_variance,
            "reasonCode": reason_code if has_variance else "", "recommendation": recommendation,
            "notes": text(raw.get("notes")),
        })
    return rows, unmatched


def money(value: float) -> str:
    return f"¥{value:,.2f}"


def totals(rows: list[dict[str, Any]]) -> dict[str, float]:
    own = round(sum(r["ownAmount"] for r in rows), 2)
    counterparty = round(sum(r["counterpartyAmount"] for r in rows), 2)
    return {"own": own, "counterparty": counterparty, "variance": round(counterparty - own, 2)}


PREVIEW_STYLE = """
.recon-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1080px;margin:0 auto;background:#fff}
.recon-preview *{box-sizing:border-box}
.recon-preview .rp-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#0f172a,#334155);color:#fff;border-radius:12px 12px 0 0}
.recon-preview .rp-top .title{font-size:17px;font-weight:600}
.recon-preview .rp-top .sub{font-size:12px;color:#cbd5e1;margin-top:4px}
.recon-preview .rp-top .meta{text-align:right;font-size:11px;color:#94a3b8;line-height:1.6}
.recon-preview .rp-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.recon-preview .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px}
.recon-preview .stat{border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;background:#f8fafc}
.recon-preview .stat .k{font-size:11px;color:#64748b;font-weight:600;text-transform:uppercase;letter-spacing:.3px}
.recon-preview .stat .v{font-size:20px;font-weight:700;color:#0f172a;margin-top:4px}
.recon-preview .stat.var .v{color:#dc2626}
.recon-preview .stat.ok .v{color:#059669}
.recon-preview .conclusion{background:#eff6ff;border:1px solid #60a5fa;border-radius:10px;padding:14px 16px;margin-bottom:16px;font-size:13px;color:#1e40af;line-height:1.7}
.recon-preview .conclusion b{color:#1e3a8a}
.recon-preview table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
.recon-preview th{background:#f1f5f9;padding:8px 10px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
.recon-preview td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.recon-preview tr.var td{background:#fef2f2}
.recon-preview tr.var td:first-child{border-left:3px solid #dc2626}
.recon-preview tr.late td{background:#fffbeb}
.recon-preview .num{text-align:right;font-variant-numeric:tabular-nums}
.recon-preview .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.recon-preview .tag.red{background:#fee2e2;color:#b91c1c}
.recon-preview .tag.amber{background:#fef3c7;color:#b45309}
.recon-preview .tag.green{background:#dcfce7;color:#15803d}
.recon-preview .tag.gray{background:#f1f5f9;color:#64748b}
.recon-preview .section-title{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
.recon-preview .rp-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
"""


def _pod_tag(status: str) -> str:
    cls = {"original": "green", "electronic": "green", "photo": "amber", "missing": "red"}.get(status, "gray")
    label = {"original": "原件", "electronic": "电子", "photo": "照片", "missing": "缺失"}.get(status, status)
    return f'<span class="tag {cls}">{escape(label)}</span>'


def _summary_card(data, rows, unmatched, t) -> str:
    var_count = sum(1 for r in rows if r["hasVariance"])
    late_count = sum(1 for r in rows if r["overdueDays"] and r["overdueDays"] > 0)
    settle_count = sum(1 for r in rows if r["recommendation"] == "建议结算")
    var_cls = "var" if t["variance"] != 0 else "ok"
    return (
        '<div class="stats">'
        f'<div class="stat"><div class="k">我方合计</div><div class="v">{escape(money(t["own"]))}</div></div>'
        f'<div class="stat"><div class="k">对方合计</div><div class="v">{escape(money(t["counterparty"]))}</div></div>'
        f'<div class="stat {var_cls}"><div class="k">合计差异</div><div class="v">{escape(money(t["variance"]))}</div></div>'
        f'<div class="stat"><div class="k">差异票数</div><div class="v">{var_count}<span style="font-size:12px;font-weight:400;color:#94a3b8"> / {len(rows)}</span></div></div>'
        f'<div class="stat"><div class="k">超期回单</div><div class="v">{late_count}</div></div>'
        f'<div class="stat ok"><div class="k">可结算</div><div class="v">{settle_count}</div></div>'
        f'<div class="stat"><div class="k">无法匹配</div><div class="v">{len(unmatched)}</div></div>'
        f'<div class="stat"><div class="k">账期</div><div class="v" style="font-size:14px">{escape(text(data.get("period")) or "未设")}</div></div>'
        '</div>'
    )


def _conclusion_card(data, rows, t) -> str:
    var_count = sum(1 for r in rows if r["hasVariance"])
    large = [r for r in rows if r["largeVariance"]]
    late = [r for r in rows if r["overdueDays"] and r["overdueDays"] > 0]
    bits = []
    if t["variance"] == 0:
        bits.append("我方与对方合计<b>一致</b>")
    else:
        bits.append(f"合计差异 <b>{escape(money(t['variance']))}</b>（对方{('多' if t['variance']>0 else '少')}列）")
    if var_count:
        bits.append(f"<b>{var_count}</b> 票费用差异待核")
    if large:
        bits.append(f"<b>{len(large)}</b> 票大额差异须人工拍板")
    if late:
        bits.append(f"<b>{len(late)}</b> 票回单超期需催收")
    if not bits:
        bits.append("结构化字段齐全，可推进对账")
    return f'<div class="conclusion">{" ｜ ".join(bits)}。建议先核差异、催超期回单，再确认结算。</div>'


def _recon_table_html(rows) -> str:
    head = "".join(f"<th>{h}</th>" for h in ["运单", "线路", "我方", "对方", "差异", "回单", "原因", "建议"])
    body = ""
    for r in rows:
        cls = "var" if r["hasVariance"] else ("late" if r["overdueDays"] and r["overdueDays"] > 0 else "")
        reason = REASON_LABELS.get(r["reasonCode"], r["reasonCode"]) if r["reasonCode"] else '<span class="tag gray">-</span>'
        var_tag = f'<span class="tag red">{escape(money(r["variance"]))}</span>' if r["hasVariance"] else escape(money(r["variance"]))
        body += (
            f'<tr class="{cls}"><td>{escape(r["waybillNo"])}</td><td>{escape(r["route"] or "-")}</td>'
            f'<td class="num">{escape(money(r["ownAmount"]))}</td><td class="num">{escape(money(r["counterpartyAmount"]))}</td>'
            f'<td class="num">{var_tag}</td><td>{_pod_tag(r["podStatus"])}</td>'
            f'<td>{reason}</td><td>{escape(r["recommendation"])}</td></tr>'
        )
    return f'<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def _variance_list_html(rows) -> str:
    var_rows = [r for r in rows if r["hasVariance"]]
    if not var_rows:
        return '<div class="conclusion" style="background:#f0fdf4;border-color:#86efac;color:#15803d">无超过阈值的差异。</div>'
    body = ""
    for r in var_rows:
        reason = REASON_LABELS.get(r["reasonCode"], r["reasonCode"])
        body += (
            f'<tr class="var"><td>{escape(r["waybillNo"])}</td><td class="num">{escape(money(r["variance"]))}</td>'
            f'<td>{escape(reason)}</td><td>{escape(r["recommendation"])}</td>'
            f'<td>{escape(r["notes"] or "无证据说明")}</td></tr>'
        )
    head = "".join(f"<th>{h}</th>" for h in ["运单", "差异", "原因", "建议", "证据说明"])
    return f'<div class="section-title">差异清单（{len(var_rows)} 票）</div><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def _overdue_list_html(rows) -> str:
    late = [r for r in rows if r["overdueDays"] and r["overdueDays"] > 0]
    if not late:
        return ""
    body = ""
    for r in sorted(late, key=lambda x: -(x["overdueDays"] or 0)):
        body += (
            f'<tr class="late"><td>{escape(r["waybillNo"])}</td><td>{escape(r["driverName"] or "-")}</td>'
            f'<td>{_pod_tag(r["podStatus"])}</td><td>{escape(r["podHolder"] or "-")}</td>'
            f'<td class="num">{r["overdueDays"]}天</td><td>{escape(r["dueDate"] or "-")}</td></tr>'
        )
    head = "".join(f"<th>{h}</th>" for h in ["运单", "司机", "回单", "持有人", "超期", "应回日"])
    return f'<div class="section-title">超期回单（{len(late)} 票，需催收）</div><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>'


def recon_preview_html(data, rows, unmatched, t) -> str:
    period = text(data.get("period")) or "未设账期"
    counterparty = text(data.get("counterparty")) or "待确认"
    rule = text(data.get("settlementRule")) or "original_required"
    asof = text(data.get("asOfDate")) or ""
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="recon-preview">'
        f'<div class="rp-top"><div><div class="title">回单对账 · {escape(period)}</div>'
        f'<div class="sub">对方：{escape(counterparty)} · 结算规则：{escape(rule)}</div></div>'
        f'<div class="meta">{escape(asof)}<br>{len(rows)} 票运单</div></div>'
        f'<div class="rp-body">{_summary_card(data, rows, unmatched, t)}{_conclusion_card(data, rows, t)}'
        f'<div class="section-title">对账明细</div>{_recon_table_html(rows)}{_variance_list_html(rows)}{_overdue_list_html(rows)}'
        '<div class="rp-foot">本预览为过程草稿，不自动入账/付款/改回单状态。确认后导出 Excel / PDF 正式交付物。</div></div></section>'
    )


def _col_letter(n: int) -> str:
    letters = ""
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _sheet_xml(headers: list[str], rows: list[list[Any]], risk_rows: set[int] | None = None) -> str:
    risk_rows = risk_rows or set()
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>',
    ]
    head = "".join(
        f'<c r="{_col_letter(c)}1" t="inlineStr" s="1"><is><t>{escape(str(h))}</t></is></c>'
        for c, h in enumerate(headers)
    )
    out.append(f'<row r="1">{head}</row>')
    for r_idx, row in enumerate(rows, start=2):
        style = "2" if (r_idx - 2) in risk_rows else "0"
        cells = "".join(
            f'<c r="{_col_letter(c)}{r_idx}" t="inlineStr" s="{style}"><is><t>{escape(str(v))}</t></is></c>'
            for c, v in enumerate(row)
        )
        out.append(f'<row r="{r_idx}">{cells}</row>')
    out.append('</sheetData></worksheet>')
    return "".join(out)


def write_xlsx(path: Path, data, rows, unmatched, t) -> None:
    """Minimal .xlsx (stdlib). Sheet1 对账明细(差异标红); Sheet2 汇总."""
    s1_headers = ["运单", "线路", "司机", "我方金额", "对方金额", "差异", "回单", "原因码", "建议", "超期天", "应回日"]
    s1_rows: list[list[Any]] = []
    risk_idx: set[int] = set()
    for i, r in enumerate(rows):
        if r["hasVariance"]:
            risk_idx.add(i)
        s1_rows.append([
            r["waybillNo"], r["route"], r["driverName"], r["ownAmount"], r["counterpartyAmount"],
            r["variance"], r["podStatus"], r["reasonCode"] or "", r["recommendation"],
            r["overdueDays"] if r["overdueDays"] is not None else "", r["dueDate"],
        ])
    s2_headers = ["项", "值"]
    var_count = sum(1 for r in rows if r["hasVariance"])
    late_count = sum(1 for r in rows if r["overdueDays"] and r["overdueDays"] > 0)
    settle_count = sum(1 for r in rows if r["recommendation"] == "建议结算")
    s2_rows = [
        ["账期", text(data.get("period"))], ["对方", text(data.get("counterparty"))],
        ["结算规则", text(data.get("settlementRule"))], ["我方合计", t["own"]],
        ["对方合计", t["counterparty"]], ["合计差异", t["variance"]],
        ["差异票数", var_count], ["超期回单", late_count], ["可结算", settle_count],
        ["无法匹配", len(unmatched)],
    ]
    s1 = _sheet_xml(s1_headers, s1_rows, risk_idx)
    s2 = _sheet_xml(s2_headers, s2_rows)
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="3"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="对账明细" sheetId="1" r:id="rId1"/>'
        '<sheet name="汇总" sheetId="2" r:id="rId2"/></sheets></workbook>'
    )
    rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/worksheets/sheet1.xml", s1)
        z.writestr("xl/worksheets/sheet2.xml", s2)
        z.writestr("xl/styles.xml", styles)


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
    with tempfile.TemporaryDirectory(prefix="pod-recon-chrome-") as profile:
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
            deadline = time.monotonic() + 45
            previous_size = -1
            stable = 0
            try:
                while time.monotonic() < deadline:
                    if pdf_path.is_file():
                        cur = pdf_path.stat().st_size
                        stable = stable + 1 if cur > 0 and cur == previous_size else 0
                        previous_size = cur
                        if stable >= 2:
                            break
                    if process.poll() is not None and not pdf_path.is_file():
                        raise RuntimeError(f"PDF 导出失败：浏览器退出码 {process.returncode}")
                    time.sleep(0.1)
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


def _statement_html(data, rows, unmatched, t) -> str:
    body = recon_preview_html(data, rows, unmatched, t)
    period = text(data.get("period")) or "未设账期"
    return (
        '<!DOCTYPE html><html lang="zh"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>对账单 · {escape(period)}</title><body style="margin:0;padding:20px;background:#fff">{body}</body></html>'
    )


def _automation_proposal(data, rows) -> dict[str, Any] | None:
    late = [r for r in rows if r["overdueDays"] and r["overdueDays"] > 0]
    if not late:
        return None
    return {
        "title": "每日回单超期扫描",
        "prompt": (
            f"扫描 pod-recon-data.json，列出回单超期或缺失的运单并生成催回单话术草稿。"
            f"账期 {text(data.get('period'))}，当前超期 {len(late)} 票。"
        ),
        "schedule": {"type": "daily", "time": "09:00"},
        "source": "pod-recon",
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build POD reconciliation preview/export artifacts")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()
    data = load_data(args.input)
    rows, unmatched = build_rows(data)
    t = totals(rows)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    process = args.output_dir / ".process"
    process.mkdir(parents=True, exist_ok=True)
    preview_html = recon_preview_html(data, rows, unmatched, t)
    preview_path = process / "recon-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    files = [str(preview_path)]
    payload: dict[str, Any] = {
        "ok": True, "mode": args.mode, "period": text(data.get("period")),
        "rows": rows, "unmatched": unmatched, "totals": t, "files": files,
        "inlineWidget": {"title": "回单对账预览", "widget_code": preview_html},
    }
    if args.mode == "export":
        period = safe_name(text(data.get("period")))
        xlsx_path = args.output_dir / f"对账单_{period}.xlsx"
        pdf_path = args.output_dir / f"对账单_{period}.pdf"
        write_xlsx(xlsx_path, data, rows, unmatched, t)
        files.append(str(xlsx_path))
        statement_html = _statement_html(data, rows, unmatched, t)
        html_tmp = process / f"statement_{period}.html"
        html_tmp.write_text(statement_html, encoding="utf-8")
        try:
            write_pdfs([(html_tmp, pdf_path)])
            files.append(str(pdf_path))
        except Exception as error:
            payload["pdfError"] = str(error)
        proposal = _automation_proposal(data, rows)
        if proposal:
            prop_dir = args.output_dir / "automations" / "proposals"
            prop_dir.mkdir(parents=True, exist_ok=True)
            prop_path = prop_dir / "pod-overdue-scan.json"
            prop_path.write_text(json.dumps(proposal, ensure_ascii=False, indent=2), encoding="utf-8")
            files.append(str(prop_path))
        payload["files"] = files
    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
