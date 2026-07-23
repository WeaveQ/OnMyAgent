#!/usr/bin/env python3
"""Build AR collection board / follow-up list / CSV / automation proposals from ar-ledger.json."""

from __future__ import annotations

import argparse
import csv
import json
import re
from datetime import date, datetime, time, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo


def text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


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


def write_csv(path: Path, rows: list[dict[str, Any]], as_of: date) -> None:
    fields = [
        "customer", "invoiceNo", "amountInvoiced", "amountPaid", "amountOpen",
        "dueDate", "agingDays", "status", "nextNode", "owner", "riskFlags",
    ]
    with path.open("w", encoding="utf-8-sig", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            due = parse_date(text(row.get("dueDate")))
            risk = row.get("riskFlags")
            writer.writerow({
                "customer": text(row.get("customer")),
                "invoiceNo": text(row.get("invoiceNo")),
                "amountInvoiced": text(row.get("amountInvoiced")),
                "amountPaid": text(row.get("amountPaid")),
                "amountOpen": text(row.get("amountOpen")),
                "dueDate": due.isoformat() if due else text(row.get("dueDate")),
                "agingDays": aging_days(due, as_of) if due else "",
                "status": text(row.get("status")),
                "nextNode": text(row.get("nextNode")) or node_for_row(due, as_of),
                "owner": text(row.get("owner")),
                "riskFlags": ",".join(risk) if isinstance(risk, list) else text(risk),
            })


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
    board_path = proc / "ar-board.md"
    follow_path = proc / "follow-ups.md"
    board_path.write_text(build_board(rows, as_of), encoding="utf-8")
    follow_path.write_text(build_follow_ups(rows, as_of), encoding="utf-8")

    files = [str(board_path), str(follow_path)]
    if args.mode == "export":
        stamp = as_of.isoformat().replace("-", "")
        csv_path = args.output_dir / f"应收台账_{stamp}.csv"
        scripts_path = args.output_dir / f"催收话术_{stamp}.md"
        proposal_path = args.output_dir / "automations" / "proposals" / "ar-daily-board.json"
        write_csv(csv_path, rows, as_of)
        write_scripts_pack(scripts_path, rows, as_of)
        write_daily_automation_proposal(proposal_path)
        invoice_proposals = write_invoice_proposals(proposal_path.parent, rows, as_of)
        files.extend([
            str(csv_path),
            str(scripts_path),
            str(proposal_path),
            *[str(path) for path in invoice_proposals],
        ])

    print(json.dumps({
        "ok": True,
        "mode": args.mode,
        "asOfDate": as_of.isoformat(),
        "rowCount": len(rows),
        "files": files,
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
