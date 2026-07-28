#!/usr/bin/env python3
import argparse
import html
import json
from pathlib import Path


def render_fragment(data: dict) -> str:
    workflow = []
    for index, step in enumerate(data["workflow"], start=1):
        workflow.append(
            '<li class="guide-step">'
            f'<span>{index}</span><div><strong>{html.escape(step["label"])}</strong>'
            f'<p>{html.escape(step["detail"])}</p></div></li>'
        )
    cards = []
    for index, capability in enumerate(data["capabilities"], start=1):
        cards.append(
            '<article class="guide-card" data-guide-entry>'
            '<header>'
            f'<span class="guide-index">{index:02d}</span>'
            f'<div><h3>{html.escape(capability["name"])}</h3>'
            f'<p>{html.escape(capability["when"])}</p></div>'
            '</header>'
            f'<div class="guide-prompt" role="button" tabindex="0" data-template="{html.escape(capability["template"])}">'
            '<span>可以直接这样说</span>'
            f'<p>{html.escape(capability["example"])}</p>'
            '</div>'
            '<dl>'
            f'<div><dt>最少准备</dt><dd>{html.escape(capability["input"])}</dd></div>'
            f'<div><dt>你会得到</dt><dd>{html.escape(capability["output"])}</dd></div>'
            '</dl></article>'
        )
    fragment = f"""
<style>
  .expert-guide{{box-sizing:border-box;width:100%;max-width:1120px;margin:0 auto;padding:clamp(18px,3vw,34px);color:#172033;background:#f4f6f9;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif}}
  .expert-guide *{{box-sizing:border-box;min-width:0}}
  .guide-hero{{padding:clamp(22px,4vw,38px);border-radius:18px;color:#f8fbff;background:#13233b}}
  .guide-kicker{{margin:0 0 10px;color:#8fc0ff;font-size:11px;font-weight:750;letter-spacing:.14em;text-transform:uppercase}}
  .guide-hero h2{{margin:0;font-size:clamp(26px,4vw,38px);line-height:1.15;letter-spacing:-.03em}}
  .guide-hero>p:last-child{{max-width:760px;margin:12px 0 0;color:#c3d0e1;font-size:14px;line-height:1.65}}
  .guide-section-title{{display:flex;align-items:center;gap:10px;margin:26px 0 12px;color:#344054;font-size:12px;font-weight:750;letter-spacing:.08em}}
  .guide-section-title:after{{content:"";height:1px;flex:1;background:#d8dee8}}
  .guide-workflow{{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:0;padding:0;list-style:none;border:1px solid #d8dee8;border-radius:14px;background:#fff;overflow:hidden}}
  .guide-step{{position:relative;display:flex;gap:11px;padding:16px}}
  .guide-step:not(:last-child){{border-right:1px solid #e5e9ef}}
  .guide-step>span{{display:grid;width:28px;height:28px;flex:0 0 28px;place-items:center;border-radius:8px;color:#245b9b;background:#e8f1fc;font-size:12px;font-weight:800}}
  .guide-step strong{{display:block;color:#26364a;font-size:13px}}
  .guide-step p{{margin:5px 0 0;color:#718096;font-size:11px;line-height:1.45}}
  .guide-cards{{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}}
  .guide-card{{display:flex;min-height:310px;flex-direction:column;padding:19px;border:1px solid #d8dee8;border-radius:14px;background:#fff}}
  .guide-card header{{display:flex;gap:12px;align-items:flex-start;padding-bottom:15px;border-bottom:1px solid #e8ecf1}}
  .guide-index{{display:grid;width:34px;height:34px;flex:0 0 34px;place-items:center;border-radius:9px;color:#245b9b;background:#e8f1fc;font-size:11px;font-weight:800}}
  .guide-card h3{{margin:0;color:#174f8d;font-size:18px;line-height:1.3}}
  .guide-card header p{{margin:5px 0 0;color:#66758a;font-size:12px;line-height:1.5}}
  .guide-prompt{{flex:1;margin:15px 0;padding:14px;border-left:3px solid #4b83c3;border-radius:0 10px 10px 0;background:#f4f7fb;cursor:pointer;transition:border-color .15s,background .15s;position:relative}}
  .guide-prompt:hover{{border-left-color:#174f8d;background:#e8eff8}}
  .guide-prompt:focus-visible{{outline:2px solid #174f8d;outline-offset:2px}}
  .guide-prompt:after{{content:"点击开始";position:absolute;top:10px;right:12px;padding:2px 7px;border-radius:6px;background:#e8f1fc;color:#174f8d;font-size:10px;font-weight:700;opacity:1;transition:opacity .15s}}
  .guide-prompt:hover:after,.guide-prompt:focus-visible:after{{opacity:1}}
  .guide-prompt span{{color:#5f7085;font-size:10px;font-weight:750;letter-spacing:.08em}}
  .guide-prompt p{{margin:7px 0 0;color:#26364a;font-size:12px;line-height:1.65}}
  .guide-card dl{{display:grid;gap:8px;margin:0}}
  .guide-card dl div{{display:grid;grid-template-columns:64px 1fr;gap:8px}}
  .guide-card dt{{color:#78879a;font-size:11px}}
  .guide-card dd{{margin:0;color:#344054;font-size:11px;font-weight:650;line-height:1.5}}
  .guide-tip{{display:flex;gap:10px;margin-top:14px;padding:14px 16px;border:1px solid #c8d9ee;border-radius:12px;color:#315271;background:#eaf2fb;font-size:12px;line-height:1.6}}
  .guide-tip strong{{white-space:nowrap;color:#174f8d}}
  @media(max-width:820px){{.guide-workflow{{grid-template-columns:repeat(2,minmax(0,1fr))}}.guide-step:nth-child(2){{border-right:0}}.guide-step:nth-child(-n+2){{border-bottom:1px solid #e5e9ef}}.guide-cards{{grid-template-columns:1fr}}.guide-card{{min-height:0}}}}
  @media(max-width:480px){{.expert-guide{{padding:14px}}.guide-workflow{{grid-template-columns:1fr}}.guide-step,.guide-step:nth-child(2){{border-right:0;border-bottom:1px solid #e5e9ef}}.guide-step:last-child{{border-bottom:0}}.guide-tip{{display:block}}.guide-tip strong{{display:block;margin-bottom:4px}}}}
  @media(prefers-color-scheme:dark){{.expert-guide{{color:#edf2f8;background:#10151d}}.guide-hero{{background:#17263b}}.guide-kicker{{color:#91bff4}}.guide-hero>p:last-child{{color:#b3c1d2}}.guide-section-title{{color:#aebaca}}.guide-section-title:after{{background:#303b49}}.guide-workflow,.guide-card{{border-color:#303b49;background:#171e28}}.guide-step:not(:last-child),.guide-step:nth-child(-n+2),.guide-card header{{border-color:#303b49}}.guide-step>span,.guide-index{{color:#9ac2f2;background:#1d3047}}.guide-step strong,.guide-card dd{{color:#dbe4ef}}.guide-step p,.guide-card header p{{color:#929fb0}}.guide-card h3{{color:#9ac2f2}}.guide-prompt{{border-color:#5f94d0;background:#111923}}.guide-prompt:hover{{border-left-color:#9ac2f2;background:#17263b}}.guide-prompt:after{{background:#1d3047;color:#9ac2f2}}.guide-prompt span{{color:#91a0b2}}.guide-prompt p{{color:#d8e1ec}}.guide-card dt{{color:#8795a7}}.guide-tip{{border-color:#34516f;color:#b8cce1;background:#15263a}}.guide-tip strong{{color:#9ac2f2}}}}
</style>
<section class="expert-guide" data-expert-guide aria-label="{html.escape(data["title"])}上手指南">
  <header class="guide-hero">
    <p class="guide-kicker">HOW TO WORK WITH ME</p>
    <h2>{html.escape(data["title"])} · 上手指南</h2>
    <p>{html.escape(data["subtitle"])}</p>
  </header>
  <h3 class="guide-section-title">一次任务怎么完成</h3>
  <ol class="guide-workflow">{"".join(workflow)}</ol>
  <h3 class="guide-section-title">按你的事情选择入口</h3>
  <div class="guide-cards">{"".join(cards)}</div>
  <div class="guide-tip"><strong>使用原则</strong><span>{html.escape(data["tip"])}</span></div>
</section>
""".strip()
    return fragment + "\n<script>(function(){var s=document.querySelectorAll('.guide-prompt[data-template]');function f(e){parent.postMessage({type:'onmyagent:capability-template',template:e.dataset.template},'*')}s.forEach(function(e){e.addEventListener('click',function(){f(e)});e.addEventListener('keydown',function(ev){if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();f(e)}})})})()</script>"


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
        f"<title>{html.escape(data['title'])}上手指南</title>"
        "<style>html,body{width:100%;min-width:0;margin:0;background:#f4f6f9}"
        "@media(prefers-color-scheme:dark){html,body{background:#10151d}}</style>"
        f"</head><body>{fragment}</body></html>"
    )
    output.write_text(document, encoding="utf-8")
    print(json.dumps({
        "ok": True,
        "state": "preview",
        "inlineWidget": {
            "terminal": True,
            "title": f'{data["title"]}上手指南',
            "widget_code": fragment,
        },
    }, ensure_ascii=False))


if __name__ == "__main__":
    main()
