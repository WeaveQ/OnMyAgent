#!/usr/bin/env python3
"""Build warehouse stock snapshot, anomaly list, brief, CSVs, automation proposals."""

from __future__ import annotations

import argparse
import csv
import json
import os
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


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


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


def load_ledger(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("warehouse-ledger.json must be an object")
    if not isinstance(data.get("movements"), list):
        data["movements"] = []
    if not isinstance(data.get("balances"), list):
        data["balances"] = []
    if not isinstance(data.get("anomalies"), list):
        data["anomalies"] = []
    return data


def process_dir(output_dir: Path) -> Path:
    path = output_dir / ".process"
    path.mkdir(parents=True, exist_ok=True)
    return path


def dwell_days(inbound: date | None, as_of: date) -> int | None:
    if inbound is None:
        return None
    return (as_of - inbound).days


def build_snapshot(balances: list[dict[str, Any]], as_of: date, dwell_alert: int) -> str:
    lines = [
        f"# Stock snapshot ({as_of.isoformat()})",
        "",
        "| Waybill | SKU | Bin | Qty | Unit | Inbound | Dwell | Status |",
        "| --- | --- | --- | ---: | --- | --- | ---: | --- |",
    ]
    for row in balances:
        inbound = parse_date(text(row.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        status = text(row.get("status")) or "in_stock"
        if dwell is not None and dwell >= dwell_alert and status == "in_stock":
            status = f"dwell>={dwell_alert}d"
        lines.append(
            "| {wb} | {sku} | {bin_} | {qty} | {unit} | {inbound} | {dwell} | {status} |".format(
                wb=text(row.get("waybill")) or "-",
                sku=text(row.get("sku")) or "-",
                bin_=text(row.get("bin")) or "-",
                qty=text(row.get("qty")) or "0",
                unit=text(row.get("unit")) or "-",
                inbound=inbound.isoformat() if inbound else text(row.get("inboundDate")) or "-",
                dwell="" if dwell is None else dwell,
                status=status,
            )
        )
    lines.append("")
    return "\n".join(lines)


def build_anomalies(
    balances: list[dict[str, Any]],
    anomalies: list[dict[str, Any]],
    as_of: date,
    dwell_alert: int,
) -> str:
    lines = [f"# Anomalies ({as_of.isoformat()})", ""]
    derived = 0
    for row in balances:
        qty = float(text(row.get("qty")) or 0)
        if qty < 0:
            derived += 1
            lines.append(
                f"- **negative_stock** {text(row.get('waybill'))} bin={text(row.get('bin'))} qty={qty}"
            )
        inbound = parse_date(text(row.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        if dwell is not None and dwell >= dwell_alert and text(row.get("status")) in {"", "in_stock"}:
            derived += 1
            lines.append(
                f"- **overstay** {text(row.get('waybill'))} dwell={dwell}d bin={text(row.get('bin'))}"
            )
    for item in anomalies:
        if not isinstance(item, dict):
            continue
        derived += 1
        lines.append(
            f"- **{text(item.get('type')) or 'anomaly'}** {text(item.get('object')) or '-'} "
            f"book={text(item.get('book'))} physical={text(item.get('physical'))} "
            f"note={text(item.get('note')) or '-'}"
        )
    if derived == 0:
        lines.append("- (none)")
    lines.append("")
    return "\n".join(lines)


def build_brief(
    movements: list[dict[str, Any]],
    balances: list[dict[str, Any]],
    as_of: date,
    dwell_alert: int,
) -> str:
    counts = {"in": 0, "out": 0, "transfer": 0, "count_gain": 0, "count_loss": 0, "adjust": 0}
    for move in movements:
        if not isinstance(move, dict):
            continue
        key = text(move.get("type")) or "adjust"
        counts[key] = counts.get(key, 0) + 1
    overstay = 0
    for row in balances:
        inbound = parse_date(text(row.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        if dwell is not None and dwell >= dwell_alert:
            overstay += 1
    lines = [
        f"# Daily brief ({as_of.isoformat()})",
        "",
        f"- movements in/out/transfer: {counts.get('in', 0)}/{counts.get('out', 0)}/{counts.get('transfer', 0)}",
        f"- count gain/loss/adjust: {counts.get('count_gain', 0)}/{counts.get('count_loss', 0)}/{counts.get('adjust', 0)}",
        f"- balance lines: {len(balances)}",
        f"- overstay (>={dwell_alert}d): {overstay}",
        "",
    ]
    return "\n".join(lines)


def write_balance_csv(path: Path, balances: list[dict[str, Any]], as_of: date) -> None:
    fields = ["waybill", "sku", "bin", "qty", "unit", "inboundDate", "dwellDays", "status"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in balances:
            inbound = parse_date(text(row.get("inboundDate")))
            writer.writerow({
                "waybill": text(row.get("waybill")),
                "sku": text(row.get("sku")),
                "bin": text(row.get("bin")),
                "qty": text(row.get("qty")),
                "unit": text(row.get("unit")),
                "inboundDate": inbound.isoformat() if inbound else text(row.get("inboundDate")),
                "dwellDays": dwell_days(inbound, as_of) if inbound else "",
                "status": text(row.get("status")),
            })


def write_movement_csv(path: Path, movements: list[dict[str, Any]]) -> None:
    fields = ["time", "type", "waybill", "sku", "qtyDelta", "unit", "bin", "operator", "note"]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for move in movements:
            if not isinstance(move, dict):
                continue
            writer.writerow({key: text(move.get(key)) for key in fields})


def write_daily_proposal(path: Path) -> None:
    payload = {
        "scene": "office",
        "title": "仓储·每日库存简报",
        "prompt": (
            "你是仓储作业专家。读取 warehouse-ledger.json，按 anomaly-playbook 刷新异常与滞留，"
            "生成当日进销存简报到 .process；禁止编造件数与货位。"
        ),
        "schedule": {
            "mode": "interval",
            "day": "daily",
            "time": "18:00",
            "intervalMinutes": 1440,
            "timezone": "Asia/Shanghai",
        },
        "enabled": True,
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


PREVIEW_STYLE = """
.wh-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1080px;margin:0 auto;background:#fff}
.wh-preview *{box-sizing:border-box}
.wh-preview .wp-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#0c4a6e,#0369a1);color:#fff;border-radius:12px 12px 0 0}
.wh-preview .wp-top .title{font-size:17px;font-weight:600}
.wh-preview .wp-top .sub{font-size:12px;color:#bae6fd;margin-top:4px}
.wh-preview .wp-top .meta{text-align:right;font-size:11px;color:#7dd3fc;line-height:1.6}
.wh-preview .wp-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.wh-preview .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px}
.wh-preview .stat{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc}
.wh-preview .stat .k{font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase}
.wh-preview .stat .v{font-size:18px;font-weight:700;color:#0f172a;margin-top:2px}
.wh-preview .stat.danger .v{color:#dc2626}
.wh-preview .stat.warn .v{color:#d97706}
.wh-preview table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
.wh-preview th{background:#f1f5f9;padding:8px 10px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
.wh-preview td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.wh-preview tr.late td{background:#fffbeb}
.wh-preview tr.late td:first-child{border-left:3px solid #d97706}
.wh-preview tr.neg td{background:#fef2f2}
.wh-preview tr.neg td:first-child{border-left:3px solid #dc2626}
.wh-preview .num{text-align:right;font-variant-numeric:tabular-nums}
.wh-preview .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.wh-preview .tag.in_stock{background:#dcfce7;color:#15803d}
.wh-preview .tag.dwell{background:#fef3c7;color:#b45309}
.wh-preview .tag.negative{background:#fee2e2;color:#b91c1c}
.wh-preview .tag.out{background:#f1f5f9;color:#64748b}
.wh-preview .section-title{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
.wh-preview .anomaly-item{border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fef2f2;font-size:12px}
.wh-preview .anomaly-item .ai-title{font-weight:700;color:#991b1b;margin-bottom:4px}
.wh-preview .anomaly-item .ai-detail{color:#7f1d1d;font-size:11px}
.wh-preview .wp-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
"""


def _status_tag(row: dict[str, Any], dwell: int | None, dwell_alert: int) -> str:
    qty = float(text(row.get("qty")) or 0)
    status = text(row.get("status")) or "in_stock"
    if qty < 0:
        return '<span class="tag negative">负库存</span>'
    if dwell is not None and dwell >= dwell_alert and status in {"", "in_stock"}:
        return f'<span class="tag dwell">滞留{dwell}d</span>'
    if status == "out":
        return '<span class="tag out">已出</span>'
    return '<span class="tag in_stock">在库</span>'


def warehouse_preview_html(ledger, movements, balances, anomalies, as_of, dwell_alert) -> str:
    counts = {"in": 0, "out": 0, "transfer": 0, "count_gain": 0, "count_loss": 0, "adjust": 0}
    for m in movements:
        counts[text(m.get("type")) or "adjust"] = counts.get(text(m.get("type")) or "adjust", 0) + 1
    overstay = 0
    neg_count = 0
    table_rows = ""
    for r in balances:
        inbound = parse_date(text(r.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        qty = float(text(r.get("qty")) or 0)
        is_neg = qty < 0
        is_late = (dwell is not None and dwell >= dwell_alert and text(r.get("status")) in {"", "in_stock"})
        if is_late:
            overstay += 1
        if is_neg:
            neg_count += 1
        cls = "neg" if is_neg else ("late" if is_late else "")
        table_rows += (
            f'<tr class="{cls}"><td>{escape(text(r.get("waybill")) or "-")}</td>'
            f'<td>{escape(text(r.get("sku")) or "-")}</td><td>{escape(text(r.get("bin")) or "-")}</td>'
            f'<td class="num">{qty:g}</td><td>{escape(text(r.get("unit")) or "-")}</td>'
            f'<td>{escape(inbound.isoformat() if inbound else text(r.get("inboundDate")) or "-")}</td>'
            f'<td class="num">{dwell if dwell is not None else "-"}</td><td>{_status_tag(r, dwell, dwell_alert)}</td></tr>'
        )
    table = f'<table><thead><tr><th>运单</th><th>SKU</th><th>货位</th><th>数量</th><th>单位</th><th>入库日</th><th>滞留天</th><th>状态</th></tr></thead><tbody>{table_rows}</tbody></table>'
    # anomalies
    anom_items = ""
    anom_count = 0
    for r in balances:
        qty = float(text(r.get("qty")) or 0)
        if qty < 0:
            anom_count += 1
            anom_items += f'<div class="anomaly-item"><div class="ai-title">负库存 · {escape(text(r.get("waybill")) or "-")}</div><div class="ai-detail">货位 {escape(text(r.get("bin")) or "-")}，数量 {qty:g}</div></div>'
        inbound = parse_date(text(r.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        if dwell is not None and dwell >= dwell_alert and text(r.get("status")) in {"", "in_stock"}:
            anom_count += 1
            anom_items += f'<div class="anomaly-item"><div class="ai-title">滞留 · {escape(text(r.get("waybill")) or "-")}</div><div class="ai-detail">滞留 {dwell}d（≥{dwell_alert}d），货位 {escape(text(r.get("bin")) or "-")}</div></div>'
    for item in anomalies:
        if not isinstance(item, dict):
            continue
        anom_count += 1
        anom_items += (
            f'<div class="anomaly-item"><div class="ai-title">{escape(text(item.get("type")) or "异常")} · {escape(text(item.get("object")) or "-")}</div>'
            f'<div class="ai-detail">账面 {escape(text(item.get("book")) or "-")} / 实盘 {escape(text(item.get("physical")) or "-")}；{escape(text(item.get("note")) or "-")}</div></div>'
        )
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="wh-preview">'
        f'<div class="wp-top"><div><div class="title">仓储库存看板 · {escape(as_of.isoformat())}</div>'
        f'<div class="sub">{len(balances)} 条库存 · {len(movements)} 笔流水</div></div>'
        f'<div class="meta">滞留 {overstay}<br>异常 {anom_count}</div></div>'
        f'<div class="wp-body"><div class="stats">'
        f'<div class="stat"><div class="k">入库</div><div class="v">{counts.get("in",0)}</div></div>'
        f'<div class="stat"><div class="k">出库</div><div class="v">{counts.get("out",0)}</div></div>'
        f'<div class="stat"><div class="k">移库</div><div class="v">{counts.get("transfer",0)}</div></div>'
        f'<div class="stat"><div class="k">盘点盈</div><div class="v">{counts.get("count_gain",0)}</div></div>'
        f'<div class="stat warn"><div class="k">滞留</div><div class="v">{overstay}</div></div>'
        f'<div class="stat danger"><div class="k">负库存</div><div class="v">{neg_count}</div></div>'
        f'</div><div class="section-title">库存台账</div>{table}'
        f'<div class="section-title">异常清单（{anom_count}）</div>{anom_items or "<div class=anomaly-item><div class=ai-title>本周期无异常</div></div>"}'
        '<div class="wp-foot">本预览为过程看板，确认后导出 Excel / PDF。货动必有账，异常为线索。</div></div></section>'
    )


def _col_letter(n: int) -> str:
    letters = ""
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _sheet_xml(headers: list[str], rows: list[list[Any]], risk_rows: set[int] | None = None) -> str:
    risk_rows = risk_rows or set()
    out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
           '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>']
    head = "".join(f'<c r="{_col_letter(c)}1" t="inlineStr" s="1"><is><t>{escape(str(h))}</t></is></c>' for c, h in enumerate(headers))
    out.append(f'<row r="1">{head}</row>')
    for r_idx, row in enumerate(rows, start=2):
        style = "2" if (r_idx - 2) in risk_rows else "0"
        cells = "".join(f'<c r="{_col_letter(c)}{r_idx}" t="inlineStr" s="{style}"><is><t>{escape(str(v))}</t></is></c>' for c, v in enumerate(row))
        out.append(f'<row r="{r_idx}">{cells}</row>')
    out.append('</sheetData></worksheet>')
    return "".join(out)


def write_xlsx(path: Path, balances: list[dict[str, Any]], movements: list[dict[str, Any]], as_of: date, dwell_alert: int) -> None:
    """Sheet1 库存台账(滞留/负库存标红); Sheet2 流水."""
    s1_headers = ["运单", "SKU", "货位", "数量", "单位", "入库日", "滞留天", "状态"]
    s1_rows: list[list[Any]] = []
    risk_idx: set[int] = set()
    for i, r in enumerate(balances):
        inbound = parse_date(text(r.get("inboundDate")))
        dwell = dwell_days(inbound, as_of)
        qty = float(text(r.get("qty")) or 0)
        if qty < 0 or (dwell is not None and dwell >= dwell_alert and text(r.get("status")) in {"", "in_stock"}):
            risk_idx.add(i)
        s1_rows.append([text(r.get("waybill")), text(r.get("sku")), text(r.get("bin")), qty, text(r.get("unit")),
                        inbound.isoformat() if inbound else text(r.get("inboundDate")), dwell if dwell is not None else "", text(r.get("status")) or "in_stock"])
    s2_headers = ["时间", "类型", "运单", "SKU", "数量变动", "单位", "货位", "操作人", "备注"]
    s2_rows: list[list[Any]] = []
    for m in movements:
        s2_rows.append([text(m.get("time")), text(m.get("type")), text(m.get("waybill")), text(m.get("sku")),
                        text(m.get("qtyDelta")), text(m.get("unit")), text(m.get("bin")), text(m.get("operator")), text(m.get("note"))])
    s1 = _sheet_xml(s1_headers, s1_rows, risk_idx)
    s2 = _sheet_xml(s2_headers, s2_rows)
    styles = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>'
        '<fill><patternFill patternType="solid"><fgColor rgb="FFFFC7CE"/><bgColor indexed="64"/></patternFill></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>'
        '<xf numFmtId="0" fontId="0" fillId="2" borderId="0" xfId="0" applyFill="1"/></cellXfs></styleSheet>')
    workbook = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="库存台账" sheetId="1" r:id="rId1"/><sheet name="流水" sheetId="2" r:id="rId2"/></sheets></workbook>')
    rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
        '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet2.xml"/>'
        '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
    content_types = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/worksheets/sheet2.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>')
    root_rels = ('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>')
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("xl/workbook.xml", workbook)
        z.writestr("xl/_rels/workbook.xml.rels", rels)
        z.writestr("xl/worksheets/sheet1.xml", s1)
        z.writestr("xl/worksheets/sheet2.xml", s2)
        z.writestr("xl/styles.xml", styles)


def find_chrome() -> str | None:
    candidates = ["/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
        "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
        r"C:\Program Files\Google\Chrome\Application\chrome.exe",
        r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"]
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
    with tempfile.TemporaryDirectory(prefix="warehouse-chrome-") as profile:
        for html_path, pdf_path in jobs:
            if pdf_path.exists():
                pdf_path.unlink()
            command = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--hide-scrollbars",
                "--run-all-compositor-stages-before-draw", "--virtual-time-budget=5000", f"--user-data-dir={profile}",
                f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()]
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


def _ledger_html(ledger, movements, balances, anomalies, as_of, dwell_alert) -> str:
    body = warehouse_preview_html(ledger, movements, balances, anomalies, as_of, dwell_alert)
    return ('<!DOCTYPE html><html lang="zh"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>仓储台账 · {escape(as_of.isoformat())}</title>'
        f'<body style="margin:0;padding:20px;background:#fff">{body}</body></html>')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    ledger = load_ledger(args.input)
    as_of = parse_date(text(ledger.get("asOfDate"))) or date.today()
    dwell_alert = int(ledger.get("dwellAlertDays") or 7)
    movements = [m for m in ledger.get("movements", []) if isinstance(m, dict)]
    balances = [b for b in ledger.get("balances", []) if isinstance(b, dict)]
    anomalies = [a for a in ledger.get("anomalies", []) if isinstance(a, dict)]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    proc = process_dir(args.output_dir)
    preview_html = warehouse_preview_html(ledger, movements, balances, anomalies, as_of, dwell_alert)
    preview_path = proc / "warehouse-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    files = [str(preview_path)]

    payload: dict[str, Any] = {
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "movementCount": len(movements),
        "balanceCount": len(balances),
        "files": files,
        "inlineWidget": {"title": "仓储库存看板预览", "widget_code": preview_html},
    }

    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        xlsx_path = args.output_dir / f"库存台账_{stamp}.xlsx"
        pdf_path = args.output_dir / f"库存台账_{stamp}.pdf"
        proposal = args.output_dir / "automations" / "proposals" / "warehouse-daily-brief.json"
        write_xlsx(xlsx_path, balances, movements, as_of, dwell_alert)
        write_daily_proposal(proposal)
        files.append(str(xlsx_path))
        ledger_html = _ledger_html(ledger, movements, balances, anomalies, as_of, dwell_alert)
        html_tmp = proc / f"ledger_{stamp}.html"
        html_tmp.write_text(ledger_html, encoding="utf-8")
        try:
            write_pdfs([(html_tmp, pdf_path)])
            files.append(str(pdf_path))
        except Exception as error:
            payload["pdfError"] = str(error)
        files.append(str(proposal))
        payload["files"] = files

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
