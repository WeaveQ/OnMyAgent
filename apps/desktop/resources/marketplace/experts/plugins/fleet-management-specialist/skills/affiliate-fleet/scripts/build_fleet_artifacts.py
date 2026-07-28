#!/usr/bin/env python3
"""Build fleet compliance boards, CSV, chase scripts, automation proposals."""

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
from html import escape
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


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


def remaining_days(expire: date | None, as_of: date) -> int | None:
    if expire is None:
        return None
    return (expire - as_of).days


def level(days: int | None) -> str:
    if days is None:
        return "unknown"
    if days < 0:
        return "expired"
    if days <= 7:
        return "D-7"
    if days <= 15:
        return "D-15"
    if days <= 30:
        return "D-30"
    return "ok"


DOC_LABELS = {
    "driverLicenseExpire": "驾驶证",
    "qualificationExpire": "从业资格",
    "vehicleLicenseExpire": "行驶证",
    "operationPermitExpire": "营运证",
    "compulsoryExpire": "交强险",
    "commercialExpire": "商业险",
    "annualInspectionExpire": "年检",
}


def collect_items(vehicle: dict[str, Any], as_of: date) -> list[tuple[str, date | None, int | None, str]]:
    items: list[tuple[str, date | None, int | None, str]] = []
    docs = vehicle.get("docs") if isinstance(vehicle.get("docs"), dict) else {}
    insurance = vehicle.get("insurance") if isinstance(vehicle.get("insurance"), dict) else {}
    pairs = [
        *[(k, docs.get(k)) for k in ("driverLicenseExpire", "qualificationExpire", "vehicleLicenseExpire", "operationPermitExpire")],
        *[(k, insurance.get(k)) for k in ("compulsoryExpire", "commercialExpire")],
        ("annualInspectionExpire", vehicle.get("annualInspectionExpire")),
    ]
    for key, raw in pairs:
        d = parse_date(text(raw))
        days = remaining_days(d, as_of)
        items.append((DOC_LABELS.get(key, key), d, days, level(days)))
    return items


def worst_level(levels: list[str]) -> str:
    order = ["expired", "D-7", "D-15", "D-30", "unknown", "ok"]
    for name in order:
        if name in levels:
            return name
    return "ok"


def load_ledger(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("fleet-ledger.json must be an object")
    if not isinstance(data.get("vehicles"), list):
        data["vehicles"] = []
    return data


def process_dir(output_dir: Path) -> Path:
    path = output_dir / ".process"
    path.mkdir(parents=True, exist_ok=True)
    return path


def build_expiry_board(vehicles: list[dict[str, Any]], as_of: date) -> str:
    lines = [
        f"# Fleet expiry board ({as_of.isoformat()})",
        "",
        "| Plate | Driver | Worst | Open violations | Notes |",
        "| --- | --- | --- | ---: | --- |",
    ]
    for vehicle in vehicles:
        items = collect_items(vehicle, as_of)
        worst = worst_level([item[3] for item in items])
        lines.append(
            "| {plate} | {driver} | {worst} | {vio} | {notes} |".format(
                plate=text(vehicle.get("plate")) or "-",
                driver=text(vehicle.get("driverName")) or "-",
                worst=worst,
                vio=text(vehicle.get("violationsOpen")) or "0",
                notes=text(vehicle.get("notes")) or "-",
            )
        )
    lines.append("")
    lines.append("## Details")
    for vehicle in vehicles:
        plate = text(vehicle.get("plate")) or "-"
        lines.append(f"### {plate}")
        for label, d, days, lvl in collect_items(vehicle, as_of):
            if lvl == "ok":
                continue
            lines.append(
                f"- {label}: {d.isoformat() if d else '?'} ({lvl}, remaining={days})"
            )
        lines.append("")
    return "\n".join(lines)


def build_high_risk(vehicles: list[dict[str, Any]], as_of: date) -> str:
    lines = [f"# High risk ({as_of.isoformat()})", ""]
    count = 0
    for vehicle in vehicles:
        items = collect_items(vehicle, as_of)
        flags = vehicle.get("riskFlags") if isinstance(vehicle.get("riskFlags"), list) else []
        reasons: list[str] = [text(f) for f in flags if text(f)]
        for label, _d, days, lvl in items:
            if lvl in {"expired", "D-7"}:
                reasons.append(f"{label}:{lvl}")
            if label in {"交强险", "商业险"} and days is not None and days <= 15:
                reasons.append(f"{label}:insurance-tight")
        if int(float(text(vehicle.get("violationsOpen")) or 0)) >= 3:
            reasons.append("violations>=3")
        if not reasons:
            continue
        count += 1
        lines.append(
            f"- **{text(vehicle.get('plate')) or '-'}** / {text(vehicle.get('driverName')) or '-'} — {', '.join(reasons)}"
        )
    if count == 0:
        lines.append("- (none)")
    lines.append("")
    return "\n".join(lines)


def write_csv(path: Path, vehicles: list[dict[str, Any]], as_of: date) -> None:
    fields = [
        "plate", "driverName", "ownerOrAffiliate", "worstLevel", "violationsOpen",
        "compulsoryExpire", "commercialExpire", "driverLicenseExpire", "annualInspectionExpire",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for vehicle in vehicles:
            docs = vehicle.get("docs") if isinstance(vehicle.get("docs"), dict) else {}
            insurance = vehicle.get("insurance") if isinstance(vehicle.get("insurance"), dict) else {}
            items = collect_items(vehicle, as_of)
            writer.writerow({
                "plate": text(vehicle.get("plate")),
                "driverName": text(vehicle.get("driverName")),
                "ownerOrAffiliate": text(vehicle.get("ownerOrAffiliate")),
                "worstLevel": worst_level([i[3] for i in items]),
                "violationsOpen": text(vehicle.get("violationsOpen")),
                "compulsoryExpire": text(insurance.get("compulsoryExpire")),
                "commercialExpire": text(insurance.get("commercialExpire")),
                "driverLicenseExpire": text(docs.get("driverLicenseExpire")),
                "annualInspectionExpire": text(vehicle.get("annualInspectionExpire")),
            })


def write_chase_scripts(path: Path, vehicles: list[dict[str, Any]], as_of: date) -> None:
    lines = [f"# Renewal chase scripts ({as_of.isoformat()})", ""]
    for vehicle in vehicles:
        plate = text(vehicle.get("plate")) or "车辆"
        driver = text(vehicle.get("driverName")) or "师傅"
        phone = text(vehicle.get("driverPhone"))
        hot = [(label, d, days, lvl) for label, d, days, lvl in collect_items(vehicle, as_of) if lvl in {"expired", "D-7", "D-15"}]
        if not hot:
            continue
        detail = "、".join(
            f"{label}({d.isoformat() if d else '?'}·{lvl})" for label, d, _days, lvl in hot
        )
        lines.append(f"## {plate} / {driver}")
        lines.append(
            f"{driver}您好，挂靠车辆 {plate} 资料需尽快处理：{detail}。"
            f"请于本周内回传更新后的证件/保单影像，避免影响派车。"
            + (f"（联系电话登记：{phone}）" if phone else "")
        )
        lines.append("")
    path.write_text("\n".join(lines), encoding="utf-8")


def write_daily_proposal(path: Path) -> None:
    payload = {
        "scene": "office",
        "title": "挂靠车管·每日到期扫描",
        "prompt": (
            "你是挂靠车管作业专家。读取 fleet-ledger.json，按 expiry-alerts 刷新到期与高风险清单，"
            "更新 .process；禁止编造证件与保险日期。"
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


def slug(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:48] or "item"


def next_expiry_reminder(
    vehicle: dict[str, Any],
    as_of: date,
) -> tuple[date, str, date, str] | None:
    not_before = max(as_of, date.today())
    candidates: list[tuple[date, str, date, str]] = []
    for label, expire, _days, _level in collect_items(vehicle, as_of):
        if expire is None:
            continue
        for offset, node in ((30, "D-30"), (15, "D-15"), (7, "D-7"), (0, "到期日")):
            reminder_date = expire - timedelta(days=offset)
            if reminder_date >= not_before:
                candidates.append((reminder_date, label, expire, node))
    return min(candidates, key=lambda item: (item[0], item[1])) if candidates else None


def write_vehicle_proposals(
    proposal_dir: Path,
    vehicles: list[dict[str, Any]],
    as_of: date,
) -> list[Path]:
    proposal_dir.mkdir(parents=True, exist_ok=True)
    timezone = ZoneInfo("Asia/Shanghai")
    paths: list[Path] = []
    for vehicle in vehicles:
        reminder = next_expiry_reminder(vehicle, as_of)
        if reminder is None:
            continue
        reminder_date, doc_label, expire, node = reminder
        plate = text(vehicle.get("plate")) or "未登记车辆"
        driver = text(vehicle.get("driverName")) or "未登记司机"
        when = datetime.combine(reminder_date, time(hour=9), timezone)
        payload = {
            "scene": "office",
            "title": f"挂靠车管·{plate}·{doc_label}·{node}",
            "prompt": (
                f"你是挂靠车管作业专家。读取 fleet-ledger.json，只复核车辆 {plate}、司机 {driver} "
                f"的 {doc_label}（台账到期日 {expire.isoformat()}）；若仍未更新，生成对内催办与资料补齐话术，"
                "提醒负责人确认。禁止编造日期，禁止自动停运、清退或发送外部消息。"
            ),
            "schedule": {
                "mode": "once",
                "day": "daily",
                "time": "09:00",
                "onceAt": int(when.timestamp() * 1000),
                "timezone": "Asia/Shanghai",
            },
            "enabled": True,
        }
        path = proposal_dir / f"fleet-{slug(plate)}-{slug(doc_label)}-next.json"
        path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        paths.append(path)
    return paths


PREVIEW_STYLE = """
.fleet-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1080px;margin:0 auto;background:#fff}
.fleet-preview *{box-sizing:border-box}
.fleet-preview .fp-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#064e3b,#047857);color:#fff;border-radius:12px 12px 0 0}
.fleet-preview .fp-top .title{font-size:17px;font-weight:600}
.fleet-preview .fp-top .sub{font-size:12px;color:#a7f3d0;margin-top:4px}
.fleet-preview .fp-top .meta{text-align:right;font-size:11px;color:#6ee7b7;line-height:1.6}
.fleet-preview .fp-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.fleet-preview .stats{display:grid;grid-template-columns:repeat(6,1fr);gap:10px;margin-bottom:16px}
.fleet-preview .stat{border:1px solid #e2e8f0;border-radius:10px;padding:10px 12px;background:#f8fafc}
.fleet-preview .stat .k{font-size:10px;color:#64748b;font-weight:600;text-transform:uppercase}
.fleet-preview .stat .v{font-size:18px;font-weight:700;color:#0f172a;margin-top:2px}
.fleet-preview .stat.danger .v{color:#dc2626}
.fleet-preview .stat.warn .v{color:#d97706}
.fleet-preview table{width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px}
.fleet-preview th{background:#f1f5f9;padding:8px 10px;text-align:left;font-weight:600;color:#475569;border-bottom:1px solid #e2e8f0}
.fleet-preview td{padding:8px 10px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.fleet-preview tr.late td{background:#fef2f2}
.fleet-preview tr.late td:first-child{border-left:3px solid #dc2626}
.fleet-preview tr.warn td{background:#fffbeb}
.fleet-preview .num{text-align:right;font-variant-numeric:tabular-nums}
.fleet-preview .tag{display:inline-block;font-size:10px;padding:1px 6px;border-radius:4px;font-weight:600}
.fleet-preview .tag.expired{background:#fee2e2;color:#b91c1c}
.fleet-preview .tag.D-7{background:#fecaca;color:#b91c1c}
.fleet-preview .tag.D-15{background:#fed7aa;color:#c2410c}
.fleet-preview .tag.D-30{background:#fef3c7;color:#b45309}
.fleet-preview .tag.ok{background:#dcfce7;color:#15803d}
.fleet-preview .tag.unknown{background:#f1f5f9;color:#64748b}
.fleet-preview .section-title{font-size:13px;font-weight:700;color:#334155;margin:16px 0 8px;padding-bottom:4px;border-bottom:2px solid #e2e8f0}
.fleet-preview .risk-item{border:1px solid #fecaca;border-radius:8px;padding:10px 12px;margin-bottom:8px;background:#fef2f2;font-size:12px}
.fleet-preview .risk-item .ri-title{font-weight:700;color:#991b1b;margin-bottom:4px}
.fleet-preview .risk-item .ri-reason{color:#7f1d1d;font-size:11px}
.fleet-preview .fp-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
"""


_LEVEL_LABEL = {"expired": "过期", "D-7": "D-7", "D-15": "D-15", "D-30": "D-30", "ok": "正常", "unknown": "未知"}


def _level_tag(lvl: str) -> str:
    return f'<span class="tag {escape(lvl)}">{escape(_LEVEL_LABEL.get(lvl, lvl))}</span>'


def fleet_preview_html(ledger: dict[str, Any], vehicles: list[dict[str, Any]], as_of: date) -> str:
    counts = {"expired": 0, "D-7": 0, "D-15": 0, "D-30": 0}
    risk_items = ""
    table_rows = ""
    for v in vehicles:
        items = collect_items(v, as_of)
        worst = worst_level([i[3] for i in items])
        if worst in counts:
            counts[worst] += 1
        late = worst in {"expired", "D-7"}
        warn = worst in {"D-15", "D-30"}
        cls = "late" if late else ("warn" if warn else "")
        violations = int(float(text(v.get("violationsOpen")) or 0))
        table_rows += (
            f'<tr class="{cls}"><td>{escape(text(v.get("plate")) or "-")}</td>'
            f'<td>{escape(text(v.get("driverName")) or "-")}</td>'
            f'<td>{escape(text(v.get("ownerOrAffiliate")) or "-")}</td>'
            f'<td>{_level_tag(worst)}</td><td class="num">{violations}</td></tr>'
        )
        # high risk
        flags = v.get("riskFlags") if isinstance(v.get("riskFlags"), list) else []
        reasons = [text(f) for f in flags if text(f)]
        for label, _d, days, lvl in items:
            if lvl in {"expired", "D-7"}:
                reasons.append(f"{label}:{lvl}")
            if label in {"交强险", "商业险"} and days is not None and days <= 15:
                reasons.append(f"{label}:即将到期")
        if violations >= 3:
            reasons.append("违章≥3")
        if reasons:
            risk_items += (
                f'<div class="risk-item"><div class="ri-title">{escape(text(v.get("plate")) or "-")} / '
                f'{escape(text(v.get("driverName")) or "-")}</div>'
                f'<div class="ri-reason">{escape("、".join(reasons))}</div></div>'
            )
    expired_total = counts["expired"]
    table = f'<table><thead><tr><th>车牌</th><th>司机</th><th>挂靠/车主</th><th>最差级别</th><th>未处理违章</th></tr></thead><tbody>{table_rows}</tbody></table>'
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="fleet-preview">'
        f'<div class="fp-top"><div><div class="title">挂靠车合规看板 · {escape(as_of.isoformat())}</div>'
        f'<div class="sub">{len(vehicles)} 辆车 · 过期 {expired_total} 辆</div></div>'
        f'<div class="meta">D-7: {counts["D-7"]}<br>D-15: {counts["D-15"]}<br>D-30: {counts["D-30"]}</div></div>'
        f'<div class="fp-body"><div class="stats">'
        f'<div class="stat"><div class="k">车辆</div><div class="v">{len(vehicles)}</div></div>'
        f'<div class="stat danger"><div class="k">过期</div><div class="v">{counts["expired"]}</div></div>'
        f'<div class="stat danger"><div class="k">D-7</div><div class="v">{counts["D-7"]}</div></div>'
        f'<div class="stat warn"><div class="k">D-15</div><div class="v">{counts["D-15"]}</div></div>'
        f'<div class="stat warn"><div class="k">D-30</div><div class="v">{counts["D-30"]}</div></div>'
        f'<div class="stat"><div class="k">正常</div><div class="v">{sum(1 for v in vehicles if worst_level([i[3] for i in collect_items(v, as_of)]) == "ok")}</div></div>'
        f'</div><div class="section-title">车辆台账</div>{table}'
        f'<div class="section-title">高风险预警</div>{risk_items or "<div class=risk-item><div class=ri-title>本周期无高风险</div></div>"}'
        '<div class="fp-foot">合规看板为过程产物，确认后导出 Excel / PDF。确认后可创建每日扫描 + 30/15/7 天到期提醒自动化。</div></div></section>'
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


def write_xlsx(path: Path, vehicles: list[dict[str, Any]], as_of: date) -> None:
    """Sheet1 台账汇总(到期标红); Sheet2 到期详情."""
    s1_headers = ["车牌", "司机", "挂靠/车主", "最差级别", "未处理违章", "驾驶证", "从业资格", "行驶证", "营运证", "交强险", "商业险", "年检"]
    s1_rows: list[list[Any]] = []
    risk_idx: set[int] = set()
    for i, v in enumerate(vehicles):
        items = collect_items(v, as_of)
        worst = worst_level([it[3] for it in items])
        if worst in {"expired", "D-7", "D-15", "D-30"}:
            risk_idx.add(i)
        docs = v.get("docs") if isinstance(v.get("docs"), dict) else {}
        insurance = v.get("insurance") if isinstance(v.get("insurance"), dict) else {}
        s1_rows.append([
            text(v.get("plate")), text(v.get("driverName")), text(v.get("ownerOrAffiliate")),
            _LEVEL_LABEL.get(worst, worst), int(float(text(v.get("violationsOpen")) or 0)),
            text(docs.get("driverLicenseExpire")), text(docs.get("qualificationExpire")),
            text(docs.get("vehicleLicenseExpire")), text(docs.get("operationPermitExpire")),
            text(insurance.get("compulsoryExpire")), text(insurance.get("commercialExpire")),
            text(v.get("annualInspectionExpire")),
        ])
    s2_headers = ["车牌", "证件/保险", "到期日", "剩余天", "级别"]
    s2_rows: list[list[Any]] = []
    for v in vehicles:
        for label, d, days, lvl in collect_items(v, as_of):
            if lvl == "ok":
                continue
            s2_rows.append([text(v.get("plate")), label, d.isoformat() if d else "", days if days is not None else "", _LEVEL_LABEL.get(lvl, lvl)])
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
        '<sheets><sheet name="台账汇总" sheetId="1" r:id="rId1"/><sheet name="到期详情" sheetId="2" r:id="rId2"/></sheets></workbook>')
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
    with tempfile.TemporaryDirectory(prefix="fleet-chrome-") as profile:
        for html_path, pdf_path in jobs:
            if pdf_path.exists():
                pdf_path.unlink()
            command = [chrome, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", "--hide-scrollbars",
                "--run-all-compositor-stages-before-draw", "--virtual-time-budget=5000", f"--user-data-dir={profile}",
                f"--print-to-pdf={pdf_path}", html_path.resolve().as_uri()]
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


def _ledger_html(ledger: dict[str, Any], vehicles: list[dict[str, Any]], as_of: date) -> str:
    body = fleet_preview_html(ledger, vehicles, as_of)
    return ('<!DOCTYPE html><html lang="zh"><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width,initial-scale=1">'
        f'<title>挂靠车台账 · {escape(as_of.isoformat())}</title>'
        f'<body style="margin:0;padding:20px;background:#fff">{body}</body></html>')


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    ledger = load_ledger(args.input)
    as_of = parse_date(text(ledger.get("asOfDate"))) or date.today()
    vehicles = [v for v in ledger.get("vehicles", []) if isinstance(v, dict)]

    args.output_dir.mkdir(parents=True, exist_ok=True)
    proc = process_dir(args.output_dir)
    preview_html = fleet_preview_html(ledger, vehicles, as_of)
    preview_path = proc / "fleet-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    files = [str(preview_path)]

    payload: dict[str, Any] = {
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "vehicleCount": len(vehicles),
        "files": files,
        "inlineWidget": {"title": "挂靠车合规看板预览", "widget_code": preview_html},
    }

    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        xlsx_path = args.output_dir / f"挂靠车台账_{stamp}.xlsx"
        pdf_path = args.output_dir / f"挂靠车台账_{stamp}.pdf"
        scripts_path = args.output_dir / f"催办话术_{stamp}.md"
        proposal = args.output_dir / "automations" / "proposals" / "fleet-daily-scan.json"
        write_xlsx(xlsx_path, vehicles, as_of)
        write_chase_scripts(scripts_path, vehicles, as_of)
        write_daily_proposal(proposal)
        vehicle_proposals = write_vehicle_proposals(proposal.parent, vehicles, as_of)
        files.append(str(xlsx_path))
        files.append(str(scripts_path))
        ledger_html = _ledger_html(ledger, vehicles, as_of)
        html_tmp = proc / f"ledger_{stamp}.html"
        html_tmp.write_text(ledger_html, encoding="utf-8")
        try:
            write_pdfs([(html_tmp, pdf_path)])
            files.append(str(pdf_path))
        except Exception as error:
            payload["pdfError"] = str(error)
        files.append(str(proposal))
        files.extend(str(path) for path in vehicle_proposals)
        payload["files"] = files

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
