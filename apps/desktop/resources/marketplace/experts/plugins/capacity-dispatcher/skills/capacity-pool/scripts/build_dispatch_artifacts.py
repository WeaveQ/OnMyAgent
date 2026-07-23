#!/usr/bin/env python3
"""Build capacity dispatch HTML preview, Excel and Word artifacts."""

from __future__ import annotations

import argparse
import json
import math
import re
import zipfile
from datetime import datetime
from html import escape
from pathlib import Path
from typing import Any


def text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def number(value: Any) -> float | None:
    if isinstance(value, bool):
        return None
    if isinstance(value, (int, float)) and math.isfinite(float(value)):
        return float(value)
    try:
        parsed = float(text(value).replace(",", ""))
    except ValueError:
        return None
    return parsed if math.isfinite(parsed) else None


def timestamp(value: Any) -> datetime | None:
    raw = text(value)
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo is not None else None


def string_list(value: Any) -> list[str]:
    return [text(item) for item in value if text(item)] if isinstance(value, list) else []


def safe_name(value: str) -> str:
    cleaned = re.sub(r"[^\w\-]+", "-", value, flags=re.UNICODE).strip("-")
    return cleaned[:64] or "dispatch"


def load_data(path: Path) -> dict[str, Any]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, dict):
        raise SystemExit("capacity-dispatch.json must be an object")
    return data


def mapping(data: dict[str, Any], key: str) -> dict[str, Any]:
    value = data.get(key)
    return value if isinstance(value, dict) else {}


def freshness(vehicle: dict[str, Any], as_of: datetime, fresh_minutes: float, aging_minutes: float) -> tuple[str, float | None]:
    updated = timestamp(vehicle.get("updatedAt"))
    if updated is None:
        return "stale", None
    minutes = max(0, (as_of - updated).total_seconds() / 60)
    if minutes <= fresh_minutes:
        return "fresh", round(minutes, 1)
    if minutes <= aging_minutes:
        return "aging", round(minutes, 1)
    return "stale", round(minutes, 1)


def region_matches(actual: str, expected: str) -> bool:
    return bool(actual and expected and (actual in expected or expected in actual))


def direction_matches(destinations: list[str], destination: str) -> bool:
    return any(region_matches(item, destination) for item in destinations)


def evaluate(
    vehicle: dict[str, Any],
    order: dict[str, Any],
    as_of: datetime,
    fresh_minutes: float,
    aging_minutes: float,
) -> tuple[dict[str, Any] | None, list[str]]:
    reasons: list[str] = []
    freshness_name, age_minutes = freshness(vehicle, as_of, fresh_minutes, aging_minutes)
    if freshness_name == "stale":
        reasons.append("运力信息 stale，须先确认")
    if text(vehicle.get("status")) != "available":
        reasons.append("车辆状态非 available")
    required_weight = number(order.get("weightKg"))
    remaining_weight = number(vehicle.get("remainingWeightKg"))
    if required_weight is None or remaining_weight is None:
        reasons.append("载重信息缺失")
    elif remaining_weight < required_weight:
        reasons.append("剩余载重不足")
    required_volume = number(order.get("volumeM3"))
    remaining_volume = number(vehicle.get("remainingVolumeM3"))
    if required_volume is None or remaining_volume is None:
        reasons.append("方数信息缺失")
    elif remaining_volume < required_volume:
        reasons.append("剩余方数不足")
    allowed_types = string_list(order.get("allowedVehicleTypes"))
    vehicle_type = text(vehicle.get("vehicleType"))
    if allowed_types and vehicle_type not in allowed_types:
        reasons.append("车型不符")
    required_capabilities = set(string_list(order.get("requiredCapabilities")))
    capabilities = set(string_list(vehicle.get("capabilities")))
    if not required_capabilities.issubset(capabilities):
        reasons.append("能力/资质不符")
    available_at = timestamp(vehicle.get("availableAt"))
    pickup_at = timestamp(order.get("pickupAt"))
    if available_at is None or pickup_at is None:
        reasons.append("可用或装货时间缺失")
    elif available_at > pickup_at:
        reasons.append("预计可用时间晚于装货时间")
    if reasons:
        return None, reasons

    origin = text(order.get("originRegion"))
    destination = text(order.get("destinationRegion"))
    current = text(vehicle.get("currentRegion"))
    willing = string_list(vehicle.get("willingDestinations"))
    empty_distance = number(vehicle.get("emptyDistanceKm"))
    score_parts = {
        "freshness": 30 if freshness_name == "fresh" else 15,
        "originFit": 25 if region_matches(current, origin) else 8,
        "directionWillingness": 20 if direction_matches(willing, destination) else 0,
        "emptyDistance": max(0, 20 - min(empty_distance if empty_distance is not None else 100, 100) * 0.2),
        "capacityKnown": 5,
    }
    score = round(sum(score_parts.values()), 2)
    risks = ["信息处于 aging，锁车前复核"] if freshness_name == "aging" else []
    if empty_distance is None:
        risks.append("空驶距离未知")
    return {
        "plate": text(vehicle.get("plate")) or "未登记车牌",
        "driverName": text(vehicle.get("driverName")) or "未登记司机",
        "vehicleType": vehicle_type,
        "currentRegion": current,
        "freshness": freshness_name,
        "ageMinutes": age_minutes,
        "emptyDistanceKm": empty_distance,
        "score": score,
        "scoreParts": score_parts,
        "reasons": [
            f"信息新鲜度 {freshness_name}",
            "起点区域贴合" if score_parts["originFit"] == 25 else "需额外空驶至起点",
            "司机方向意愿匹配" if score_parts["directionWillingness"] == 20 else "方向意愿未确认",
            "吨方与硬性能力通过",
        ],
        "risks": risks,
    }, []


def build_results(data: dict[str, Any]) -> tuple[list[dict[str, Any]], list[dict[str, Any]], dict[str, Any], datetime]:
    as_of = timestamp(data.get("asOf"))
    if as_of is None:
        raise SystemExit("asOf must be an ISO timestamp with timezone")
    order = mapping(data, "order")
    settings = mapping(data, "freshness")
    fresh_minutes = number(settings.get("freshMinutes")) or 60
    aging_minutes = number(settings.get("agingMinutes")) or 180
    vehicles = data.get("vehicles") if isinstance(data.get("vehicles"), list) else []
    candidates: list[dict[str, Any]] = []
    rejected: list[dict[str, Any]] = []
    for raw in vehicles:
        if not isinstance(raw, dict):
            continue
        candidate, reasons = evaluate(raw, order, as_of, fresh_minutes, aging_minutes)
        if candidate is not None:
            candidates.append(candidate)
        else:
            rejected.append({
                "plate": text(raw.get("plate")) or "未登记车牌",
                "driverName": text(raw.get("driverName")) or "未登记司机",
                "reasons": reasons,
            })
    candidates.sort(key=lambda item: (-item["score"], item["plate"]))
    return candidates[:3], rejected, order, as_of


def resolve_recommendation(order: dict[str, Any], candidates: list[dict[str, Any]]) -> tuple[int, str]:
    rec = order.get("recommendation")
    if isinstance(rec, dict):
        plate = text(rec.get("plate"))
        idx = next((i for i, c in enumerate(candidates) if c["plate"] == plate), None)
        if idx is not None:
            return idx, text(rec.get("reason")) or "调度指定推荐"
    if not candidates:
        return -1, "无通过硬性条件的候选，禁止勉强派车。"
    top = candidates[0]
    bits = []
    if top["scoreParts"]["originFit"] == 25:
        bits.append("起点区域贴合")
    if top["scoreParts"]["directionWillingness"] == 20:
        bits.append("司机方向意愿匹配")
    if top["scoreParts"]["freshness"] == 30:
        bits.append("信息新鲜")
    reason = "综合分最高" + ("（" + "、".join(bits) + "）" if bits else "")
    return 0, reason


PREVIEW_STYLE = """
.dispatch-preview{font-family:system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f172a;max-width:1040px;margin:0 auto;background:#fff}
.dispatch-preview *{box-sizing:border-box}
.dispatch-preview .dp-top{display:flex;justify-content:space-between;align-items:flex-start;padding:14px 16px;background:linear-gradient(135deg,#0f172a,#1e3a5f);color:#fff;border-radius:12px 12px 0 0}
.dispatch-preview .dp-top .route{font-size:17px;font-weight:600}
.dispatch-preview .dp-top .sub{font-size:12px;color:#cbd5e1;margin-top:4px}
.dispatch-preview .dp-top .qid{font-size:11px;color:#94a3b8;text-align:right;line-height:1.6}
.dispatch-preview .dp-body{padding:16px;border:1px solid #e2e8f0;border-top:none;border-radius:0 0 12px 12px}
.dispatch-preview .conclusion{background:#eff6ff;border:1px solid #60a5fa;border-radius:10px;padding:14px 16px;margin-bottom:18px}
.dispatch-preview .conclusion .label{font-size:11px;color:#2563eb;font-weight:600;letter-spacing:.5px}
.dispatch-preview .conclusion .pick{font-size:20px;font-weight:700;color:#1e3a8a;margin:4px 0}
.dispatch-preview .conclusion .reason{font-size:13px;color:#1e40af;line-height:1.6}
.dispatch-preview .conclusion .delta{font-size:12px;color:#475569;margin-top:8px}
.dispatch-preview .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:18px}
.dispatch-preview .card{border:1px solid #e2e8f0;border-radius:12px;background:#fff;overflow:hidden;position:relative}
.dispatch-preview .card.rec{border-color:#2563eb;box-shadow:0 4px 12px rgba(37,99,235,.18)}
.dispatch-preview .card .ch{padding:12px 14px;border-bottom:1px solid #f1f5f9}
.dispatch-preview .card.rec .ch{background:#eff6ff}
.dispatch-preview .rec-tag{display:inline-block;background:#2563eb;color:#fff;font-size:11px;padding:1px 8px;border-radius:999px;margin-left:6px;vertical-align:middle}
.dispatch-preview .card .rank{font-size:11px;color:#94a3b8;font-weight:600}
.dispatch-preview .card .plate{font-size:15px;font-weight:700;color:#0f172a;margin-top:2px}
.dispatch-preview .card .driver{font-size:12px;color:#475569;margin-top:1px}
.dispatch-preview .card .score{font-size:26px;font-weight:700;color:#1e3a8a;margin:8px 0 2px}
.dispatch-preview .card .score .unit{font-size:13px;font-weight:400;color:#94a3b8}
.dispatch-preview .card .metrics{display:grid;grid-template-columns:1fr 1fr;gap:1px;padding:0;background:#e2e8f0}
.dispatch-preview .card .metric{background:#f8fafc;padding:8px 14px}
.dispatch-preview .card .metric .k{color:#94a3b8;font-size:10px;text-transform:uppercase;letter-spacing:.3px}
.dispatch-preview .card .metric .v{color:#1e293b;font-weight:600;margin-top:2px;font-size:13px}
.dispatch-preview .card .pc{padding:10px 14px;font-size:12px;line-height:1.7}
.dispatch-preview .card .pc .grp{margin-bottom:6px}
.dispatch-preview .card .pc .gl{font-size:11px;font-weight:600;margin-bottom:2px}
.dispatch-preview .card .pc .gl.pro{color:#059669}
.dispatch-preview .card .pc .gl.con{color:#dc2626}
.dispatch-preview .card .pc ul{margin:0;padding-left:14px}
.dispatch-preview .card .pc .pro li{color:#047857}
.dispatch-preview .card .pc .con li{color:#b91c1c}
.dispatch-preview .empty{padding:24px;text-align:center;color:#94a3b8;font-size:13px;background:#f8fafc;border-radius:10px;margin-bottom:18px}
.dispatch-preview .bar-wrap{margin:4px 0 10px}
.dispatch-preview .bar-title{font-size:12px;font-weight:600;color:#475569;margin-bottom:10px}
.dispatch-preview .bar-row{display:flex;align-items:center;gap:10px;margin-bottom:8px;font-size:12px}
.dispatch-preview .bar-name{width:72px;color:#475569;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dispatch-preview .bar-track{flex:1;height:18px;background:#f1f5f9;border-radius:9px;overflow:hidden}
.dispatch-preview .bar-fill{height:100%;border-radius:9px;background:#2563eb}
.dispatch-preview .bar-amt{width:64px;text-align:right;color:#1e293b;font-weight:600}
.dispatch-preview .rejected{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.7}
.dispatch-preview .rejected .rt{font-weight:600;color:#64748b;margin-bottom:4px}
.dispatch-preview .dp-foot{font-size:11px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:10px;margin-top:8px;line-height:1.6}
@media (max-width:760px){.dispatch-preview .cards{grid-template-columns:1fr}.dispatch-preview .dp-top{flex-direction:column}}
"""


def _candidate_card(item: dict[str, Any], rank: int, is_rec: bool) -> str:
    score = f"{item['score']:.1f}"
    empty_km = f"{item['emptyDistanceKm']:g}km" if item["emptyDistanceKm"] is not None else "未知"
    age = f"{item['ageMinutes']:g}min" if item["ageMinutes"] is not None else "未知"
    pros_li = "".join(f"<li>{escape(r)}</li>" for r in item["reasons"])
    cons_li = "".join(f"<li>{escape(r)}</li>" for r in item["risks"]) if item["risks"] else "<li>无</li>"
    tag = '<span class="rec-tag">推荐</span>' if is_rec else ""
    cls = " rec" if is_rec else ""
    return (
        f'<div class="card{cls}"><div class="ch"><div class="rank">方案 {rank}</div>'
        f'<div class="plate">{escape(item["plate"])}{tag}</div>'
        f'<div class="driver">{escape(item["driverName"])}</div>'
        f'<div class="score">{escape(score)}<span class="unit"> 分</span></div></div>'
        f'<div class="metrics">'
        f'<div class="metric"><div class="k">车型</div><div class="v">{escape(item["vehicleType"])}</div></div>'
        f'<div class="metric"><div class="k">位置</div><div class="v">{escape(item["currentRegion"])}</div></div>'
        f'<div class="metric"><div class="k">空驶</div><div class="v">{escape(empty_km)}</div></div>'
        f'<div class="metric"><div class="k">新鲜度</div><div class="v">{escape(item["freshness"])} · {escape(age)}</div></div>'
        f'</div>'
        f'<div class="pc"><div class="grp"><div class="gl pro">✓ 优势</div><ul>{pros_li}</ul></div>'
        f'<div class="grp"><div class="gl con">⚠ 风险</div><ul>{cons_li}</ul></div></div></div>'
    )


def _conclusion_card(order, candidates, rec_idx, rec_reason) -> str:
    if not candidates or rec_idx < 0:
        return (
            '<div class="conclusion"><div class="label">无可用候选</div>'
            f'<div class="reason">{escape(rec_reason)}</div></div>'
        )
    rec = candidates[rec_idx]
    deltas: list[str] = []
    for i, c in enumerate(candidates):
        if i == rec_idx:
            continue
        diff = rec["score"] - c["score"]
        if diff > 0:
            deltas.append(f"比 {c['plate']} 高 {diff:.1f} 分")
    delta_html = f'<div class="delta">{"  ｜  ".join(deltas)}</div>' if deltas else ""
    return (
        '<div class="conclusion"><div class="label">推荐方案</div>'
        f'<div class="pick">{escape(rec["plate"])} · {escape(rec["driverName"])}</div>'
        f'<div class="reason">{escape(rec_reason)}</div>{delta_html}</div>'
    )


def _score_bar(candidates) -> str:
    if not candidates:
        return ""
    mx = max(c["score"] for c in candidates) or 1
    rows = ""
    for c in candidates:
        pct = int(c["score"] / mx * 100)
        rows += (
            f'<div class="bar-row"><div class="bar-name">{escape(c["plate"])}</div>'
            f'<div class="bar-track"><div class="bar-fill" style="width:{pct}%"></div></div>'
            f'<div class="bar-amt">{c["score"]:.1f}</div></div>'
        )
    return f'<div class="bar-wrap"><div class="bar-title">综合评分对比</div>{rows}</div>'


def dispatch_preview_html(data, candidates, rejected, order, as_of, rec_idx, rec_reason) -> str:
    route = f"{text(order.get('originRegion')) or '起点'} -> {text(order.get('destinationRegion')) or '终点'}"
    cargo = (
        f"{text(order.get('weightKg')) or '?'}kg / {text(order.get('volumeM3')) or '?'}m³ · "
        f"装货 {text(order.get('pickupAt')) or '待确认'}"
    )
    qid = text(order.get("orderId")) or "未编号"
    asof_text = as_of.strftime("%Y-%m-%d %H:%M") if as_of else ""
    if candidates:
        cards = "".join(
            _candidate_card(c, i + 1, i == rec_idx) for i, c in enumerate(candidates)
        )
        conclusion = _conclusion_card(order, candidates, rec_idx, rec_reason)
        bar = _score_bar(candidates)
    else:
        cards = ""
        conclusion = _conclusion_card(order, [], -1, rec_reason)
        bar = ""
    rejected_html = ""
    if rejected:
        items = "".join(
            f"<div>{escape(r['plate'])} / {escape(r['driverName'])}：{escape('、'.join(r['reasons']))}</div>"
            for r in rejected
        )
        rejected_html = f'<div class="rejected"><div class="rt">未入选运力（{len(rejected)}）</div>{items}</div>'
    return (
        f'<style>{PREVIEW_STYLE}</style>'
        '<section class="dispatch-preview">'
        f'<div class="dp-top"><div><div class="route">{escape(route)}</div>'
        f'<div class="sub">{escape(cargo)}</div></div>'
        f'<div class="qid">{escape(qid)}<br>{escape(asof_text)}</div></div>'
        f'<div class="dp-body">{conclusion}<div class="cards">{cards}</div>{bar}{rejected_html}'
        '<div class="dp-foot">调度建议草稿，不会自动锁车、改运力状态或发送消息。'
        '本预览为过程产物，确认后导出 Excel / Word 正式交付物。</div></div></section>'
    )


def _col_letter(n: int) -> str:
    letters = ""
    while n:
        n, rem = divmod(n - 1, 26)
        letters = chr(65 + rem) + letters
    return letters


def _sheet_xml(headers: list[str], rows: list[list[Any]]) -> str:
    out = [
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
        '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">',
        '<sheetData>',
    ]
    head = "".join(
        f'<c r="{_col_letter(c)}1" t="inlineStr" s="1"><is><t>{escape(str(h))}</t></is></c>'
        for c, h in enumerate(headers)
    )
    out.append(f'<row r="1">{head}</row>')
    for r_idx, row in enumerate(rows, start=2):
        cells = "".join(
            f'<c r="{_col_letter(c)}{r_idx}" t="inlineStr" s="0"><is><t>{escape(str(v))}</t></is></c>'
            for c, v in enumerate(row)
        )
        out.append(f'<row r="{r_idx}">{cells}</row>')
    out.append('</sheetData></worksheet>')
    return "".join(out)


def write_xlsx(path: Path, order, candidates, rejected) -> None:
    """Minimal .xlsx (stdlib). Sheet1 候选方案; Sheet2 订单信息."""
    s1_headers = ["名次", "车牌", "司机", "车型", "位置", "综合分", "新鲜度", "空驶km", "风险"]
    s1_rows: list[list[Any]] = []
    for i, c in enumerate(candidates, start=1):
        s1_rows.append([
            i, c["plate"], c["driverName"], c["vehicleType"], c["currentRegion"],
            f"{c['score']:.1f}", c["freshness"],
            c["emptyDistanceKm"] if c["emptyDistanceKm"] is not None else "",
            "；".join(c["risks"]) or "无",
        ])
    s2_headers = ["项", "值"]
    s2_rows = [
        ["订单号", text(order.get("orderId"))],
        ["起点", text(order.get("originRegion"))],
        ["终点", text(order.get("destinationRegion"))],
        ["装货时间", text(order.get("pickupAt"))],
        ["重量kg", text(order.get("weightKg"))],
        ["体积m³", text(order.get("volumeM3"))],
        ["车型要求", "、".join(string_list(order.get("allowedVehicleTypes")))],
        ["能力要求", "、".join(string_list(order.get("requiredCapabilities")))],
        ["未入选数", len(rejected)],
    ]
    s1 = _sheet_xml(s1_headers, s1_rows)
    s2 = _sheet_xml(s2_headers, s2_rows)
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
        '<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>'
        '<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>'
        '<fills count="2"><fill><patternFill patternType="none"/></fill>'
        '<fill><patternFill patternType="gray125"/></fill></fills>'
        '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'
        '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs></styleSheet>'
    )
    workbook = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
        'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
        '<sheets><sheet name="候选方案" sheetId="1" r:id="rId1"/>'
        '<sheet name="订单信息" sheetId="2" r:id="rId2"/></sheets></workbook>'
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


def _docx_para(content: str, bold: bool = False, size: int | None = None, heading: bool = False) -> str:
    rpr = ""
    if bold:
        rpr += "<w:b/>"
    if size:
        rpr += f'<w:sz w:val="{size * 2}"/><w:szCs w:val="{size * 2}"/>'
    ppr = '<w:pPr><w:pStyle w:val="Heading"/></w:pPr>' if heading else ""
    return f'<w:p>{ppr}<w:r><w:rPr>{rpr}</w:rPr><w:t xml:space="preserve">{escape(content)}</w:t></w:r></w:p>'


def _docx_table(headers: list[str], rows: list[list[Any]]) -> str:
    def cell(content: Any) -> str:
        return (
            '<w:tc><w:tcPr><w:tcW w:w="0" w:type="auto"/></w:tcPr>'
            f'<w:p><w:r><w:t xml:space="preserve">{escape(str(content))}</w:t></w:r></w:p></w:tc>'
        )
    head = "<w:tr>" + "".join(cell(h) for h in headers) + "</w:tr>"
    body = "".join("<w:tr>" + "".join(cell(c) for c in row) + "</w:tr>" for row in rows)
    borders = (
        '<w:tblBorders>'
        '<w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:left w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:right w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '</w:tblBorders>'
    )
    return (
        '<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/>'
        f'<w:tblW w:w="5000" w:type="pct"/>{borders}</w:tblPr>{head}{body}</w:tbl>'
    )


def scripts_text(order, candidates) -> list[str]:
    """司机确认话术（纯文本段落，供 docx）."""
    out: list[str] = []
    for item in candidates:
        out.append(
            f"{item['driverName']}师傅，请确认当前实时位置、剩余吨方，能否在 "
            f"{text(order.get('pickupAt')) or '待确认时间'} 前到达 "
            f"{text(order.get('originRegion')) or '装货点'}，并确认是否愿接往 "
            f"{text(order.get('destinationRegion')) or '目的地'} 的货。收到明确回复后再锁车。"
        )
    return out


def write_docx(path: Path, order, candidates, rejected, as_of, rec_idx, rec_reason) -> None:
    """Minimal .docx (stdlib): 配载方案文档."""
    qid = text(order.get("orderId")) or "未编号"
    asof_text = as_of.strftime("%Y-%m-%d %H:%M") if as_of else ""
    paras: list[str] = []
    paras.append(_docx_para(f"配载方案 · {qid}", heading=True))
    paras.append(_docx_para(f"线路：{text(order.get('originRegion')) or '待确认'} -> {text(order.get('destinationRegion')) or '待确认'}"))
    paras.append(_docx_para(
        f"货物：{text(order.get('weightKg')) or '?'}kg / {text(order.get('volumeM3')) or '?'}m³ · "
        f"装货 {text(order.get('pickupAt')) or '待确认'} · 车型 {('、'.join(string_list(order.get('allowedVehicleTypes'))) or '不限')}"
    ))
    paras.append(_docx_para(f"调度时点：{asof_text}"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("推荐结论", bold=True, size=13))
    if candidates and rec_idx >= 0:
        rec = candidates[rec_idx]
        paras.append(_docx_para(f"推荐方案：{rec['plate']} / {rec['driverName']}（综合分 {rec['score']:.1f}）"))
        paras.append(_docx_para(f"推荐理由：{rec_reason}"))
    else:
        paras.append(_docx_para("无通过硬性条件的候选，禁止勉强派车。"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("候选方案对比", bold=True, size=13))
    headers = ["名次", "车牌", "司机", "车型", "位置", "综合分", "空驶km", "新鲜度", "推荐"]
    rows: list[list[Any]] = []
    for i, c in enumerate(candidates, start=1):
        rows.append([
            i, c["plate"], c["driverName"], c["vehicleType"], c["currentRegion"],
            f"{c['score']:.1f}",
            c["emptyDistanceKm"] if c["emptyDistanceKm"] is not None else "未知",
            c["freshness"], "是" if i - 1 == rec_idx else "",
        ])
    if rows:
        paras.append(_docx_table(headers, rows))
    else:
        paras.append(_docx_para("无候选。"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("优劣势分析", bold=True, size=13))
    for i, c in enumerate(candidates, start=1):
        paras.append(_docx_para(f"方案 {i} · {c['plate']} / {c['driverName']}", bold=True))
        paras.append(_docx_para(f"  优势：{'；'.join(c['reasons'])}"))
        paras.append(_docx_para(f"  风险：{'；'.join(c['risks']) if c['risks'] else '无'}"))
    paras.append(_docx_para(""))
    paras.append(_docx_para("司机确认话术", bold=True, size=13))
    for line in scripts_text(order, candidates):
        paras.append(_docx_para(line))
    paras.append(_docx_para(""))
    if rejected:
        paras.append(_docx_para("未入选运力", bold=True, size=13))
        for r in rejected:
            paras.append(_docx_para(f"{r['plate']} / {r['driverName']}：{'、'.join(r['reasons'])}"))
        paras.append(_docx_para(""))
    paras.append(_docx_para("注：话术为草稿，不自动发送；调度建议，不自动锁车或改状态。"))
    body = "".join(paras)
    document = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        f'<w:body>{body}'
        '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
        '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="720" w:footer="720" w:gutter="0"/>'
        '</w:sectPr></w:body></w:document>'
    )
    styles = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
        '<w:docDefaults><w:rPrDefault><w:rPr>'
        '<w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="SimSun"/><w:sz w:val="22"/>'
        '</w:rPr></w:rPrDefault>'
        '<w:pPrDefault><w:pPr><w:spacing w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults>'
        '<w:style w:type="paragraph" w:styleId="Heading"><w:name w:val="heading 1"/>'
        '<w:pPr><w:spacing w:before="240" w:after="120"/><w:outlineLvl w:val="0"/></w:pPr>'
        '<w:rPr><w:b/><w:sz w:val="32"/></w:rPr></w:style>'
        '<w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/>'
        '<w:tblPr><w:tblBorders>'
        '<w:top w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:left w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:bottom w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:right w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideH w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '<w:insideV w:val="single" w:sz="4" w:color="CBD5E1"/>'
        '</w:tblBorders></w:tblPr></w:style></w:styles>'
    )
    content_types = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
        '<Default Extension="xml" ContentType="application/xml"/>'
        '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
        '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>'
        '</Types>'
    )
    root_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
        '</Relationships>'
    )
    doc_rels = (
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>'
        '</Relationships>'
    )
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", content_types)
        z.writestr("_rels/.rels", root_rels)
        z.writestr("word/document.xml", document)
        z.writestr("word/_rels/document.xml.rels", doc_rels)
        z.writestr("word/styles.xml", styles)


def capacity_board(data: dict[str, Any], as_of: datetime) -> str:
    settings = mapping(data, "freshness")
    fresh_minutes = number(settings.get("freshMinutes")) or 60
    aging_minutes = number(settings.get("agingMinutes")) or 180
    lines = [
        f"# 动态运力池 · {as_of.isoformat()}",
        "",
        "| 车牌 | 司机 | 位置 | 车型 | 状态 | 剩余吨/方 | 更新时间 | 新鲜度 |",
        "| --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    vehicles = data.get("vehicles") if isinstance(data.get("vehicles"), list) else []
    for raw in vehicles:
        if not isinstance(raw, dict):
            continue
        level, age = freshness(raw, as_of, fresh_minutes, aging_minutes)
        age_text = "未知" if age is None else f"{age:g}min"
        weight = number(raw.get("remainingWeightKg"))
        volume = number(raw.get("remainingVolumeM3"))
        load_text = f"{weight / 1000:g}t/{volume:g}m³" if weight is not None and volume is not None else "待确认"
        lines.append(
            f"| {text(raw.get('plate')) or '-'} | {text(raw.get('driverName')) or '-'} | "
            f"{text(raw.get('currentRegion')) or '-'} | {text(raw.get('vehicleType')) or '-'} | "
            f"{text(raw.get('status')) or '-'} | {load_text} | {text(raw.get('updatedAt')) or '-'} | {level} ({age_text}) |"
        )
    lines.append("")
    return "\n".join(lines)


def rejected_markdown(rejected: list[dict[str, Any]]) -> str:
    lines = ["# 未入选运力", ""]
    lines.extend(
        f"- {item['plate']} / {item['driverName']}：{'、'.join(item['reasons'])}"
        for item in rejected
    )
    if not rejected:
        lines.append("- 无")
    lines.append("")
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Build capacity dispatch preview/export artifacts")
    parser.add_argument("--input", required=True, type=Path)
    parser.add_argument("--output-dir", required=True, type=Path)
    parser.add_argument("--mode", choices=("preview", "export"), default="preview")
    args = parser.parse_args()

    data = load_data(args.input)
    candidates, rejected, order, as_of = build_results(data)
    rec_idx, rec_reason = resolve_recommendation(order, candidates)

    args.output_dir.mkdir(parents=True, exist_ok=True)
    process = args.output_dir / ".process"
    process.mkdir(parents=True, exist_ok=True)

    preview_html = dispatch_preview_html(data, candidates, rejected, order, as_of, rec_idx, rec_reason)
    preview_path = process / "dispatch-preview.html"
    preview_path.write_text(preview_html, encoding="utf-8")
    board_path = process / "capacity-board.md"
    board_path.write_text(capacity_board(data, as_of), encoding="utf-8")
    rejected_path = process / "rejected-capacity.md"
    rejected_path.write_text(rejected_markdown(rejected), encoding="utf-8")
    files = [str(preview_path), str(board_path), str(rejected_path)]

    payload: dict[str, Any] = {
        "ok": True,
        "mode": args.mode,
        "orderId": text(order.get("orderId")),
        "candidates": candidates,
        "rejected": rejected,
        "recommendation": {"index": rec_idx, "reason": rec_reason},
        "files": files,
        "inlineWidget": {
            "title": "配载方案预览",
            "widget_code": preview_html,
        },
    }

    if args.mode == "export":
        order_id = safe_name(text(order.get("orderId")))
        xlsx_path = args.output_dir / f"运力调配方案_{order_id}.xlsx"
        docx_path = args.output_dir / f"运力调配方案对比_{order_id}.docx"
        write_xlsx(xlsx_path, order, candidates, rejected)
        write_docx(docx_path, order, candidates, rejected, as_of, rec_idx, rec_reason)
        files.extend([str(xlsx_path), str(docx_path)])
        payload["files"] = files

    print(json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
