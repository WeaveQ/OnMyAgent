#!/usr/bin/env python3
import argparse
import html
import json
from pathlib import Path


def render_fragment(data: dict) -> str:
    lanes = []
    for index, capability in enumerate(data["capabilities"], start=1):
        steps = []
        for label, value in (
            ("业务场景", capability["scenario"]),
            ("所需资料", capability["input"]),
            ("交付产物", capability["output"]),
        ):
            steps.append(
                '<div class="cap-step">'
                f'<span class="cap-step-label">{html.escape(label)}</span>'
                f'<strong>{html.escape(value)}</strong>'
                "</div>"
            )
        lanes.append(
            '<article class="cap-lane" data-capability-lane>'
            f'<div class="cap-index" aria-hidden="true">{index:02d}</div>'
            '<div class="cap-lane-main">'
            '<header class="cap-lane-header">'
            f'<h3>{html.escape(capability["name"])}</h3>'
            f'<p>{html.escape(capability["summary"])}</p>'
            "</header>"
            f'<div class="cap-flow">{"".join(steps)}</div>'
            "</div></article>"
        )
    return f"""
<style>
  .cap-map{{box-sizing:border-box;display:block;width:100%;min-width:0;max-width:1040px;margin:0 auto;padding:clamp(16px,3vw,30px);overflow:hidden;color:#172033;background:#f6f8fb;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;writing-mode:horizontal-tb}}
  .cap-map *{{box-sizing:border-box;min-width:0;writing-mode:horizontal-tb}}
  .cap-map-header{{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:20px;align-items:end;padding:0 2px 22px;border-bottom:1px solid #d9e0ea}}
  .cap-eyebrow{{display:flex;align-items:center;gap:8px;margin-bottom:8px;color:#315f9d;font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}}
  .cap-eyebrow:before{{content:"";width:18px;height:2px;background:#315f9d}}
  .cap-map h2{{margin:0;color:#101828;font-size:clamp(24px,4vw,34px);font-weight:760;line-height:1.18;letter-spacing:-.03em}}
  .cap-subtitle{{margin:9px 0 0;color:#59677a;font-size:14px;line-height:1.55}}
  .cap-count{{display:flex;align-items:baseline;gap:6px;color:#66758a;white-space:nowrap}}
  .cap-count strong{{color:#315f9d;font-size:32px;font-weight:760;line-height:1}}
  .cap-count span{{font-size:12px}}
  .cap-lanes{{position:relative;display:grid;gap:12px;padding-top:18px}}
  .cap-lanes:before{{content:"";position:absolute;top:18px;bottom:0;left:25px;width:1px;background:#cbd6e4}}
  .cap-lane{{position:relative;display:grid;grid-template-columns:52px minmax(0,1fr);gap:14px;align-items:start}}
  .cap-index{{position:relative;z-index:1;display:grid;width:52px;height:52px;place-items:center;border:1px solid #b8c9df;border-radius:12px;color:#315f9d;background:#eef4fb;font-size:12px;font-weight:800;letter-spacing:.08em}}
  .cap-lane-main{{padding:18px 20px 20px;border:1px solid #d9e0ea;border-radius:14px;background:#fff;box-shadow:0 1px 2px rgba(16,24,40,.04)}}
  .cap-lane-header{{display:grid;grid-template-columns:minmax(120px,.42fr) minmax(0,1fr);gap:18px;align-items:baseline;padding-bottom:15px;border-bottom:1px solid #e7ebf1}}
  .cap-lane h3{{margin:0;color:#1f4f88;font-size:18px;font-weight:750;line-height:1.35;white-space:normal}}
  .cap-lane-header p{{margin:0;color:#536176;font-size:13px;line-height:1.55}}
  .cap-flow{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin-top:14px}}
  .cap-step{{position:relative;padding:0 22px}}
  .cap-step:first-child{{padding-left:0}}
  .cap-step:last-child{{padding-right:0}}
  .cap-step:not(:last-child):after{{content:"→";position:absolute;top:16px;right:-5px;color:#91a1b5;font-size:16px}}
  .cap-step-label{{display:block;margin-bottom:5px;color:#7a8799;font-size:11px;font-weight:650;letter-spacing:.04em}}
  .cap-step strong{{display:block;color:#26364a;font-size:12px;font-weight:650;line-height:1.55;overflow-wrap:anywhere}}
  @media(max-width:680px){{.cap-map-header{{grid-template-columns:1fr;gap:12px}}.cap-count{{justify-content:flex-start}}.cap-count strong{{font-size:24px}}.cap-lane-header{{grid-template-columns:1fr;gap:5px}}.cap-flow{{grid-template-columns:1fr;gap:9px}}.cap-step,.cap-step:first-child,.cap-step:last-child{{padding:10px 0 0;border-top:1px dashed #e0e6ee}}.cap-step:first-child{{border-top:0}}.cap-step:not(:last-child):after{{display:none}}}}
  @media(max-width:420px){{.cap-map{{padding:14px}}.cap-lanes:before{{left:20px}}.cap-lane{{grid-template-columns:42px minmax(0,1fr);gap:9px}}.cap-index{{width:42px;height:42px;border-radius:10px}}.cap-lane-main{{padding:15px}}}}
  @media(prefers-color-scheme:dark){{.cap-map{{color:#eef3fa;background:#10151d}}.cap-map-header{{border-color:#303b49}}.cap-eyebrow,.cap-count strong{{color:#8fb9ed}}.cap-eyebrow:before{{background:#8fb9ed}}.cap-map h2{{color:#f4f7fb}}.cap-subtitle,.cap-count{{color:#9aa8ba}}.cap-lanes:before{{background:#3b4b60}}.cap-index{{border-color:#405873;color:#9ac2f2;background:#182535}}.cap-lane-main{{border-color:#2d3948;background:#171e28;box-shadow:none}}.cap-lane-header{{border-color:#303b49}}.cap-lane h3{{color:#9ac2f2}}.cap-lane-header p{{color:#a8b4c4}}.cap-step-label{{color:#8796a9}}.cap-step strong{{color:#dce4ee}}.cap-step:not(:last-child):after{{color:#65758a}}}}
</style>
<section class="cap-map" data-capability-map aria-label="{html.escape(data["title"])}能力图谱">
  <header class="cap-map-header">
    <div>
      <div class="cap-eyebrow">Capability map</div>
      <h2>{html.escape(data["title"])}</h2>
      <p class="cap-subtitle">{html.escape(data["subtitle"])}</p>
    </div>
    <div class="cap-count"><strong>{len(data["capabilities"])}</strong><span>项核心能力</span></div>
  </header>
  <div class="cap-lanes">{"".join(lanes)}</div>
</section>
""".strip()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output")
    args = parser.parse_args()
    skill_root = Path(__file__).resolve().parent.parent
    data = json.loads((skill_root / "assets" / "capability-map.json").read_text(encoding="utf-8"))
    output = Path(args.output) if args.output else Path(".process") / f'{data["slug"]}-capability-map.html'
    output.parent.mkdir(parents=True, exist_ok=True)
    fragment = render_fragment(data)
    document = (
        '<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">'
        '<meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{html.escape(data['title'])}能力图谱</title>"
        "<style>html,body{width:100%;min-width:0;margin:0;background:#f6f8fb}"
        "@media(prefers-color-scheme:dark){html,body{background:#10151d}}</style>"
        f"</head><body>{fragment}</body></html>"
    )
    output.write_text(document, encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "state": "preview",
        "files": [str(output)],
        "processDir": str(output.parent),
        "inlineWidget": {
            "title": f'{data["title"]}能力图谱',
            "widget_code": fragment,
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
