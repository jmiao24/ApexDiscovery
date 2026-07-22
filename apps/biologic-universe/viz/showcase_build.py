"""
Build the biologic-universe executive showcase — one self-contained, offline,
library-free tabbed dashboard (HTML/CSS/SVG only, all data embedded).

Tabs:  Universe · Repurposing Explorer · Combination Map · Target Deep-Dive · Methods

Reads results/<run>/viz/showcase_data.json (written by viz.showcase_prep) and emits
results/<run>/viz/showcase.html.

Usage:  python -m viz.showcase_build [run]   (run showcase_prep first)
"""
from __future__ import annotations
import sys, os, json

def _run_dir(run):
    here = os.path.dirname(os.path.abspath(__file__))
    return os.path.join(os.path.dirname(here), "results", run)


HTML = r"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>The Biologic Universe</title>
<style>
:root{
 --ink:#16232e; --body:#2c3e4c; --mut:#5f7180; --faint:#93a4b1;
 --line:#e4e9ed; --line2:#eef2f5; --bg:#f5f7f9; --card:#ffffff;
 --brand:#12566e; --brand2:#1c7a97; --accent:#e0662f; --accent-soft:#fbe9df;
 --undrugged:#e9edf1;
 --shadow:0 1px 2px rgba(16,35,46,.04),0 4px 18px rgba(16,35,46,.05);
 --radius:14px;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth}
body{margin:0;font-family:"Inter",-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;
 color:var(--body);background:var(--bg);-webkit-font-smoothing:antialiased;font-size:15px;line-height:1.5}
h1,h2,h3{color:var(--ink);margin:0;font-weight:650;letter-spacing:-.01em}
a{color:var(--brand2);text-decoration:none} a:hover{text-decoration:underline}
.num{font-variant-numeric:tabular-nums}

/* ---- top bar ---- */
header{position:sticky;top:0;z-index:50;background:rgba(255,255,255,.92);backdrop-filter:blur(8px);
 border-bottom:1px solid var(--line)}
.bar{max-width:1280px;margin:0 auto;padding:0 26px;display:flex;align-items:center;gap:26px;height:60px}
.brand{display:flex;align-items:center;gap:11px;font-weight:750;color:var(--ink);letter-spacing:-.02em;font-size:16px;white-space:nowrap}
.brand .dot{width:22px;height:22px;border-radius:50%;
 background:radial-gradient(circle at 32% 30%,#5fb6cf 0%,var(--brand) 55%,#0b3a4c 100%);
 box-shadow:0 0 0 4px rgba(18,86,110,.10)}
nav{display:flex;gap:2px;margin-left:auto;flex-wrap:wrap}
nav button{font:inherit;font-size:13.5px;font-weight:550;color:var(--mut);background:none;border:0;
 padding:9px 14px;border-radius:9px;cursor:pointer;transition:.15s}
nav button:hover{color:var(--ink);background:var(--line2)}
nav button.on{color:var(--brand);background:var(--accent-soft)}

/* ---- layout ---- */
.wrap{max-width:1280px;margin:0 auto;padding:30px 26px 80px}
.tab{display:none} .tab.on{display:block;animation:fade .3s ease}
@keyframes fade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}
.lead{font-size:15.5px;color:var(--mut);max-width:860px;margin:6px 0 0}
.eyebrow{font-size:12px;font-weight:700;letter-spacing:.09em;text-transform:uppercase;color:var(--brand2)}
h2.sec{font-size:21px;margin:34px 0 4px} .sechint{color:var(--mut);font-size:13.5px;margin:0 0 16px}
.card{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);box-shadow:var(--shadow)}
.pad{padding:20px 22px}
.grid{display:grid;gap:16px}
.hero-title{font-size:38px;line-height:1.05;letter-spacing:-.025em;margin-bottom:8px}
.hero-title .g{background:linear-gradient(92deg,var(--brand),var(--brand2) 60%,var(--accent));
 -webkit-background-clip:text;background-clip:text;color:transparent}

/* ---- stat tiles ---- */
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin:24px 0 6px}
.stat{background:var(--card);border:1px solid var(--line);border-radius:var(--radius);padding:16px 18px;box-shadow:var(--shadow)}
.stat .v{font-size:28px;font-weight:730;color:var(--ink);letter-spacing:-.02em;line-height:1}
.stat .l{font-size:12.5px;color:var(--mut);margin-top:6px}
.stat .s{font-size:11.5px;color:var(--faint);margin-top:2px}

/* ---- misc ---- */
.pill{display:inline-block;padding:1px 9px;border-radius:20px;color:#fff;font-size:11px;font-weight:600;white-space:nowrap;vertical-align:middle}
.chip{display:inline-block;padding:1px 8px;border-radius:6px;background:var(--line2);color:var(--body);
 font-size:11.5px;font-weight:500;margin:1px 3px 1px 0;border:1px solid var(--line)}
.chip.t{cursor:pointer} .chip.t:hover{background:var(--accent-soft);border-color:#f1c9b4}
.tag{font-size:10px;color:var(--accent);border:1px solid #f0c3ac;border-radius:6px;padding:0 5px;margin-left:5px;font-weight:600}
.legend{display:flex;flex-wrap:wrap;gap:12px;align-items:center;font-size:12px;color:var(--mut);margin:10px 0}
.legend i{display:inline-block;width:12px;height:12px;border-radius:3px;margin-right:5px;vertical-align:-1px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.three{display:grid;grid-template-columns:2fr 1fr 1fr;gap:16px}
@media(max-width:900px){.two,.three{grid-template-columns:1fr}}

/* ---- bars ---- */
.bars{display:flex;flex-direction:column;gap:8px}
.brow{display:grid;grid-template-columns:158px 1fr auto;align-items:center;gap:11px;font-size:12.5px}
.brow .lab{color:var(--body);text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.brow .track{display:block;background:var(--line2);border-radius:5px;height:18px;overflow:hidden}
.brow .fill{display:block;height:100%;min-width:3px;border-radius:5px;background:var(--brand2);transition:width .4s ease}
.brow .val{color:var(--ink);font-weight:600;font-variant-numeric:tabular-nums;min-width:40px;text-align:right}

/* ---- coverage wall ---- */
#wall{width:100%;height:auto;display:block;border-radius:10px;background:#fafcfd}
.wall-tip{position:fixed;pointer-events:none;z-index:99;background:#0e2531;color:#fff;font-size:12px;
 padding:7px 10px;border-radius:8px;opacity:0;transition:opacity .1s;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:230px}
.wall-tip b{color:#fff}

/* ---- controls ---- */
.controls{display:flex;flex-wrap:wrap;gap:9px;align-items:center;margin:4px 0 16px}
.controls input[type=text],.controls select{font:inherit;font-size:13px;padding:8px 11px;border:1px solid var(--line);
 border-radius:9px;background:#fff;color:var(--ink)}
.controls input[type=text]{min-width:230px;flex:0 1 300px}
.controls label{display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--mut);cursor:pointer}
.controls .count{margin-left:auto;color:var(--mut);font-size:12.5px}
/* multi-select dropdown */
.ms{position:relative;display:inline-block}
.ms>button{font:inherit;font-size:13px;padding:8px 11px;border:1px solid var(--line);border-radius:9px;background:#fff;color:var(--ink);cursor:pointer;display:flex;align-items:center;gap:7px}
.ms>button:hover{border-color:#cdd7de}
.ms>button .badge{background:var(--brand);color:#fff;border-radius:20px;font-size:11px;padding:0 6px;font-weight:600}
.ms>button .car{color:var(--faint);font-size:9px}
.ms .panel{position:absolute;top:calc(100% + 5px);left:0;z-index:30;background:#fff;border:1px solid var(--line);border-radius:10px;box-shadow:var(--shadow);padding:6px;max-height:300px;overflow:auto;min-width:200px;display:none}
.ms.open .panel{display:block}
.ms .panel label{display:flex;align-items:center;gap:8px;padding:6px 9px;border-radius:7px;font-size:12.5px;color:var(--body);cursor:pointer;white-space:nowrap;margin:0}
.ms .panel label:hover{background:var(--line2)}
.subtabs{display:inline-flex;background:var(--line2);border-radius:11px;padding:4px;gap:3px;margin:8px 0 4px}
.subtabs button{font:inherit;font-size:13px;font-weight:600;border:0;background:none;color:var(--mut);
 padding:8px 15px;border-radius:8px;cursor:pointer}
.subtabs button.on{background:#fff;color:var(--brand);box-shadow:var(--shadow)}

/* ---- asset cards ---- */
.cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px}
.acard{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:15px 16px;box-shadow:var(--shadow);
 display:flex;flex-direction:column}
.acard h3{font-size:15.5px;display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.acard .meta{font-size:12px;color:var(--mut);margin:7px 0 8px}
.acard .note{font-size:12.7px;color:var(--body);line-height:1.5;border-top:1px dashed var(--line);padding-top:9px;margin-top:auto}
.acard .tchips{margin:5px 0 2px}
.stopflag{font-size:10px;font-weight:700;color:#b23b12;background:var(--accent-soft);border-radius:6px;padding:1px 6px}

/* ---- matrix ---- */
.mwrap{overflow:auto;max-height:640px;border:1px solid var(--line);border-radius:12px;background:#fff}
table.mat{border-collapse:separate;border-spacing:0;font-size:12.5px;width:100%}
table.mat th{position:sticky;top:0;background:#fff;z-index:2;padding:10px 8px;text-align:center;color:var(--mut);
 font-weight:650;border-bottom:1px solid var(--line);white-space:nowrap}
table.mat th.tsym{text-align:left;left:0;z-index:3}
table.mat td{padding:0;text-align:center;border-bottom:1px solid var(--line2)}
table.mat td.tsym{position:sticky;left:0;background:#fff;text-align:left;padding:6px 12px;font-weight:600;color:var(--ink);z-index:1;white-space:nowrap;border-right:1px solid var(--line)}
table.mat td.tsym .nm{color:var(--faint);font-weight:400;font-size:11px;margin-left:6px}
.cell{display:block;margin:2px;height:26px;line-height:26px;border-radius:6px;font-variant-numeric:tabular-nums;font-weight:600}
.cell.gap{background:repeating-linear-gradient(45deg,#fdf2ec,#fdf2ec 5px,#fbe6db 5px,#fbe6db 10px);color:#c9541f;font-weight:400}

/* ---- network ---- */
.netwrap{position:relative;border:1px solid var(--line);border-radius:12px;overflow:hidden;background:
 radial-gradient(circle at 50% 40%,#fcfdfe,#f2f6f8)}
#net{width:100%;height:600px;display:block;cursor:grab}
#net.drag{cursor:grabbing}
#net line{stroke:#9fb4c0;stroke-opacity:.22}
#net line.inter{stroke-opacity:.09}
#net line.intra{stroke-opacity:.30}
#net line.dim{stroke-opacity:.03}
#net line.hl{stroke:var(--accent);stroke-opacity:.85}
#net circle{stroke:#fff;stroke-width:1.2;cursor:pointer}
#net circle.dim{opacity:.10}
#net text{font-size:9px;fill:var(--ink);pointer-events:none;font-weight:600;paint-order:stroke;stroke:#fff;stroke-width:2.4px}
#net text.dim{opacity:.06}
.nettip{position:fixed;pointer-events:none;z-index:99;background:#0e2531;color:#fff;font-size:12px;
 padding:8px 11px;border-radius:8px;opacity:0;transition:opacity .1s;box-shadow:0 6px 20px rgba(0,0,0,.25);max-width:260px;line-height:1.45}
.netbar{position:absolute;top:12px;left:12px;background:rgba(255,255,255,.94);border:1px solid var(--line);
 border-radius:10px;padding:11px 13px;box-shadow:var(--shadow);font-size:12.5px;max-width:230px}
.netbar label{display:block;color:var(--mut);margin:8px 0 3px}
.netbar input[type=range]{width:100%}
.pairbars{display:flex;flex-direction:column;gap:11px}
.pairrow{display:flex;flex-direction:column;gap:4px}
.pairrow .plabel{font-size:12px;color:var(--ink);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pairrow .ptgt{cursor:pointer;font-weight:600}
.pairrow .ptgt:hover{color:var(--accent);text-decoration:underline}
.pairrow .ptrack{display:block;background:var(--line2);border-radius:5px;height:9px;overflow:hidden}
.pairrow .pfill{display:block;height:100%;min-width:3px;border-radius:5px;transition:width .4s ease}

/* ---- deepdive ---- */
.dcards{display:grid;grid-template-columns:repeat(auto-fill,minmax(430px,1fr));gap:14px}
.dcard{background:#fff;border:1px solid var(--line);border-radius:12px;padding:14px 16px;box-shadow:var(--shadow)}
.dcard h3{font-size:16px;display:flex;align-items:baseline;gap:8px}
.dcard h3 .comp{font-size:11px;color:var(--mut);font-weight:400;border:1px solid var(--line);padding:1px 8px;border-radius:20px}
.dcard .meta{color:var(--mut);font-size:12px;margin:2px 0 9px}
.dtab{width:100%;border-collapse:collapse;font-size:12.3px}
.dtab th{text-align:left;color:var(--mut);font-weight:600;border-bottom:1px solid var(--line);padding:4px 6px}
.dtab td{padding:5px 6px;border-bottom:1px solid var(--line2);vertical-align:top}
.dtab tr.noterow td{color:var(--mut);font-size:11.6px;padding-top:0;border:0}
.empty{color:var(--faint);font-style:italic;font-size:12.5px}
.none{grid-column:1/-1;text-align:center;color:var(--mut);padding:44px}
.expand{cursor:pointer;color:var(--brand2);font-size:11px;font-weight:600}

/* ---- methods ---- */
.prose{max-width:820px}
.prose p{margin:12px 0;color:var(--body)}
.prose h3{font-size:16px;margin:26px 0 6px}
.callout{background:linear-gradient(180deg,#f1f7f9,#fff);border:1px solid var(--line);border-left:3px solid var(--brand2);
 border-radius:10px;padding:16px 18px;margin:18px 0}
.foot{color:var(--faint);font-size:12px;margin-top:40px;border-top:1px solid var(--line);padding-top:16px}
.dl{display:grid;grid-template-columns:170px 1fr;gap:6px 18px;font-size:13px;margin:10px 0}
.dl dt{color:var(--mut)} .dl dd{margin:0;color:var(--body)}
/* evidence portfolio popover (hover + bridge) */
.evpop{position:fixed;z-index:120;max-width:350px;background:#fff;border:1px solid var(--line);border-radius:12px;
 box-shadow:0 10px 34px rgba(16,35,46,.20);padding:13px 15px;font-size:12.5px;opacity:0;pointer-events:none;
 transition:opacity .12s;max-height:62vh;overflow:auto}
.evpop .evhead{font-weight:700;color:var(--ink);font-size:13.5px;margin-bottom:1px}
.evpop .evsub{font-weight:400;color:var(--mut);font-size:11.5px}
.evpop .evsum{color:var(--mut);font-size:11.5px;margin-bottom:8px}
.evpop .evgrp{font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;color:var(--brand2);margin:10px 0 3px}
.evpop .evrow{display:block;padding:5px 7px;border-radius:7px;margin:2px 0;text-decoration:none;color:var(--body)}
a.evrow:hover{background:var(--accent-soft)}
.evpop .evid{font-weight:600;color:var(--brand2)}
.evpop .evid.nolink{color:var(--mut);font-weight:500}
.evpop .evdet{display:block;color:var(--mut);font-size:11px;line-height:1.35;margin-top:1px}
.evpop .evmol{font-weight:600;color:var(--ink);margin:9px 0 1px;font-size:12px;border-top:1px solid var(--line2);padding-top:7px}
.evpop .evmol:first-of-type{border-top:0;padding-top:0}
.evpop .evempty{color:var(--mut);font-style:italic}
[data-ev],[data-evg]{cursor:help}
tr[data-ev]:hover>td{background:var(--line2)}
.acard[data-ev]:hover{border-color:#cdd7de}

/* ---- embedded analyst ---- */
.chat-launch{position:fixed;right:24px;bottom:24px;z-index:130;border:1px solid rgba(18,86,110,.25);
 background:var(--ink);color:#fff;border-radius:999px;padding:12px 17px;font:inherit;font-size:13.5px;font-weight:650;
 box-shadow:0 12px 35px rgba(16,35,46,.24);cursor:pointer;display:flex;align-items:center;gap:9px;transition:.18s}
.chat-launch:hover{transform:translateY(-2px);background:#0e3e51}.chat-launch svg{width:17px;height:17px}
.chat-scrim{position:fixed;inset:0;z-index:139;background:rgba(16,35,46,.18);backdrop-filter:blur(1px);
 opacity:0;pointer-events:none;transition:opacity .2s}
.chat-scrim.on{opacity:1;pointer-events:auto}
.chat-drawer{position:fixed;z-index:140;top:74px;right:18px;bottom:18px;width:min(var(--chat-width,430px),calc(100vw - 36px));
 display:flex;flex-direction:column;background:rgba(255,255,255,.98);border:1px solid var(--line);border-radius:18px;
 box-shadow:0 22px 70px rgba(16,35,46,.24);transform:translateX(calc(100% + 42px));transition:transform .24s ease;overflow:hidden}
.chat-drawer.on{transform:translateX(0)}
.chat-drawer.wide{--chat-width:960px}.chat-drawer.resizing{transition:none;user-select:none}
.chat-resizer{position:absolute;z-index:4;left:0;top:66px;bottom:66px;width:11px;cursor:ew-resize;touch-action:none;outline:none}
.chat-resizer::after{content:"";position:absolute;left:3px;top:50%;width:3px;height:58px;transform:translateY(-50%);
 border-radius:4px;background:#b9c7cf;opacity:.25;transition:opacity .15s,background .15s}
.chat-resizer:hover::after,.chat-resizer:focus-visible::after,.chat-drawer.resizing .chat-resizer::after{opacity:.9;background:var(--brand2)}
.chat-head{padding:17px 18px 13px;border-bottom:1px solid var(--line);display:flex;gap:12px;align-items:flex-start}
.chat-head .mark{display:grid;place-items:center;flex:0 0 34px;height:34px;border-radius:11px;background:#eaf3f6;color:var(--brand)}
.chat-head h3{font-size:15px}.chat-head p{font-size:11.5px;color:var(--mut);margin:2px 0 0}
.chat-actions{margin-left:auto;display:flex;align-items:center;gap:3px}
.chat-head-action{display:grid;place-items:center;width:30px;height:30px;border:0;border-radius:8px;background:none;color:var(--mut);cursor:pointer;padding:0}
.chat-head-action:hover{background:var(--line2);color:var(--ink)}.chat-head-action svg{width:16px;height:16px}
.chat-head-action.has-count{position:relative;color:var(--brand)}.chat-expert-count{display:none;position:absolute;right:-2px;top:-3px;min-width:16px;height:16px;padding:0 4px;border:2px solid #fff;border-radius:999px;background:var(--accent);color:#fff;font-size:8.5px;font-weight:800;line-height:12px;text-align:center}.chat-expert-count.on{display:block}
.chat-close{font-size:22px;line-height:1}
.chat-history{display:none;position:absolute;z-index:8;top:64px;right:12px;width:min(360px,calc(100% - 24px));max-height:min(520px,calc(100% - 86px));
 overflow:hidden;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 46px rgba(16,35,46,.2)}
.chat-history.on{display:flex;flex-direction:column}.chat-history-head{display:flex;align-items:center;padding:12px 12px 9px;border-bottom:1px solid var(--line2)}
.chat-history-head strong{font-size:13px}.chat-history-new{margin-left:auto;border:0;border-radius:8px;background:var(--ink);color:#fff;padding:6px 9px;font:inherit;font-size:11.5px;cursor:pointer}
.chat-history-list{overflow:auto;padding:6px}.chat-history-empty{padding:20px 12px;text-align:center;color:var(--mut);font-size:12px}
.chat-history-row{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:5px;border-radius:10px;padding:3px}
.chat-history-row:hover,.chat-history-row.current{background:var(--line2)}.chat-history-open{min-width:0;border:0;background:none;text-align:left;padding:7px;cursor:pointer;color:var(--body)}
.chat-history-title{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:12.5px;font-weight:650;color:var(--ink)}
.chat-history-meta{display:block;margin-top:2px;font-size:10.5px;color:var(--faint)}.chat-history-tools{display:flex;gap:1px}
.chat-history-tool{display:grid;place-items:center;width:27px;height:27px;border:0;border-radius:7px;background:none;color:var(--faint);cursor:pointer;padding:0}
.chat-history-tool:hover{background:#fff;color:var(--ink)}.chat-history-tool.delete:hover{color:#a53b32}.chat-history-tool svg{width:13px;height:13px}
.chat-expert-panel{display:none;position:absolute;z-index:9;top:64px;right:12px;width:min(390px,calc(100% - 24px));max-height:min(570px,calc(100% - 86px));overflow:hidden;background:#fff;border:1px solid var(--line);border-radius:14px;box-shadow:0 16px 46px rgba(16,35,46,.2)}
.chat-expert-panel.on{display:flex;flex-direction:column}.chat-expert-panel-head{padding:12px;border-bottom:1px solid var(--line2)}.chat-expert-panel-head strong{display:block;font-size:13px}.chat-expert-panel-head small{display:block;margin-top:2px;color:var(--mut);font-size:10.5px}.chat-expert-list{overflow:auto;padding:8px}.chat-expert-empty{padding:22px 12px;text-align:center;color:var(--mut);font-size:12px;line-height:1.45}
.chat-expert-item{padding:11px;border:1px solid var(--line);border-left:3px solid var(--brand2);border-radius:11px;background:#f8fbfc}.chat-expert-item+.chat-expert-item{margin-top:7px}.chat-expert-item-topic{color:var(--faint);font-size:8.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}.chat-expert-item p{margin:5px 0 9px;color:var(--body);font-size:11.5px;line-height:1.45}.chat-expert-item-actions{display:flex;gap:6px}.chat-expert-answer,.chat-expert-dismiss{border:1px solid #cbdce1;border-radius:7px;background:#fff;color:var(--brand);padding:5px 8px;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.chat-expert-answer:hover{border-color:var(--brand2);background:#eaf5f7}.chat-expert-dismiss{color:var(--mut);font-weight:650}.chat-expert-dismiss:hover{background:#f1f4f5;color:var(--ink)}
.selection-ask{display:none;position:fixed;z-index:138;align-items:center;gap:7px;border:1px solid rgba(18,86,110,.2);border-radius:9px;
 padding:8px 11px;background:var(--ink);color:#fff;box-shadow:0 10px 30px rgba(16,35,46,.24);font:inherit;font-size:12px;font-weight:700;cursor:pointer}
.selection-ask.on{display:flex}.selection-ask:hover{background:#0e3e51;transform:translateY(-1px)}
.selection-ask .spark{color:#8fd0e0;font-size:15px}.selection-ask kbd{color:#aab7bf;font:inherit;font-size:11px}
.chat-feedback-draft{display:none;margin:0 0 10px;padding:12px;border:1px solid #91c2d1;border-radius:14px;background:linear-gradient(135deg,#eef8fa,#f8fbfc);box-shadow:0 4px 14px rgba(16,70,88,.08)}
.chat-feedback-draft.on{display:block}.chat-feedback-head{display:flex;align-items:flex-start;gap:9px}.chat-feedback-icon{display:grid;place-items:center;flex:0 0 28px;height:28px;border-radius:9px;background:var(--brand);color:#fff;font-size:14px}.chat-feedback-heading{min-width:0}.chat-feedback-head strong{display:block;font-size:12px;color:var(--ink)}.chat-feedback-head small{display:block;margin-top:1px;color:var(--mut);font-size:10px;line-height:1.3}
.chat-feedback-clear{margin-left:auto;display:grid;place-items:center;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--faint);font:inherit;font-size:17px;cursor:pointer}.chat-feedback-clear:hover{background:#e2edf1;color:var(--ink)}
.chat-feedback-anchor{margin:9px 0;padding:8px 10px;border:1px solid #d8e6ea;border-left:3px solid #86b9c7;border-radius:9px;background:#fff;color:var(--mut);font-size:10.5px;line-height:1.4}.chat-feedback-anchor b{display:block;margin-bottom:2px;color:var(--faint);font-size:8.5px;letter-spacing:.07em;text-transform:uppercase}.chat-feedback-quote{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.chat-feedback-intents{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px}.chat-feedback-intent{position:relative;min-height:48px;border:1px solid #cfdde2;border-radius:10px;background:#fff;color:var(--body);padding:7px 8px;text-align:left;font:inherit;cursor:pointer}.chat-feedback-intent strong{display:block;font-size:10.5px}.chat-feedback-intent small{display:block;margin-top:2px;color:var(--faint);font-size:8.8px;line-height:1.2}.chat-feedback-intent.on{border-color:var(--brand2);background:#dff0f4;color:var(--brand);box-shadow:inset 0 0 0 1px var(--brand2)}.chat-feedback-intent.on:after{content:'✓';position:absolute;right:7px;top:6px;font-size:10px;font-weight:900}
.chat-feedback-next{margin:8px 1px 0;color:var(--brand);font-size:10.5px;font-weight:700}.chat-form.feedback-mode .chat-box{border-color:var(--brand2);box-shadow:0 0 0 3px rgba(28,122,151,.11),0 2px 10px rgba(16,35,46,.05)}
.chat-interview-draft{display:none;margin:0 0 10px;padding:11px 12px;border:1px solid #9fcbd5;border-left:4px solid var(--brand2);border-radius:12px;background:#eef7f9}.chat-interview-draft.on{display:block}.chat-interview-top{display:flex;align-items:flex-start;gap:8px}.chat-interview-top strong{display:block;color:var(--brand);font-size:11px}.chat-interview-top small{display:block;margin-top:2px;color:var(--mut);font-size:9.5px}.chat-interview-question{margin:8px 0 0;color:var(--body);font-size:11px;line-height:1.4}.chat-interview-clear{margin-left:auto;border:0;background:transparent;color:var(--faint);font:inherit;font-size:17px;cursor:pointer}.chat-form.interview-mode .chat-box{border-color:var(--brand2);box-shadow:0 0 0 3px rgba(28,122,151,.11),0 2px 10px rgba(16,35,46,.05)}
.chat-context{display:none;margin:0 0 9px;padding:9px;border:1px solid #d8e1e6;border-radius:12px;background:#f7f9fa;color:var(--body);box-shadow:0 1px 5px rgba(16,35,46,.04)}
.chat-context.on{display:block}.chat-context-head{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:0 2px 7px}
.chat-context-count{font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase;color:var(--faint)}
.chat-context-clear-all{border:0;background:transparent;color:var(--mut);font:inherit;font-size:10.5px;font-weight:700;cursor:pointer;padding:2px 4px;border-radius:5px}
.chat-context-clear-all:hover{background:#e7edf0;color:var(--ink)}.chat-context-list{display:flex;flex-direction:column;gap:6px;max-height:172px;overflow:auto}
.chat-context-item{display:grid;grid-template-columns:minmax(0,1fr) 24px;align-items:center;gap:6px;padding:7px 6px 7px 9px;border:1px solid #dce4e8;border-left:3px solid var(--brand2);border-radius:9px;background:#fff}
.chat-context-copy{min-width:0}.chat-context-label{display:block;font-size:8.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase;color:var(--faint)}
.chat-context-title{display:block;margin-top:1px;color:var(--ink);font-size:11.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-context-preview{display:block;margin-top:1px;color:var(--mut);font-size:10.5px;line-height:1.3;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-context-remove{display:grid;place-items:center;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--faint);cursor:pointer;font:inherit;font-size:17px;line-height:1;padding:0}
.chat-context-remove:hover{background:#e7edf0;color:var(--ink)}
.acard.chat-selected{border-color:var(--brand2);box-shadow:0 0 0 2px rgba(28,122,151,.12),var(--shadow)}
tr.chat-selected>td{background:#eaf3f6!important}.chip.t.chat-selected{background:#dceef3;border-color:#9fc6d3;color:var(--brand)}
.ptgt.chat-selected{color:var(--accent);text-decoration:underline}.cell.chat-selected{outline:2px solid var(--accent);outline-offset:2px}
[data-i].chat-selected,[data-n].chat-selected{stroke:var(--accent);stroke-width:2.5px}
.chat-messages{flex:1;overflow:auto;padding:18px;display:flex;flex-direction:column;gap:14px}
.chat-empty{margin:auto 0 8px;align-self:flex-start;max-width:92%;padding:4px}.chat-empty-label{display:block;margin-bottom:7px;color:var(--faint);font-size:9.5px;font-weight:800;letter-spacing:.08em;text-transform:uppercase}
.chat-empty-prompts{display:flex;flex-wrap:wrap;gap:7px}.chat-empty-prompts button{border:1px solid var(--line);background:#fff;color:var(--body);border-radius:999px;padding:7px 10px;font:inherit;font-size:11.5px;cursor:pointer}.chat-empty-prompts button:hover{border-color:#9cc4cf;background:#f2f8fa;color:var(--brand)}
.chat-msg{max-width:92%;font-size:13.5px;line-height:1.55;overflow-wrap:anywhere}
.chat-msg.user{align-self:flex-end;background:var(--ink);color:#fff;padding:10px 13px;border-radius:14px 14px 4px 14px}
.chat-msg.user.expert{max-width:94%;border:1px solid #a7cbd6;border-left:3px solid #67aabc;background:#103b4b}.chat-expert-badge{display:block;margin-bottom:5px;color:#a9d8e3;font-size:9.5px;font-weight:800;letter-spacing:.07em;text-transform:uppercase}
.chat-expert-anchor{display:block;margin-bottom:7px;padding:6px 8px;border-radius:7px;background:rgba(255,255,255,.08);color:#c6dce3;font-size:10px;line-height:1.35}
.chat-msg-context{display:block;margin-bottom:5px;color:#a9c6d1;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase}
.chat-msg.assistant{align-self:flex-start;color:var(--body)}
.chat-msg.assistant .bubble{background:var(--bg);border:1px solid var(--line);padding:11px 13px;border-radius:4px 14px 14px 14px}
.chat-msg.assistant a{word-break:break-word}.chat-msg.assistant table{border-collapse:collapse;width:100%;font-size:12px;margin:8px 0}
.chat-msg.assistant th,.chat-msg.assistant td{border-bottom:1px solid var(--line);text-align:left;padding:5px}
.chat-guidance-applied{margin:0 0 8px;padding:9px 11px;border:1px solid #9bc9d5;border-left:4px solid var(--brand2);border-radius:10px;background:#eaf6f8;color:var(--body);font-size:10.5px;line-height:1.4}.chat-guidance-applied strong{display:block;margin-bottom:3px;color:var(--brand);font-size:10px;letter-spacing:.04em}.chat-guidance-applied strong:before{content:'✓';display:inline-grid;place-items:center;width:16px;height:16px;margin-right:6px;border-radius:50%;background:var(--brand);color:#fff;font-size:9px}
.chat-expert-request{margin-top:8px;padding:10px 11px;border:1px solid #c9dee4;border-left:3px solid var(--brand2);border-radius:10px;background:#f7fbfc}.chat-expert-request b{display:block;color:var(--brand);font-size:9px;letter-spacing:.07em;text-transform:uppercase}.chat-expert-request p{margin:4px 0 8px;color:var(--body);font-size:11px;line-height:1.4}.chat-expert-request button{border:1px solid #bcd3da;border-radius:7px;background:#fff;color:var(--brand);padding:5px 8px;font:inherit;font-size:10px;font-weight:750;cursor:pointer}.chat-expert-request.resolved{opacity:.62}.chat-expert-request.resolved button{display:none}
.chat-response-actions{display:flex;justify-content:flex-start;margin-top:7px}.chat-feedback-start,.chat-trace-feedback{display:inline-flex;align-items:center;gap:5px;border:1px solid #c7dbe2;border-radius:8px;background:#fff;color:var(--brand);font:inherit;font-size:10.5px;font-weight:750;cursor:pointer;padding:6px 9px}.chat-feedback-start:before,.chat-trace-feedback:before{content:'✦';color:var(--brand2)}.chat-feedback-start:hover,.chat-trace-feedback:hover{border-color:#89bdcb;background:#eaf5f7}.chat-trace-feedback{align-self:start;padding:4px 7px;font-size:9.5px}
.chat-trace{margin-top:7px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden}
.chat-trace summary{display:flex;align-items:center;gap:7px;list-style:none;padding:8px 10px;color:var(--body);font-size:11.5px;font-weight:750;cursor:pointer;user-select:none}
.chat-trace summary::-webkit-details-marker{display:none}.chat-trace summary:before{content:'›';color:var(--faint);font-size:17px;line-height:1;transition:transform .16s ease}
.chat-trace[open] summary:before{transform:rotate(90deg)}.chat-trace summary:hover{background:#f5f8f9}.chat-trace-meta{margin-left:auto;color:var(--faint);font-size:10px;font-weight:600}
.chat-trace-body{border-top:1px solid var(--line2);padding:10px;display:flex;flex-direction:column;gap:10px}.chat-trace-section h5{margin:0 0 5px;color:var(--faint);font-size:9px;letter-spacing:.08em;text-transform:uppercase}
.chat-trace-context{display:flex;flex-wrap:wrap;gap:5px}.chat-trace-chip{display:inline-block;max-width:100%;padding:4px 7px;border-radius:999px;background:#edf3f5;color:var(--body);font-size:10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.chat-trace-step{display:grid;grid-template-columns:8px minmax(0,1fr) auto;gap:7px;padding:5px 0;border-bottom:1px solid var(--line2)}.chat-trace-step:last-child{border-bottom:0}
.chat-trace-dot{width:7px;height:7px;margin-top:5px;border-radius:50%;background:#69a779}.chat-trace-dot.failed{background:#b95a50}.chat-trace-step strong{display:block;font-size:10.8px;color:var(--body)}
.chat-trace-detail{display:block;margin-top:2px;color:var(--faint);font-size:9.8px;line-height:1.35}.chat-trace-rationale{margin:0;color:var(--mut);font-size:10.5px;line-height:1.45;white-space:pre-wrap}
.chat-trace-sources{display:flex;flex-wrap:wrap;gap:5px}.chat-trace-source{display:inline-block;padding:4px 7px;border:1px solid #d7e2e7;border-radius:7px;background:#f8fafb;color:var(--brand)!important;font-size:10px;text-decoration:none}
.chat-trace-caveats{margin:0;padding-left:16px;color:var(--mut);font-size:10px;line-height:1.45}
.chat-label{font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--faint);margin-bottom:5px}
.chat-thinking{display:inline-flex;align-items:center;gap:9px;padding:10px 12px;background:var(--bg);border:1px solid var(--line);border-radius:4px 14px 14px 14px}
.chat-thinking-dots{display:inline-flex;gap:4px}.chat-thinking-copy{color:var(--mut);font-size:11.5px;white-space:nowrap}
.chat-thinking i{width:5px;height:5px;border-radius:50%;background:var(--faint);animation:chatdot 1.1s infinite alternate}
.chat-thinking i:nth-child(2){animation-delay:.2s}.chat-thinking i:nth-child(3){animation-delay:.4s}
.chat-live-trace{margin-top:7px;border:1px solid var(--line);border-radius:10px;background:#fff;overflow:hidden;min-width:min(340px,80vw)}
.chat-live-head{display:flex;align-items:center;gap:7px;padding:8px 10px;border-bottom:1px solid var(--line2);font-size:11.5px;font-weight:750;color:var(--body)}
.chat-live-status{margin-left:auto;color:var(--faint);font-size:10px;font-weight:600}.chat-live-steps{padding:4px 10px}.chat-live-step{display:grid;grid-template-columns:9px minmax(0,1fr);gap:7px;padding:6px 0;border-bottom:1px solid var(--line2)}
.chat-live-step:last-child{border-bottom:0}.chat-live-step i{width:7px;height:7px;margin-top:4px;border-radius:50%;background:#7d9aa7}.chat-live-step i.in_progress{animation:chatpulse 1s infinite alternate}.chat-live-step i.completed{background:#69a779}.chat-live-step i.failed{background:#b95a50}
.chat-live-step strong{display:block;color:var(--body);font-size:10.8px}.chat-live-step small{display:block;margin-top:2px;color:var(--faint);font-size:9.8px;line-height:1.3}.chat-live-rationale{display:none;margin:0;padding:8px 10px;border-top:1px solid var(--line2);color:var(--mut);font-size:10.5px;line-height:1.4;white-space:pre-wrap}
.chat-live-rationale.on{display:block}@keyframes chatpulse{to{opacity:.3;transform:scale(.75)}}
@keyframes chatdot{to{opacity:.25;transform:translateY(-2px)}}
.chat-form{padding:12px;border-top:1px solid var(--line);background:#fff}
.chat-box{display:flex;align-items:flex-end;gap:8px;border:1px solid #cfd9df;border-radius:14px;padding:9px 9px 9px 12px;box-shadow:0 2px 10px rgba(16,35,46,.05)}
.chat-box textarea{flex:1;resize:none;max-height:120px;min-height:25px;border:0;outline:0;font:inherit;font-size:13px;color:var(--ink);background:transparent}
.chat-send{display:grid;place-items:center;flex:0 0 31px;height:31px;border:0;border-radius:9px;background:var(--brand);color:#fff;cursor:pointer}
.chat-send:disabled{opacity:.4;cursor:default}
@media(min-width:901px){
 body{transition:padding-right .24s ease}
 body.chat-open{padding-right:calc(min(var(--chat-width,430px),calc(100vw - 520px)) + 36px)}
 body.chat-resizing{transition:none}
 body.chat-open .chat-launch{opacity:0;pointer-events:none;transform:translateY(8px)}
 .chat-drawer{top:18px;width:min(var(--chat-width,430px),calc(100vw - 520px))}
 .chat-scrim,.chat-scrim.on{display:none;opacity:0;pointer-events:none}
}
@media(max-width:900px){
 .chat-resizer{display:none}
 .chat-scrim.on{opacity:1;pointer-events:auto}
}
@media(max-width:620px){.chat-drawer{inset:10px;width:auto;border-radius:16px}.chat-launch{right:14px;bottom:14px}.chat-scrim{backdrop-filter:none}.chat-feedback-intents{grid-template-columns:1fr}.chat-feedback-intent{min-height:42px}}
</style></head>
<body>
<header><div class="bar">
 <div class="brand"><span class="dot"></span>The&nbsp;Biologic&nbsp;Universe</div>
 <nav id="nav">
  <button data-t="universe" class="on">Universe</button>
  <button data-t="repurposing">Repurposing&nbsp;Explorer</button>
  <button data-t="combination">Combination&nbsp;Map</button>
  <button data-t="explore">Target&nbsp;Deep-Dive</button>
  <button data-t="methods">Methods</button>
 </nav>
</div></header>

<div class="wrap">

<!-- ============ UNIVERSE ============ -->
<section class="tab on" id="t-universe">
 <div class="eyebrow">Every biologic against every targetable protein</div>
 <h1 class="hero-title">The complete map of <span class="g">biologic-targetable</span> human biology.</h1>
 <p class="lead" id="uni-lead"></p>
 <div class="stats" id="uni-stats"></div>

 <h2 class="sec">Coverage of the targetable universe</h2>
 <p class="sechint" id="wall-hint"></p>
 <div class="card pad">
   <div class="legend" id="wall-legend"></div>
   <svg id="wall"></svg>
 </div>

 <div class="two" style="margin-top:16px">
   <div class="card pad"><h3>Modality mix <span style="color:var(--faint);font-weight:400;font-size:13px">· distinct molecules</span></h3>
     <div class="bars" id="modmix" style="margin-top:12px"></div>
     <div class="legend" id="modmix-legend" style="margin-top:14px"></div></div>
   <div class="grid" style="grid-template-rows:auto auto;gap:16px">
     <div class="card pad"><h3>Distinct biologics by furthest stage</h3><div class="bars" id="stagemol" style="margin-top:12px"></div></div>
     <div class="card pad"><h3>Where they are developed / approved</h3><div class="bars" id="geo" style="margin-top:12px"></div></div>
   </div>
 </div>

 <div class="two" style="margin-top:16px">
   <div class="card pad"><h3>Most-crowded targets <span style="color:var(--faint);font-weight:400;font-size:13px">· top 16 by № biologics</span></h3>
     <div class="bars" id="crowded" style="margin-top:12px"></div></div>
   <div class="card pad"><h3>Concentration <span style="color:var(--faint);font-weight:400;font-size:13px">· biologics per drugged target</span></h3>
     <div class="bars" id="conc" style="margin-top:12px"></div>
     <p class="sechint" id="conc-hint" style="margin-top:12px"></p></div>
 </div>
</section>

<!-- ============ REPURPOSING ============ -->
<section class="tab" id="t-repurposing">
 <div class="eyebrow">The supply-side repurposing map</div>
 <h2 class="sec" style="font-size:26px;margin-top:8px">What already exists that you could redeploy.</h2>
 <p class="lead">A biologic engages one target with high specificity, so some good options for extending a
  molecule's use are: initiate a development program for a <b>new disease indication</b> for a known molecule,
  apply a <b>different modality</b> against the target (e.g. antibody → ADC, bispecific, or cell therapy),
  seek approval in a <b>new region</b>, or restart a <b>clinically-tested program that was discontinued</b>.</p>

 <div class="subtabs" id="rep-tabs" style="margin-top:18px">
  <button data-r="shelf" class="on">De-risked asset shelf</button>
  <button data-r="modgap">Same target, new modality</button>
  <button data-r="geo">Ex-US assets</button>
 </div>

 <div id="r-shelf">
  <p class="sechint" id="shelf-hint"></p>
  <div class="controls">
   <input type="text" id="shelf-q" placeholder="Search molecule, target, developer…">
   <select id="shelf-mod"><option value="">all modalities</option></select>
   <select id="shelf-ph"><option value="">Ph2 &amp; Ph3</option><option value="phase_3">Phase 3 only</option><option value="phase_2">Phase 2 only</option></select>
   <label><input type="checkbox" id="shelf-stop" checked> explicit stop-signal only</label>
   <span class="count" id="shelf-count"></span>
  </div>
  <div class="cards" id="shelf-cards"></div>
 </div>

 <div id="r-modgap" style="display:none">
  <p class="sechint" id="modgap-hint"></p>
  <div class="stats" id="modgap-stats" style="margin:8px 0 14px"></div>
  <div class="controls">
   <select id="modgap-stage">
    <option value="0">any stage (incl. preclinical)</option>
    <option value="1" selected>in the clinic (Phase 1+)</option>
    <option value="2">Phase 2+</option>
    <option value="3">Phase 3+</option>
    <option value="5">approved</option>
   </select>
   <input type="text" id="modgap-q" placeholder="Filter validated targets…">
   <span class="count" id="modgap-count"></span></div>
  <div class="mwrap"><table class="mat" id="modgap-table"></table></div>
  <div class="legend" style="margin-top:10px"><span><i style="background:repeating-linear-gradient(45deg,#fdf2ec,#fdf2ec 4px,#fbe6db 4px,#fbe6db 8px)"></i>modality gap (validated target, 0 biologics)</span>
   <span><i style="background:var(--brand2)"></i>≥1 biologic (darker = more)</span></div>
 </div>

 <div id="r-geo" style="display:none">
  <p class="sechint" id="geo2-hint"></p>
  <div class="bars" id="geo2-regmix" style="max-width:560px;margin:8px 0 18px"></div>
  <div class="controls"><input type="text" id="geo-q" placeholder="Search molecule, target, region…">
   <span class="count" id="geo-count"></span></div>
  <div class="cards" id="geo-cards"></div>
 </div>
</section>

<!-- ============ COMBINATION ============ -->
<section class="tab" id="t-combination">
 <div class="eyebrow">Which targets the field co-engages</div>
 <h2 class="sec" style="font-size:26px;margin-top:8px">The combination map.</h2>
 <p class="lead" id="net-lead"></p>
 <div class="two" style="grid-template-columns:2.2fr 1fr;margin-top:18px">
  <div class="netwrap">
   <svg id="net"></svg>
   <div class="netbar">
    <b style="color:var(--ink)">Multispecific pairings</b>
    <label>development stage</label>
    <select id="net-stage" style="width:100%;font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);border-radius:7px">
     <option value="0">preclinical &amp; up</option>
     <option value="1" selected>in the clinic (Phase 1+)</option>
     <option value="2">Phase 2+</option>
     <option value="3">Phase 3+</option>
     <option value="5">approved</option>
    </select>
    <label>min. shared molecules: <span id="net-mw">2</span></label>
    <input type="range" id="net-slider" min="1" max="6" value="2">
    <label>highlight target</label>
    <input type="text" id="net-q" placeholder="e.g. CD3D" style="width:100%;font:inherit;font-size:12px;padding:6px 8px;border:1px solid var(--line);border-radius:7px">
   </div>
  </div>
  <div class="card pad"><h3>Strongest pairings</h3>
   <p class="sechint" style="margin:4px 0 12px">ranked by relative co-occurrence strength</p>
   <div class="pairbars" id="pairs"></div></div>
 </div>
 <div class="legend" id="net-legend" style="margin-top:12px"></div>
</section>

<!-- ============ DEEP-DIVE ============ -->
<section class="tab" id="t-explore">
 <div class="eyebrow">Search anything · every claim cited</div>
 <h2 class="sec" style="font-size:26px;margin-top:8px">Target deep-dive.</h2>
 <p class="lead">Type a gene, alias, molecule, or brand to see its full biologic catalog — modality, phase,
  developer, geography, and the in-corpus note (which carries the free-text indication &amp; failure story).</p>
 <div class="controls" style="margin-top:16px">
  <input type="text" id="dq" placeholder="Search a gene, alias, molecule, or brand…" autocomplete="off">
  <div class="ms" id="ms-mod"></div>
  <div class="ms" id="ms-ph"></div>
  <div class="ms" id="ms-reg"></div>
  <select id="dcomp"><option value="">any compartment</option><option>surface</option><option>secreted</option><option>surface_and_secreted</option></select>
  <label><input type="checkbox" id="ddrug"> drugged only</label>
  <span class="count" id="dcount"></span>
 </div>
 <div class="dcards" id="dmain"></div>
</section>

<!-- ============ METHODS ============ -->
<section class="tab" id="t-methods">
 <div class="eyebrow">How it was built · why you can trust it</div>
 <h2 class="sec" style="font-size:26px;margin-top:8px">Methods &amp; provenance.</h2>
 <div class="stats" id="meth-stats"></div>
 <div class="two" style="margin-top:18px">
  <div class="prose">
   <h3>The target universe</h3>
   <p>Biologics act from the extracellular space, so the targetable universe is the
    <b>surfaceome ∪ secretome</b>. We merged SURFY (in-silico human surfaceome), the Human Protein Atlas
    secretome, and HGNC for symbol/alias normalization into <b>4,518 targets</b> — each normalized to its
    current HGNC-approved symbol with aliases preserved to drive search-term expansion.</p>
   <h3>The mining</h3>
   <p>One Opus agent per target mined <b>paperclip</b> (clinical trials · FDA/EMA/PMDA regulatory · literature)
    using the target + its synonyms, returning every biologic — approved, investigational, and discontinued —
    then deduplicating across code-name / INN / brand and separating true biosimilars.</p>
   <div class="callout">
    <b>Every molecule is citation-grounded.</b> <span id="meth-cite"></span> Nothing is asserted without a
    real paperclip document behind it; <b>0 ungrounded</b> records.
   </div>
   <h3>What this dataset is — and isn't</h3>
   <p>This is the <b>asset &amp; modality supply map</b>: the complete per-target inventory of molecules and
    modalities. Disease-level <i>“same molecule, new indication”</i> repurposing is owned by the sibling
    <b>integrated_v1</b> dataset (regulatory-grounded <code>(target,disease)</code> labels for approved biologics,
    in Open Targets genetic ID space). Per-molecule <code>notes</code> here carry the indication &amp; failure story
    as free text; the de-risked shelf reflects what is <i>documented in-corpus</i>, not an exhaustive registry.</p>
  </div>
  <div>
   <div class="card pad"><h3>Evidence by source</h3><div class="bars" id="meth-src" style="margin-top:12px"></div></div>
   <div class="card pad" style="margin-top:16px"><h3>At a glance</h3>
    <dl class="dl" id="meth-dl"></dl></div>
  </div>
 </div>
 <div class="foot" id="foot"></div>
</section>

</div>

<div class="wall-tip" id="walltip"></div>
<div class="nettip" id="nettip"></div>

<button class="chat-launch" id="chat-launch" type="button" aria-controls="chat-drawer" aria-expanded="false">
 <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-5 4v-4.7A2.5 2.5 0 0 1 4 13.5z"/><path d="M8 8h8M8 11.5h5"/></svg>
 Collaborate with AI
</button>
<button class="selection-ask" id="selection-ask" type="button" aria-hidden="true"><span class="spark">✦</span> <span id="selection-ask-label">Collaborate</span> <kbd>↵</kbd></button>
<div class="chat-scrim" id="chat-scrim"></div>
<aside class="chat-drawer" id="chat-drawer" aria-hidden="true">
 <div class="chat-resizer" id="chat-resizer" role="separator" aria-orientation="vertical" aria-label="Resize agent panel" aria-valuemin="360" aria-valuemax="1100" aria-valuenow="430" tabindex="0"></div>
 <div class="chat-head">
  <div class="mark">✦</div><div><h3>Biologic Universe Agent</h3><p>Collaborate across targets, assets, modalities, stages, and evidence.</p></div>
  <div class="chat-actions">
   <button class="chat-head-action" id="chat-new" type="button" aria-label="New conversation" title="New conversation">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 5v14M5 12h14"/></svg>
   </button>
   <button class="chat-head-action" id="chat-history-toggle" type="button" aria-label="Conversation history" aria-expanded="false" title="Conversation history">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M3.5 12a8.5 8.5 0 1 0 2.2-5.7L3.5 8.5"/><path d="M3.5 4.5v4h4M12 7.5V12l3 2"/></svg>
   </button>
   <button class="chat-head-action" id="chat-expert-toggle" type="button" aria-label="Expert input" aria-expanded="false" title="Expert input">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M5 18.5h9.5l4.5 2v-4.2A7.5 7.5 0 1 0 5 18.5Z"/><path d="M9.5 9a2.6 2.6 0 1 1 3.6 2.4c-.9.4-1.1.9-1.1 1.6M12 16h.01"/></svg>
    <span class="chat-expert-count" id="chat-expert-count">0</span>
   </button>
   <button class="chat-head-action" id="chat-expand" type="button" aria-label="Expand agent" aria-pressed="false" title="Expand agent">
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M8.5 3.5h-5v5M15.5 3.5h5v5M20.5 15.5v5h-5M3.5 15.5v5h5"/><path d="m3.8 8.2 5-5M20.2 8.2l-5-5M20.2 15.8l-5 5M3.8 15.8l5 5"/></svg>
   </button>
   <button class="chat-head-action chat-close" id="chat-close" type="button" aria-label="Close agent">×</button>
  </div>
 </div>
 <div class="chat-history" id="chat-history" aria-hidden="true">
  <div class="chat-history-head"><strong>Conversation history</strong><button class="chat-history-new" id="chat-history-new" type="button">New chat</button></div>
  <div class="chat-history-list" id="chat-history-list"><div class="chat-history-empty">Loading conversations…</div></div>
 </div>
 <div class="chat-expert-panel" id="chat-expert-panel" aria-hidden="true">
  <div class="chat-expert-panel-head"><strong id="chat-expert-title">Expert input</strong><small>Questions wait here while the analysis continues.</small></div>
  <div class="chat-expert-list" id="chat-expert-list"><div class="chat-expert-empty">No expert input is pending.</div></div>
 </div>
 <div class="chat-messages" id="chat-messages"></div>
 <form class="chat-form" id="chat-form">
  <div class="chat-interview-draft" id="chat-interview-draft"></div>
  <div class="chat-feedback-draft" id="chat-feedback-draft"></div>
  <div class="chat-context" id="chat-context"></div>
  <div class="chat-box"><textarea id="chat-input" rows="1" maxlength="4000" placeholder="What should we explore together?"></textarea>
   <button class="chat-send" id="chat-send" type="submit" aria-label="Send">↑</button></div>
 </form>
</aside>

<script>
const D = __DATA__;
const PC = D.phase_color, PL = D.phase_lbl;
const UNDRUG = getComputedStyle(document.documentElement).getPropertyValue('--undrugged').trim() || '#e9edf1';
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];
const esc = s => (s==null?'':(''+s)).replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const nf = n => (n==null?'':n.toLocaleString('en-US'));
const phasePill = p => `<span class="pill" style="background:${PBG(p)}">${esc((p||'unknown').replace(/_/g,' '))}</span>`;
const PBADGE={approved:'5',phase_4:'5',filed:'4',phase_3:'3',phase_2_3:'3',phase_2:'2',phase_1_2:'1',phase_1:'1',preclinical:'0',unknown:'-1'};
function PBG(p){return PC[PBADGE[p]!=null?PBADGE[p]:'-1'];}
function MODCAT(m){
 if(m==='monoclonal antibody') return '#12566e';
 if(/bispecific|trispecific|multispecific|T-cell engager|trifunctional/i.test(m)) return '#1c7a97';
 if(/conjugate|radioimmuno|immunocytokine/i.test(m)) return '#e0662f';
 if(/CAR-T|CAR-NK|TCR-engineered/i.test(m)) return '#8250c4';
 if(m==='fusion protein') return '#2f9e6f';
 if(/peptide|recombinant|cytokine|nanobody|antibody fragment/i.test(m)) return '#b8902a';
 return '#93a4b1';
}

/* ---------- tab router ---------- */
const inited={};
$$('#nav button').forEach(b=>b.onclick=()=>{
 $$('#nav button').forEach(x=>x.classList.toggle('on',x===b));
 const t=b.dataset.t;
 $$('.tab').forEach(s=>s.classList.toggle('on',s.id==='t-'+t));
 window.scrollTo({top:0,behavior:'instant'});
 if(!inited[t]){inited[t]=1;(INIT[t]||(()=>{}))();}
});

/* ---------- bar helper ---------- */
function bars(el,rows,opt={}){
 const max=Math.max(1,...rows.map(r=>r.v));
 el.innerHTML=rows.map(r=>`<div class="brow"><span class="lab" title="${esc(r.k)}">${esc(r.k)}</span>
  <span class="track"><span class="fill" style="width:${(100*r.v/max).toFixed(1)}%;background:${r.c||'var(--brand2)'}"></span></span>
  <span class="val">${r.d!=null?r.d:nf(r.v)}</span></div>`).join('');
}

/* ---------- evidence portfolio popover (hover + bridge, clickable links) ---------- */
let MG_BY_SYM={};
const EV={el:null,timer:null,key:null};
function evEl(){
 if(!EV.el){const d=document.createElement('div');d.className='evpop';document.body.appendChild(d);
  d.addEventListener('mouseenter',()=>clearTimeout(EV.timer));
  d.addEventListener('mouseleave',evHide); EV.el=d;}
 return EV.el;
}
function evHide(){clearTimeout(EV.timer);EV.timer=setTimeout(()=>{if(EV.el){EV.el.style.opacity=0;EV.el.style.pointerEvents='none';}EV.key=null;},250);}
function evShow(html,x,y){const el=evEl();clearTimeout(EV.timer);el.innerHTML=html;el.style.opacity=1;el.style.pointerEvents='auto';
 const w=el.offsetWidth,h=el.offsetHeight;let px=x+16,py=y+16;
 if(px+w>innerWidth-8)px=Math.max(8,x-w-16); if(py+h>innerHeight-8)py=Math.max(8,innerHeight-h-8);
 el.style.left=px+'px';el.style.top=py+'px';}
const SRCLBL={fda:'FDA / EMA / PMDA',trial:'Clinical trials',paper:'Literature & preprints'};
function evLinks(evs){
 const g={};evs.forEach(e=>{(g[e.s]||(g[e.s]=[])).push(e);});
 let h='';
 for(const s of ['fda','trial','paper']){const arr=g[s];if(!arr||!arr.length)continue;
  h+=`<div class="evgrp">${SRCLBL[s]||s} · ${arr.length}</div>`;
  h+=arr.map(e=>{const inner=`<span class="evid ${e.url?'':'nolink'}">${esc(e.label)}${e.url?' ↗':''}</span>${e.detail?`<span class="evdet">${esc(e.detail)}</span>`:''}`;
   return e.url?`<a class="evrow" href="${esc(e.url)}" target="_blank" rel="noopener">${inner}</a>`:`<div class="evrow">${inner}</div>`;}).join('');
 }
 return h;
}
function evSummary(evs){const c={};evs.forEach(e=>c[e.s]=(c[e.s]||0)+1);
 const p=[];if(c.fda)p.push(c.fda+' FDA');if(c.trial)p.push(c.trial+' trial'+(c.trial>1?'s':''));if(c.paper)p.push(c.paper+' paper'+(c.paper>1?'s':''));
 return p.join(' · ');}
function evForKey(k,title,sub){
 const evs=(D.ev&&D.ev[k])||[];
 const head=`<div class="evhead">${esc(title||'')}${sub?` <span class="evsub">· ${esc((''+sub).replace(/_/g,' '))}</span>`:''}</div>`;
 if(!evs.length)return head+`<div class="evempty">no citations recorded</div>`;
 return head+`<div class="evsum">${evSummary(evs)} · click a source to open ↗</div>`+evLinks(evs);
}
function evForGroup(sym,modLabel,refs,ms){
 const inClin=(refs||[]).filter(r=>r.r>=ms);
 const head=`<div class="evhead">${esc(sym)} × ${esc(modLabel)} <span class="evsub">· ${inClin.length} program${inClin.length==1?'':'s'}</span></div>`;
 if(!inClin.length) return head+`<div class="evempty">No ${esc(modLabel)} program at this stage — modality white space.</div>`;
 let h=head; const cap=6;
 inClin.slice(0,cap).forEach(r=>{const evs=(D.ev&&D.ev[r.k])||[];
  h+=`<div class="evmol">${esc(r.n)} <span class="evsub">· ${esc((r.p||'').replace(/_/g,' '))}</span></div>`;
  h+=evs.length?evLinks(evs):'<div class="evempty">no citations</div>';});
 if(inClin.length>cap)h+=`<div class="evsub" style="margin-top:8px">+${inClin.length-cap} more program${inClin.length-cap==1?'':'s'}</div>`;
 return h;
}
document.addEventListener('mouseover',e=>{
 const t=e.target.closest&&e.target.closest('[data-ev],[data-evg]'); if(!t)return;
 if(t.hasAttribute('data-ev')){const k=t.getAttribute('data-ev'),key='m:'+k;
  if(EV.key!==key){EV.key=key;evShow(evForKey(k,t.getAttribute('data-evt'),t.getAttribute('data-evs')),e.clientX,e.clientY);}}
 else{const gid=t.getAttribute('data-evg');if(EV.key!=='g:'+gid){EV.key='g:'+gid;
  const p=gid.split('|'),sym=p[1],ci=+p[2],row=MG_BY_SYM[sym],refs=row?row.cells[ci]:[];
  const ms=+(($('#modgap-stage')||{}).value||1);
  evShow(evForGroup(sym,(D.modgap.cols_full[ci]||D.modgap.cols[ci]),refs,ms),e.clientX,e.clientY);}}
});
document.addEventListener('mouseout',e=>{const t=e.target.closest&&e.target.closest('[data-ev],[data-evg]');if(t)evHide();});

/* ================= UNIVERSE ================= */
function initUniverse(){
 const u=D.universe, mth=D.methods;
 const pct=Math.round(100*u.n_drugged/u.n_targets);
 $('#uni-lead').textContent=`We mined every biologic — approved, investigational, and discontinued — against `
  +`${nf(u.n_targets)} targetable human proteins. ${nf(u.n_drugged)} carry at least one; the rest is white space.`;
 $('#uni-stats').innerHTML=[
  [nf(u.n_targets),'targetable proteins','surfaceome ∪ secretome'],
  [nf(u.n_drugged),'with ≥1 biologic',pct+'% of the universe'],
  [nf(u.n_distinct),'distinct biologics',nf(u.n_mol_rows)+' target×molecule records'],
  [u.modmix.length,'modalities','mAb → ADC → bispecific → cell'],
  [nf(mth.n_citations),'citations','0 ungrounded records'],
 ].map(s=>`<div class="stat"><div class="v num">${s[0]}</div><div class="l">${s[1]}</div><div class="s">${s[2]}</div></div>`).join('');

 // legend
 const legItems=[[UNDRUG,'undrugged (white space)'],[PC['0'],'preclinical'],[PC['1'],'phase 1'],[PC['2'],'phase 2'],
  [PC['3'],'phase 3'],[PC['4'],'filed'],[PC['5'],'approved']];
 $('#wall-legend').innerHTML=legItems.map(x=>`<span><i style="background:${x[0]}"></i>${x[1]}</span>`).join('');
 $('#wall-hint').textContent=`Each tile is one targetable protein (${nf(u.n_targets)} total), arranged by furthest `
  +`clinical stage reached. The grey mass is untapped biology — ${100-pct}% of the universe.`;
 drawWall(u);

 bars($('#modmix'),u.modmix.slice(0,13).map(m=>({k:m[0],v:m[1],c:MODCAT(m[0])})));
 $('#modmix-legend').innerHTML=[['#12566e','mAb'],['#1c7a97','bispecific / TCE'],['#e0662f','conjugate (ADC/RIC)'],
   ['#8250c4','cell therapy'],['#2f9e6f','fusion'],['#b8902a','protein / peptide']]
   .map(x=>`<span><i style="background:${x[0]}"></i>${x[1]}</span>`).join('');
 // stage (distinct molecules) — order preclinical..approved
 const sm=u.stage_mol; const order=[0,1,2,3,4,5,-1];
 bars($('#stagemol'),order.filter(r=>sm[r]).map(r=>({k:PL[r],v:sm[r],c:PC[r]})));
 bars($('#geo'),u.geography.map(g=>({k:g[0],v:g[1],c:'#3a6ea5'})));

 // crowded targets — top from tiles
 const top=[...u.tiles].filter(t=>t.n>0).sort((a,b)=>b.n-a.n).slice(0,16);
 bars($('#crowded'),top.map(t=>({k:t.sym,v:t.n,c:PC[t.ph]})));
 // concentration — blue gradient by bin
 const cN=u.concentration.length;
 bars($('#conc'),u.concentration.map((v,i)=>({k:u.concentration_labels[i],v:v,
   c:`rgba(28,122,151,${(0.35+0.6*i/(cN-1)).toFixed(2)})`})));
 $('#conc-hint').innerHTML=`median <b>${u.concentration_median}</b> biologics per drugged target · max `
  +`<b>${u.concentration_max}</b> (${esc(u.concentration_max_sym)}) · most targets carry 1–2.`;
}

function drawWall(u){
 const svg=$('#wall'), tiles=[...u.tiles];
 // sort: drugged first by furthest phase desc then size; undrugged last
 tiles.sort((a,b)=>{
  const da=a.n>0?1:0, db=b.n>0?1:0;
  if(da!==db) return db-da;
  if(b.ph!==a.ph) return b.ph-a.ph;
  return b.n-a.n;
 });
 const N=tiles.length, cols=84, cell=12, gap=1.4;
 const rows=Math.ceil(N/cols);
 const W=cols*(cell+gap), H=rows*(cell+gap);
 svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
 svg.style.height=(H* (svg.clientWidth||W)/W)+'px';
 let s='';
 for(let i=0;i<N;i++){
  const t=tiles[i], x=(i%cols)*(cell+gap), y=((i/cols)|0)*(cell+gap);
  const col=t.n>0?PC[t.ph]:UNDRUG;
  s+=`<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${cell}" height="${cell}" rx="2" fill="${col}" data-i="${i}"/>`;
 }
 svg.innerHTML=s;
 const tip=$('#walltip');
 svg.onmousemove=e=>{
  const el=e.target; if(el.tagName!=='rect'){tip.style.opacity=0;return;}
  const t=tiles[+el.dataset.i];
  tip.innerHTML=`<b>${esc(t.sym)}</b> · ${t.comp||'—'}<br>${t.n} biologic${t.n==1?'':'s'}`
   +(t.n>0?` · furthest: ${PL[t.ph]}`:` · white space`);
  tip.style.opacity=1; tip.style.left=(e.clientX+14)+'px'; tip.style.top=(e.clientY+14)+'px';
 };
 svg.onmouseleave=()=>tip.style.opacity=0;
 window.addEventListener('resize',()=>{svg.style.height=(H*(svg.clientWidth||W)/W)+'px';});
}

/* ================= REPURPOSING ================= */
function initRepurposing(){
 // subtabs
 $$('#rep-tabs button').forEach(b=>b.onclick=()=>{
  $$('#rep-tabs button').forEach(x=>x.classList.toggle('on',x===b));
  ['shelf','modgap','geo'].forEach(r=>$('#r-'+r).style.display=(r===b.dataset.r?'':'none'));
 });
 initShelf(); initModgap(); initGeo();
}

function initShelf(){
 const sh=D.shelf;
 $('#shelf-hint').innerHTML=`<b>${nf(sh.n_total)}</b> distinct biologics reached Phase 2–3 but are not approved — `
  +`clinically-tested assets with existing human data. <b>${nf(sh.n_stopped)}</b> carry an explicit stop-signal `
  +`in-corpus (discontinued / halted / failed endpoint / superseded).`;
 const mods=[...new Set(sh.rows.map(r=>r.modality))].sort();
 $('#shelf-mod').innerHTML+=mods.map(m=>`<option>${esc(m)}</option>`).join('');
 const q=$('#shelf-q'),fm=$('#shelf-mod'),fp=$('#shelf-ph'),fs=$('#shelf-stop');
 function render(){
  const term=q.value.trim().toLowerCase(),md=fm.value,ph=fp.value,so=fs.checked;
  let out=[],shown=0;
  for(const r of sh.rows){
   if(so&&!r.stopped) continue;
   if(md&&r.modality!==md) continue;
   if(ph==='phase_3'&&r.phase!=='phase_3') continue;
   if(ph==='phase_2'&&!(r.phase==='phase_2'||r.phase==='phase_2_3')) continue;
   if(term){
    const blob=((r.name||'')+' '+(r.inn||'')+' '+r.targets.join(' ')+' '+r.developers.join(' ')+' '+r.modality).toLowerCase();
    if(!blob.includes(term)) continue;
   }
   shown++; if(shown>300) continue;
   out.push(shelfCard(r));
  }
  $('#shelf-count').textContent=nf(shown)+' assets'+(shown>300?' (showing 300)':'');
  $('#shelf-cards').innerHTML=out.join('')||'<div class="none">No matching assets.</div>';
 }
 [q,fm,fp,fs].forEach(e=>e.addEventListener('input',render));
 render();
}
function shelfCard(r){
 const tch=r.targets.slice(0,5).map(t=>`<span class="chip t" onclick="gotoTarget('${esc(t)}')">${esc(t)}</span>`).join('');
 const dev=r.developers.length?r.developers.join(', '):'—';
 const reg=r.regions.filter(x=>x!=='global').join(', ');
 return `<div class="acard" data-ev="${esc(r.k)}" data-evt="${esc(r.name||'')}" data-evs="${esc(r.phase||'')}" data-targets="${esc(r.targets.join('|'))}" data-modality="${esc(r.modality||'')}" data-developers="${esc(r.developers.join('|'))}"><h3>${esc(r.name||'—')} ${phasePill(r.phase)} ${r.stopped?'<span class="stopflag">stopped</span>':''}</h3>
  <div class="tchips">${tch}</div>
  <div class="meta">${esc(r.modality||'—')} · ${esc(dev)}${reg?' · '+esc(reg):''}${r.n_evidence?` · ${r.n_evidence} cite${r.n_evidence==1?'':'s'}`:''}</div>
  <div class="note">${esc(r.note||'')}</div></div>`;
}

function initModgap(){
 const mg=D.modgap;
 MG_BY_SYM={}; mg.grid.forEach(r=>MG_BY_SYM[r.sym]=r);   // for the cell group-portfolio lookup
 const STLBL={'0':'at any stage','1':'in the clinic (Phase 1+)','2':'at Phase 2+','3':'at Phase 3+','5':'approved'};
 const q=$('#modgap-q'), fs=$('#modgap-stage');
 const cv=(refs,ms)=>refs.reduce((s,x)=>s+(x.r>=ms?1:0),0);   // # molecules at >= stage
 function render(){
  const ms=+fs.value, term=q.value.trim().toLowerCase(), sl=STLBL[fs.value];
  let maxc=1; const gaps=mg.cols.map(()=>0);
  const disp=mg.grid.map(r=>{
   const vals=r.cells.map((refs,i)=>{const v=cv(refs,ms); if(v===0)gaps[i]++; if(v>maxc)maxc=v; return v;});
   return {sym:r.sym,n_mol:r.n_mol,vals};
  });
  $('#modgap-hint').innerHTML=`Of <b>${mg.n_validated}</b> clinically-validated targets (≥1 approved biologic), how many `
   +`have a program <b>${sl}</b> in each modality. Hatched cells are <b>modality gaps</b> — a proven target with no such program in that format. `
   +`Hover any cell for its programs + citations.`;
  $('#modgap-stats').innerHTML=mg.cols.map((c,i)=>
   `<div class="stat"><div class="v num" style="color:var(--accent)">${gaps[i]}</div><div class="l">no ${esc(c)} ${esc(sl)}</div></div>`).join('');
  const rows=disp.filter(r=>!term||r.sym.toLowerCase().includes(term));
  let h=`<thead><tr><th class="tsym">target</th>`+mg.cols.map(c=>`<th>${esc(c)}</th>`).join('')+`</tr></thead><tbody>`;
  for(const r of rows.slice(0,400)){
   h+=`<tr><td class="tsym">${esc(r.sym)}<span class="nm">${r.n_mol}</span></td>`;
   h+=r.vals.map((v,ci)=>{
    const dg=`data-evg="mg|${esc(r.sym)}|${ci}"`;
    if(v===0) return `<td><span class="cell gap" ${dg}>·</span></td>`;
    const t=0.18+0.72*Math.min(1,Math.log(1+v)/Math.log(1+maxc));
    return `<td><span class="cell" ${dg} style="background:rgba(28,122,151,${t.toFixed(2)});color:${t>0.5?'#fff':'#12566e'}">${v}</span></td>`;
   }).join('');
   h+=`</tr>`;
  }
  h+='</tbody>';
  $('#modgap-table').innerHTML=h;
  $('#modgap-count').textContent=nf(rows.length)+' validated targets'+(rows.length>400?' (showing 400)':'');
 }
 [q,fs].forEach(e=>e.addEventListener('input',render)); render();
}

function initGeo(){
 const g=D.geo;
 $('#geo2-hint').innerHTML=`<b>${g.n_total}</b> biologics are approved somewhere but <b>not in the US</b> — `
  +`assets available for in-licensing or US development.`;
 bars($('#geo2-regmix'),g.regmix.map(r=>({k:r[0],v:r[1],c:'#6a7b9c'})));
 const q=$('#geo-q');
 function render(){
  const term=q.value.trim().toLowerCase();
  let out=[],shown=0;
  for(const r of g.rows){
   if(term){const blob=((r.name||'')+' '+(r.inn||'')+' '+r.targets.join(' ')+' '+r.regions.join(' ')+' '+r.developers.join(' ')).toLowerCase();
    if(!blob.includes(term)) continue;}
   shown++; out.push(geoCard(r));
  }
  $('#geo-count').textContent=nf(shown)+' ex-US assets';
  $('#geo-cards').innerHTML=out.join('')||'<div class="none">No matches.</div>';
 }
 q.addEventListener('input',render); render();
}
function geoCard(r){
 const tch=r.targets.slice(0,5).map(t=>`<span class="chip t" onclick="gotoTarget('${esc(t)}')">${esc(t)}</span>`).join('');
 const reg=r.regions.map(x=>`<span class="chip" style="background:var(--accent-soft);border-color:#f1c9b4;color:#b23b12">${esc(x)}</span>`).join('');
 return `<div class="acard" data-ev="${esc(r.k)}" data-evt="${esc(r.name||'')}" data-evs="approved" data-targets="${esc(r.targets.join('|'))}" data-modality="${esc(r.modality||'')}" data-developers="${esc(r.developers.join('|'))}"><h3>${esc(r.name||'—')}${r.year?` <span style="color:var(--faint);font-weight:400;font-size:12px">approved ${r.year}</span>`:''}</h3>
  <div class="tchips">${tch}</div>
  <div class="meta">${esc(r.modality||'—')} · ${esc(r.developers.join(', ')||'—')}</div>
  <div style="margin:2px 0 8px">${reg}</div>
  <div class="note">${esc(r.note||'')}</div></div>`;
}

/* ================= COMBINATION ================= */
const NETPAL=['#2b6cb0','#e0662f','#2f9e6f','#8250c4','#d1477a','#1c9aa8','#b8902a','#5a7a2e','#c0453f','#3f6f8f','#a15b2e','#6b4fa0'];
const ncolor=c=>(c>=0&&c<NETPAL.length)?NETPAL[c]:'#c3ccd3';
let NET={};
function initCombination(){
 const n=D.network;
 $('#net-lead').textContent=`Two targets are linked when a multispecific molecule engages both. Of `
  +`${nf(n.n_edges_total)} pairings we show the core: ${nf(n.n_nodes)} targets that recur across ${n.n_modules} design `
  +`modules (colour = module, node size = how many partner programs a target anchors). Filtered to clinical-stage `
  +`programs (Phase 1+) by default; hover a target to isolate its partners.`;
 $('#net-legend').innerHTML=n.communities.map(c=>`<span><i style="background:${ncolor(c.i)}"></i>${esc(c.hub)}${c.hub==='CD3'?' · T-cell engagers':''} <span style="color:var(--faint)">(${c.size})</span></span>`).join('');
 buildNet(n);
 $('#net-slider').addEventListener('input',e=>{$('#net-mw').textContent=e.target.value;drawNet();});
 $('#net-stage').addEventListener('input',drawNet);
 $('#net-q').addEventListener('input',()=>emphasize(null));
}
function buildNet(n){
 const xs=n.nodes.map(d=>d.x),ys=n.nodes.map(d=>d.y);
 const minx=Math.min(...xs),maxx=Math.max(...xs),miny=Math.min(...ys),maxy=Math.max(...ys);
 const W=1000,H=640,pad=52;
 const sx=x=>pad+(x-minx)/(maxx-minx||1)*(W-2*pad);
 const sy=y=>pad+(y-miny)/(maxy-miny||1)*(H-2*pad);
 const pos={}; n.nodes.forEach(d=>pos[d.id]={x:sx(d.x),y:sy(d.y),d});
 const maxw=Math.max(...n.nodes.map(d=>d.w));
 NET={n,pos,W,H,maxw,view:[0,0,W,H],hoverId:null,adj:{}};
 const svg=$('#net'); svg.setAttribute('viewBox',`0 0 ${W} ${H}`);
 let drag=null;
 svg.onwheel=e=>{e.preventDefault();const v=NET.view;const k=e.deltaY<0?0.85:1.18;
  const r=svg.getBoundingClientRect();const mx=v[0]+(e.clientX-r.left)/r.width*v[2],my=v[1]+(e.clientY-r.top)/r.height*v[3];
  let nw=v[2]*k,nh=v[3]*k;nw=Math.max(90,Math.min(W*1.5,nw));nh=Math.max(58,Math.min(H*1.5,nh));
  NET.view=[mx-(mx-v[0])*nw/v[2],my-(my-v[1])*nh/v[3],nw,nh];applyView();};
 svg.onmousedown=e=>{if(e.target.tagName==='circle')return;drag={x:e.clientX,y:e.clientY,v:[...NET.view]};svg.classList.add('drag');};
 window.addEventListener('mousemove',e=>{if(!drag)return;const r=svg.getBoundingClientRect();
  NET.view=[drag.v[0]-(e.clientX-drag.x)/r.width*NET.view[2],drag.v[1]-(e.clientY-drag.y)/r.height*NET.view[3],NET.view[2],NET.view[3]];applyView();});
 window.addEventListener('mouseup',()=>{drag=null;svg.classList.remove('drag');});
 drawNet();
}
function applyView(){$('#net').setAttribute('viewBox',NET.view.join(' '));}
function emphasize(focus){
 const svg=$('#net'); if(!svg) return;
 const q=$('#net-q').value.trim().toUpperCase();
 const f=focus||(q||null);
 if(!f){svg.querySelectorAll('.dim').forEach(e=>e.classList.remove('dim'));svg.querySelectorAll('line.hl').forEach(e=>e.classList.remove('hl'));return;}
 const nb=NET.adj[f]||new Set();
 svg.querySelectorAll('circle').forEach(c=>c.classList.toggle('dim',!(c.dataset.n===f||nb.has(c.dataset.n))));
 svg.querySelectorAll('text').forEach(t=>t.classList.toggle('dim',!(t.dataset.n===f||nb.has(t.dataset.n))));
 svg.querySelectorAll('line').forEach(l=>{const p=l.dataset.e.split('|');const on=(p[0]===f||p[1]===f);l.classList.toggle('hl',on);l.classList.toggle('dim',!on);});
}
const ewOf=(e,ms)=>{let s=0;for(let r=ms;r<6;r++)s+=e.sc[r];return s;};   // shared molecules at >= stage
function drawNet(){
 const {n,pos}=NET; const mw=+$('#net-slider').value, ms=+$('#net-stage').value;
 const vis=n.edges.map(e=>({e,w:ewOf(e,ms)})).filter(o=>o.w>=mw);
 const keep=new Set(); const adj={}; const vdeg={}; const ewmap={};
 vis.forEach(o=>{const e=o.e;keep.add(e.a);keep.add(e.b);ewmap[e.a+'|'+e.b]=o.w;
  (adj[e.a]=adj[e.a]||new Set()).add(e.b);(adj[e.b]=adj[e.b]||new Set()).add(e.a);
  vdeg[e.a]=(vdeg[e.a]||0)+o.w;vdeg[e.b]=(vdeg[e.b]||0)+o.w;});
 NET.adj=adj;
 const maxvw=Math.max(1,...Object.values(vdeg));
 const rad=id=>3.5+8*Math.sqrt((vdeg[id]||1)/maxvw);
 let s='';
 for(const o of vis){const e=o.e,a=pos[e.a],b=pos[e.b];if(!a||!b)continue;
  s+=`<line x1="${a.x.toFixed(1)}" y1="${a.y.toFixed(1)}" x2="${b.x.toFixed(1)}" y2="${b.y.toFixed(1)}" stroke-width="${(0.5+Math.min(4,o.w*0.6)).toFixed(1)}" class="${e.intra?'intra':'inter'}" data-e="${esc(e.a)}|${esc(e.b)}"/>`;
 }
 for(const d of n.nodes){if(!keep.has(d.id))continue;const p=pos[d.id];
  s+=`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${rad(d.id).toFixed(1)}" fill="${ncolor(d.comm)}" data-n="${esc(d.id)}"/>`;
 }
 const big=[...keep].sort((a,b)=>(vdeg[b]||0)-(vdeg[a]||0)).slice(0,30);
 for(const id of big){const p=pos[id];
  s+=`<text x="${p.x.toFixed(1)}" y="${(p.y-rad(id)-2.5).toFixed(1)}" text-anchor="middle" data-n="${esc(id)}">${esc(id)}</text>`;}
 const svg=$('#net'); svg.innerHTML=s;
 if(!vis.length) svg.innerHTML=`<text x="500" y="320" text-anchor="middle" fill="#93a4b1" style="stroke:none;font-size:15px">No pairings at this stage / threshold.</text>`;
 const tip=$('#nettip');
 svg.onmousemove=ev=>{const el=ev.target;
  if(el.tagName==='circle'){const id=el.dataset.n;if(NET.hoverId!==id){NET.hoverId=id;emphasize(id);}
   const d=n.nodes.find(x=>x.id===id);const np=adj[id]?adj[id].size:0;
   tip.innerHTML=`<b>${esc(id)}</b> · ${PL[d.ph]}<br>${np} partner${np==1?'':'s'} shown`;
   tip.style.opacity=1;tip.style.left=(ev.clientX+14)+'px';tip.style.top=(ev.clientY+14)+'px';}
  else{if(NET.hoverId!==null){NET.hoverId=null;emphasize(null);}
   if(el.tagName==='line'){const p=el.dataset.e.split('|');const e=n.edges.find(x=>x.a===p[0]&&x.b===p[1]);const w=ewmap[p[0]+'|'+p[1]];
    tip.innerHTML=`<b>${esc(p[0])} ↔ ${esc(p[1])}</b><br>${w} shared molecule${w==1?'':'s'}`+(e.ex.length?`<br><span style="color:#bcd">${esc(e.ex.join(', '))}${e.more?` +${e.more}`:''}</span>`:'');
    tip.style.opacity=1;tip.style.left=(ev.clientX+14)+'px';tip.style.top=(ev.clientY+14)+'px';}
   else tip.style.opacity=0;}
 };
 svg.onmouseleave=()=>{tip.style.opacity=0;if(NET.hoverId!==null){NET.hoverId=null;emphasize(null);}};
 svg.querySelectorAll('circle').forEach(c=>c.onclick=()=>gotoTarget(c.dataset.n));
 // right panel: relative co-occurrence strength as ranked bars (no raw molecule counts)
 const commOf={}; n.nodes.forEach(d=>commOf[d.id]=d.comm);
 const pv=vis.slice().sort((a,b)=>b.w-a.w).slice(0,18);
 const pmax=pv.length?pv[0].w:1;
 $('#pairs').innerHTML=pv.length?pv.map(o=>{
   const col=o.e.intra?ncolor(commOf[o.e.a]):'#8aa0ad';
   return `<div class="pairrow"><span class="plabel"><span class="ptgt" onclick="gotoTarget('${esc(o.e.a)}')">${esc(o.e.a)}</span> ↔ <span class="ptgt" onclick="gotoTarget('${esc(o.e.b)}')">${esc(o.e.b)}</span></span>`
    +`<span class="ptrack"><span class="pfill" style="width:${(100*o.w/pmax).toFixed(1)}%;background:${col}"></span></span></div>`;
 }).join(''):'<div class="empty">none at this stage</div>';
 emphasize(null);
}

/* ================= DEEP-DIVE ================= */
// reusable checkbox multi-select; returns the live Set of selected values
function buildMS(hostId,label,items,onchange){
 const host=$('#'+hostId), sel=new Set();
 host.innerHTML=`<button type="button">${label} <span class="badge" style="display:none">0</span><span class="car">▾</span></button>`
  +`<div class="panel">${items.map(x=>`<label><input type="checkbox" value="${esc(x)}"> ${esc((''+x).replace(/_/g,' '))}</label>`).join('')}</div>`;
 const btn=host.querySelector('button'), badge=host.querySelector('.badge');
 btn.onclick=e=>{e.stopPropagation();const open=host.classList.contains('open');$$('.ms.open').forEach(m=>m.classList.remove('open'));if(!open)host.classList.add('open');};
 host.querySelector('.panel').onclick=e=>e.stopPropagation();
 host.querySelectorAll('input').forEach(cb=>cb.onchange=()=>{
  cb.checked?sel.add(cb.value):sel.delete(cb.value);
  badge.textContent=sel.size; badge.style.display=sel.size?'':'none'; onchange();
 });
 host._sel=sel; return sel;
}
document.addEventListener('click',()=>$$('.ms.open').forEach(m=>m.classList.remove('open')));

function initExplore(){
 const dd=D.deepdive;
 const q=$('#dq'),fc=$('#dcomp'),fd=$('#ddrug');
 const selMod=buildMS('ms-mod','modality',dd.mods,()=>render());
 const selPh=buildMS('ms-ph','phase',dd.phases,()=>render());
 const selReg=buildMS('ms-reg','region',dd.regions,()=>render());
 function molRow(m,target){
  const tags=(m.bs?'<span class="tag">biosimilar</span>':'')+(m.ms?'<span class="tag">multispecific</span>':'')
   +(m.ot?` <span style="color:var(--faint);font-size:10px">+${esc(m.ot)}</span>`:'');
  const note=m.note?`<tr class="noterow"><td colspan="5">${esc(m.note)}</td></tr>`:'';
  return `<tr data-ev="${esc(m.k)}" data-evt="${esc(m.n)}" data-evs="${esc(m.p)}" data-targets="${esc(target)}" data-modality="${esc(m.m||'')}" data-developers="${esc(m.d||'')}"><td>${esc(m.n)}${tags}</td><td>${esc(m.m)}</td><td>${phasePill(m.p)}</td><td>${esc(m.d)}</td><td style="text-align:right">${m.e}</td></tr>${note}`;
 }
 function card(r){
  const body=r.mols.length?`<table class="dtab"><thead><tr><th>molecule</th><th>modality</th><th>phase</th><th>developer(s)</th><th>cites</th></tr></thead><tbody>${r.mols.map(m=>molRow(m,r.s)).join('')}</tbody></table>`
   :`<div class="empty">No biologic found — white space.</div>`;
  return `<div class="dcard" id="dc-${esc(r.s)}"><h3>${esc(r.s)} <span class="comp">${esc(r.c)}</span></h3>
   <div class="meta">${r.nm} biologic${r.nm==1?'':'s'}</div>${body}</div>`;
 }
 const regsLC=()=>[...selReg].map(x=>x.toLowerCase());
 function render(){
  const term=q.value.trim().toLowerCase(),cp=fc.value,dg=fd.checked;
  const active=term||selMod.size||selPh.size||selReg.size||cp||dg;
  if(!active){
   $('#dcount').textContent='';
   $('#dmain').innerHTML=`<div class="none">Start typing a gene, alias, molecule, or brand — or pick a filter — to search ${nf(dd.recs.length)} targets.</div>`;
   return;
  }
  const rl=regsLC(); let out=[],shown=0;
  for(const r of dd.recs){
   if(term&&!r.blob.includes(term))continue;
   if(cp&&r.c!==cp)continue;
   if(dg&&r.nm===0)continue;
   let mols=r.mols;
   if(selMod.size)mols=mols.filter(m=>selMod.has(m.m));
   if(selPh.size)mols=mols.filter(m=>selPh.has(m.p));
   if(selReg.size)mols=mols.filter(m=>{const rr=m.r.toLowerCase();return rl.some(x=>rr.includes(x));});
   if((selMod.size||selPh.size||selReg.size)&&mols.length===0)continue;
   shown++; if(shown>300)continue;
   out.push(card({...r,mols}));
  }
  $('#dcount').textContent=nf(shown)+' target'+(shown==1?'':'s')+(shown>300?' (showing 300)':'');
  $('#dmain').innerHTML=out.length?out.join(''):'<div class="none">No matches.</div>';
 }
 window._renderExplore=render;
 [q,fc,fd].forEach(e=>e.addEventListener('input',render));
 render();
}
function gotoTarget(sym){
 if(typeof CHAT!=='undefined')CHAT.context.tab='explore';
 $$('#nav button').forEach(x=>x.classList.toggle('on',x.dataset.t==='explore'));
 $$('.tab').forEach(s=>s.classList.toggle('on',s.id==='t-explore'));
 if(!inited.explore){inited.explore=1;initExplore();}
 ['ms-mod','ms-ph','ms-reg'].forEach(id=>{const h=$('#'+id);if(h&&h._sel){h._sel.clear();h.querySelectorAll('input').forEach(c=>c.checked=false);const b=h.querySelector('.badge');if(b){b.textContent='0';b.style.display='none';}}});
 $('#dcomp').value='';$('#ddrug').checked=false;
 $('#dq').value=sym; window._renderExplore();
 window.scrollTo({top:0,behavior:'instant'});
 const c=$('#dc-'+sym); if(c&&c.scrollIntoView)c.scrollIntoView({behavior:'smooth',block:'center'});
}

/* ================= METHODS ================= */
function initMethods(){
 const m=D.methods;
 $('#meth-stats').innerHTML=[
  [nf(m.n_targets),'targets mapped'],[nf(m.n_mol_rows),'molecule records'],
  [nf(m.n_citations),'citations'],[nf(m.n_docs),'source documents'],[m.n_ungrounded,'ungrounded'],
 ].map(s=>`<div class="stat"><div class="v num">${s[0]}</div><div class="l">${s[1]}</div></div>`).join('');
 const pubpct=(m.n_cite_public&&m.n_cite_distinct)?Math.round(100*m.n_cite_public/m.n_cite_distinct):null;
 $('#meth-cite').innerHTML=`${nf(m.n_citations)} citations trace to ${nf(m.n_docs)} distinct FDA / trial / literature documents`
   +(pubpct!=null?`; <b>${pubpct}%</b> of distinct sources resolve to a public record (ClinicalTrials.gov · PubMed Central · OpenAlex · Drugs@FDA), the rest tracked in paperclip. Hover any molecule for its cited sources.`:`.`);
 const SRCN={fda:'FDA / EMA / PMDA',trial:'clinical trials',paper:'literature',abstract:'conference abstracts'};
 bars($('#meth-src'),m.evidence_by_source.map(s=>({k:SRCN[s[0]]||s[0],v:s[1],c:'#6a7b9c'})));
 $('#meth-dl').innerHTML=[
  ['Universe','surfaceome ∪ secretome (SURFY + HPA + HGNC)'],
  ['Miner','one Opus agent per target · paperclip'],
  ['Sources','trials · FDA/EMA/PMDA · literature'],
  ['Grounding','100% cited · 0 ungrounded'],
  ['Provenance','hover a molecule → its cited sources, linked'],
  ['Disease axis','handed to integrated_v1'],
  ['Snapshot','curated research dataset'],
 ].map(x=>`<dt>${x[0]}</dt><dd>${x[1]}</dd>`).join('');
 $('#foot').innerHTML=`The Biologic Universe · ${nf(m.n_targets)} targets · ${nf(m.n_mol_rows)} biologic records · `
  +`built from a curated research snapshot. All data embedded; works offline.`;
}

const INIT={universe:initUniverse,repurposing:initRepurposing,combination:initCombination,explore:initExplore,methods:initMethods};
inited.universe=1; initUniverse();

/* ================= EMBEDDED ANALYST ================= */
const CHAT={conversation:null,loadedConversation:null,busy:false,context:{tab:'universe',selections:[]},feedback:null,interview:null,expertQuestions:[],pending:null,selectedEl:null,historyOpen:false,expertOpen:false};
const FEEDBACK_LABELS={add_nuance:'Add nuance',challenge_assumption:'Challenge assumption',change_direction:'Change direction'};
const FEEDBACK_HINTS={add_nuance:'Add missing context',challenge_assumption:'Question evidence',change_direction:'Redirect the analysis'};
function chatOpen(on=true){
 $('#chat-drawer').classList.toggle('on',on);$('#chat-scrim').classList.toggle('on',on);document.body.classList.toggle('chat-open',on);
 $('#chat-drawer').setAttribute('aria-hidden',on?'false':'true');$('#chat-launch').setAttribute('aria-expanded',on?'true':'false');
 if(on)setTimeout(()=>$('#chat-input').focus(),120);
}
function chatWelcome(){
 $('#chat-messages').innerHTML='<div class="chat-empty" id="chat-empty"><span class="chat-empty-label">Try asking</span><div class="chat-empty-prompts"><button type="button">Which biologics target SOST?</button><button type="button">Compare PCSK9 biologic programs</button></div></div>';
 $$('.chat-empty-prompts button').forEach(button=>button.onclick=()=>chatAsk(button.textContent));
}
function chatSelections(c){
 if(!c||typeof c!=='object')return[];
 if(Array.isArray(c.selections))return c.selections.filter(item=>item&&item.selection_type).slice(0,10);
 return c.selection_type?[c]:[];
}
function chatSelectionSummary(c){
 if(c.selection_type==='asset')return`Asset · ${c.asset_name||c.asset_id||'Selected asset'}`;
 if(c.selection_type==='target_modality')return`Modality gap · ${c.target||'Selected target'}${c.gap_modality?' · '+c.gap_modality:''}`;
 if(c.selection_type==='target')return`Target · ${c.target||'Selected target'}`;
 if(c.selection_type==='text')return`Selected text · ${(c.selection_text||'').slice(0,70)}`;
 return'Selected context';
}
function chatContextSummary(c){
 const selections=chatSelections(c);if(!selections.length)return'';
 if(selections.length===1)return chatSelectionSummary(selections[0]);
 const names=selections.slice(0,2).map(item=>chatSelectionSummary(item).replace(/^.*? · /,''));
 return`${selections.length} selections · ${names.join(' + ')}${selections.length>2?' + more':''}`;
}
function chatHistoryDate(value){
 const date=new Date(Number(value));if(Number.isNaN(date.getTime()))return'';
 const today=new Date(),same=date.toDateString()===today.toDateString();
 return same?date.toLocaleTimeString([],{hour:'numeric',minute:'2-digit'}):date.toLocaleDateString([],{month:'short',day:'numeric'});
}
async function chatRefreshHistory(){
 const list=$('#chat-history-list');list.innerHTML='<div class="chat-history-empty">Loading conversations…</div>';
 try{
  const res=await fetch('/api/conversations?limit=50'),body=await res.json();if(!res.ok)throw new Error(body.error||'Could not load history');
  const rows=body.conversations||[];if(!rows.length){list.innerHTML='<div class="chat-history-empty">No saved conversations yet.</div>';return;}
  list.innerHTML=rows.map(row=>`<div class="chat-history-row${row.id===CHAT.conversation?' current':''}" data-conversation="${esc(row.id)}">
   <button class="chat-history-open" type="button"><span class="chat-history-title">${esc(row.title)}</span><span class="chat-history-meta">${esc(chatHistoryDate(row.updated_at))} · ${Number(row.message_count)||0} messages</span></button>
   <span class="chat-history-tools"><button class="chat-history-tool rename" type="button" aria-label="Rename conversation" title="Rename"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10L4 20Z"/><path d="m14.5 7.5 3 3"/></svg></button><button class="chat-history-tool delete" type="button" aria-label="Delete conversation" title="Delete"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M4 7h16M9 7V4h6v3M7 7l1 13h8l1-13"/></svg></button></span>
  </div>`).join('');
 }catch(err){list.innerHTML=`<div class="chat-history-empty">${esc(err.message)}</div>`;}
}
function chatHistoryOpen(on){
 CHAT.historyOpen=on;$('#chat-history').classList.toggle('on',on);$('#chat-history').setAttribute('aria-hidden',on?'false':'true');
 $('#chat-history-toggle').setAttribute('aria-expanded',on?'true':'false');if(on){chatExpertOpen(false);chatRefreshHistory();}
}
function chatPendingExpertQuestions(){return(CHAT.expertQuestions||[]).filter(question=>question.status==='pending');}
function chatExpertRender(){
 const pending=chatPendingExpertQuestions(),count=$('#chat-expert-count'),button=$('#chat-expert-toggle'),list=$('#chat-expert-list');
 count.textContent=String(pending.length);count.classList.toggle('on',pending.length>0);button.classList.toggle('has-count',pending.length>0);
 $('#chat-expert-title').textContent=pending.length?`Expert input · ${pending.length} pending`:'Expert input';
 if(!pending.length)list.innerHTML='<div class="chat-expert-empty">No expert input is pending.<br>Continue exploring—the Agent will add a question only when your perspective could change the analysis.</div>';
 else list.innerHTML=pending.map(question=>`<article class="chat-expert-item" data-expert-id="${esc(question.id)}"><span class="chat-expert-item-topic">${esc(question.topic||'Expert input')}</span><p>${esc(question.question)}</p><div class="chat-expert-item-actions"><button class="chat-expert-answer" type="button">Share perspective</button><button class="chat-expert-dismiss" type="button">Dismiss</button></div></article>`).join('');
 $$('[data-expert-card]').forEach(card=>{const question=CHAT.expertQuestions.find(item=>item.id===card.dataset.expertCard);card.classList.toggle('resolved',Boolean(question&&question.status!=='pending'));});
}
function chatExpertOpen(on){
 CHAT.expertOpen=on;$('#chat-expert-panel').classList.toggle('on',on);$('#chat-expert-panel').setAttribute('aria-hidden',on?'false':'true');
 $('#chat-expert-toggle').setAttribute('aria-expanded',on?'true':'false');if(on){chatHistoryOpen(false);chatExpertRender();}
}
async function chatRefreshExpertQuestions(){
 if(!CHAT.conversation){CHAT.expertQuestions=[];chatExpertRender();return;}
 try{const res=await fetch('/api/conversations/'+encodeURIComponent(CHAT.conversation)+'/expert-questions'),body=await res.json();if(!res.ok)throw new Error(body.error||'Could not load expert input');CHAT.expertQuestions=body.expert_questions||[];chatExpertRender();}
 catch(_err){chatExpertRender();}
}
function chatInterviewDraft(){
 const el=$('#chat-interview-draft'),form=$('#chat-form'),input=$('#chat-input'),interview=CHAT.interview;
 if(!interview){el.innerHTML='';el.classList.remove('on');form.classList.remove('interview-mode');if(!CHAT.feedback)input.placeholder='What should we explore together?';return;}
 el.innerHTML=`<div class="chat-interview-top"><span><strong>${esc(interview.topic||'Expert input requested')}</strong><small>Your response will be used as attributed expert judgment.</small></span><button class="chat-interview-clear" type="button" aria-label="Answer later">×</button></div><p class="chat-interview-question">${esc(interview.question)}</p>`;
 el.classList.add('on');form.classList.add('interview-mode');input.placeholder='Share your expert perspective…';el.querySelector('.chat-interview-clear').onclick=()=>{CHAT.interview=null;chatInterviewDraft();};
}
function chatStartInterview(question){
 if(!question||question.status!=='pending')return;CHAT.feedback=null;chatFeedback();CHAT.interview={...question};chatExpertOpen(false);chatInterviewDraft();$('#chat-input').focus();
}
async function chatDismissInterview(question){
 if(!CHAT.conversation||!question)return;const res=await fetch('/api/conversations/'+encodeURIComponent(CHAT.conversation)+'/expert-questions/'+encodeURIComponent(question.id)+'/dismiss',{method:'POST'}),body=await res.json();if(!res.ok)throw new Error(body.error||'Could not dismiss question');
 CHAT.expertQuestions=CHAT.expertQuestions.map(item=>item.id===question.id?body.expert_question:item);if(CHAT.interview?.id===question.id){CHAT.interview=null;chatInterviewDraft();}chatExpertRender();
}
function chatNew(){
 CHAT.conversation=null;CHAT.loadedConversation=null;CHAT.expertQuestions=[];CHAT.interview=null;try{localStorage.removeItem('biologic-universe-conversation');}catch(_err){}
 chatClearSelection();chatClearFeedback();chatInterviewDraft();chatExpertRender();chatWelcome();chatHistoryOpen(false);chatExpertOpen(false);$('#chat-input').value='';$('#chat-input').focus();
}
async function chatLoadConversation(id){
 if(CHAT.busy)return;const res=await fetch('/api/conversations/'+encodeURIComponent(id)),body=await res.json();if(!res.ok)throw new Error(body.error||'Could not load conversation');
 const conversation=body.conversation;CHAT.conversation=conversation.id;CHAT.expertQuestions=conversation.expert_questions||[];CHAT.interview=null;try{localStorage.setItem('biologic-universe-conversation',conversation.id);}catch(_err){}
 CHAT.loadedConversation=conversation.id;
 chatClearSelection();chatClearFeedback();chatInterviewDraft();chatExpertRender();$('#chat-messages').innerHTML='';
 if(!conversation.messages.length)chatWelcome();
 else conversation.messages.forEach(message=>chatMessage(message.role,message.content,false,message.context));
 chatHistoryOpen(false);chatExpertOpen(false);chatOpen(true);
}
async function chatActivate(){
 chatOpen(true);
 if(!CHAT.conversation||CHAT.loadedConversation===CHAT.conversation)return;
 try{await chatLoadConversation(CHAT.conversation);}
 catch(_err){CHAT.conversation=null;CHAT.loadedConversation=null;try{localStorage.removeItem('biologic-universe-conversation');}catch(_storageErr){}chatWelcome();}
}
function chatExpand(on){
 const drawer=$('#chat-drawer'),button=$('#chat-expand');drawer.style.removeProperty('--chat-width');drawer.classList.toggle('wide',on);
 button.setAttribute('aria-pressed',on?'true':'false');button.setAttribute('aria-label',on?'Restore agent':'Expand agent');
 button.title=on?'Restore agent':'Expand agent';
 const room=innerWidth>900?innerWidth-520:innerWidth-36,width=Math.min(room,on?960:430);document.body.style.setProperty('--chat-width',Math.round(width)+'px');$('#chat-resizer').setAttribute('aria-valuenow',Math.round(width));
 try{localStorage.setItem('biologic-universe-chat-width-v3',String(width));}catch(_err){}
}
function chatResize(width,persist=true){
 const min=360,room=innerWidth>900?innerWidth-520:innerWidth-36,max=Math.max(min,Math.min(1100,room)),next=Math.max(min,Math.min(max,Math.round(width)));
 const drawer=$('#chat-drawer');drawer.classList.remove('wide');drawer.style.setProperty('--chat-width',next+'px');document.body.style.setProperty('--chat-width',next+'px');
 const button=$('#chat-expand');button.setAttribute('aria-pressed',next>=900?'true':'false');button.setAttribute('aria-label',next>=900?'Restore agent':'Expand agent');
 button.title=next>=900?'Restore agent':'Expand agent';$('#chat-resizer').setAttribute('aria-valuenow',next);
 if(persist){try{localStorage.setItem('biologic-universe-chat-width-v3',String(next));}catch(_err){}}
}
function chatSelectionDisplay(c){
 let kind='',name='',details=[],preview='';
 if(c.selection_type==='asset'){
  kind='Asset';name=c.asset_name||c.asset_id||'Selected asset';
  if(c.asset_stage)details.push(c.asset_stage.replace(/_/g,' '));if(c.modality)details.push(c.modality);
  if(c.targets&&c.targets.length)details.push('Target '+c.targets.slice(0,2).join(', '));
 }else if(c.selection_type==='target_modality'){
  kind='Modality gap';name=c.target||'Selected target';if(c.gap_modality)details.push(c.gap_modality);if(c.gap_stage)details.push(c.gap_stage);
 }else if(c.selection_type==='target'){
  kind='Target';name=c.target||'Selected target';
 }else if(c.selection_type==='text'){
  kind='Selected text';name=(c.tab||'dashboard').replace(/_/g,' ');preview=c.selection_text||'';
 }
 if(!preview)preview=details.join(' · ')||`Current view: ${(c.tab||CHAT.context.tab||'universe').replace(/_/g,' ')}`;
 return{kind:kind||'Context',name:name||'Selected context',preview};
}
function chatSelectionKey(c){
 if(c.selection_type==='asset')return`asset:${c.asset_id||c.asset_name||''}`;
 if(c.selection_type==='target_modality')return`gap:${c.target||''}|${c.gap_modality||''}|${c.gap_stage||''}`;
 if(c.selection_type==='target')return`target:${c.target||''}`;
 if(c.selection_type==='text')return`text:${c.tab||''}|${c.selection_text||''}`;
 return JSON.stringify(c);
}
function chatFeedback(){
 const el=$('#chat-feedback-draft'),input=$('#chat-input'),feedback=CHAT.feedback,selections=chatSelections(CHAT.context);
 if(!feedback){
  el.innerHTML='';el.classList.remove('on');$('#chat-form').classList.remove('feedback-mode');
  if(!CHAT.interview)input.placeholder=!selections.length?'What should we explore together?':selections.length===1?`Explore ${chatSelectionDisplay(selections[0]).name} together…`:`Compare ${selections.length} selections together…`;
  return;
 }
 const label=feedback.anchor_label||'Selected analysis',wholeAnswer=feedback.anchor_type==='agent_response',traceStep=feedback.anchor_type==='trace_step',anchor=String(feedback.anchor_text||label).replace(/\[([^\]]+)\]\([^)]*\)/g,'$1').replace(/[|*_`#]/g,' ').replace(/https?:\/\/\S+/g,'').replace(/\s+/g,' ').trim().slice(0,280),scopeLabel=wholeAnswer?'Feedback scope':traceStep?'Analysis step':'Selected claim',scopeText=wholeAnswer?'Entire Agent answer above':anchor;
 el.innerHTML=`<div class="chat-feedback-head"><span class="chat-feedback-icon">✦</span><span class="chat-feedback-heading"><strong>What should the Agent reconsider?</strong><small>Your perspective will guide the next analysis.</small></span><button class="chat-feedback-clear" type="button" aria-label="Cancel expert perspective" title="Cancel">×</button></div><div class="chat-feedback-anchor"><b>${esc(scopeLabel)}</b><span class="chat-feedback-quote">${wholeAnswer?esc(scopeText):`“${esc(scopeText)}”`}</span></div><div class="chat-feedback-intents">${Object.entries(FEEDBACK_LABELS).map(([key,value])=>`<button class="chat-feedback-intent${feedback.category===key?' on':''}" type="button" data-feedback-category="${key}"><strong>${esc(value)}</strong><small>${esc(FEEDBACK_HINTS[key])}</small></button>`).join('')}</div><div class="chat-feedback-next">↓ Write your expert perspective below, then send</div>`;
 el.classList.add('on');$('#chat-form').classList.add('feedback-mode');input.placeholder=`What should change? Add your ${FEEDBACK_LABELS[feedback.category].toLowerCase()}…`;
 el.querySelector('.chat-feedback-clear').onclick=chatClearFeedback;
 el.querySelectorAll('.chat-feedback-intent').forEach(button=>button.onclick=()=>{CHAT.feedback.category=button.dataset.feedbackCategory;chatFeedback();input.focus();});
}
function chatClearFeedback(){CHAT.feedback=null;chatFeedback();}
function chatStartFeedback(anchor={}){
 CHAT.interview=null;chatInterviewDraft();
 CHAT.feedback={category:'add_nuance',anchor_type:String(anchor.anchor_type||'agent_response'),anchor_label:String(anchor.anchor_label||'Agent response').slice(0,120),anchor_text:String(anchor.anchor_text||'').slice(0,1000)};
 chatFeedback();$('#chat-input').focus();
}
function chatContext(){
 const selections=chatSelections(CHAT.context),el=$('#chat-context'),input=$('#chat-input');
 if(!selections.length){el.innerHTML='';el.classList.remove('on');chatFeedback();return;}
 const cards=selections.map((item,index)=>{const display=chatSelectionDisplay(item);return`<div class="chat-context-item"><span class="chat-context-copy"><span class="chat-context-label">${esc(display.kind)}</span><span class="chat-context-title">${esc(display.name)}</span><span class="chat-context-preview">${esc(display.preview)}</span></span><button class="chat-context-remove" type="button" data-context-index="${index}" aria-label="Remove ${esc(display.name)}" title="Remove context">×</button></div>`;}).join('');
 el.innerHTML=`<div class="chat-context-head"><span class="chat-context-count">Context · ${selections.length} of 10</span><button class="chat-context-clear-all" id="chat-context-clear-all" type="button">Clear all</button></div><div class="chat-context-list">${cards}</div>`;
 el.classList.add('on');chatFeedback();
 $('#chat-context-clear-all').onclick=chatClearSelection;$$('.chat-context-remove').forEach(button=>button.onclick=()=>chatRemoveContext(Number(button.dataset.contextIndex)));
}
function chatAddContext(next){
 const selections=chatSelections(CHAT.context),key=chatSelectionKey(next);if(selections.some(item=>chatSelectionKey(item)===key)){chatContext();return;}
 if(selections.length>=10){$('#chat-input').placeholder='Remove a context item before adding another.';return;}
 CHAT.context={...CHAT.context,tab:next.tab||CHAT.context.tab||'universe',selections:[...selections,next]};chatContext();
}
function chatRemoveContext(index){
 const selections=chatSelections(CHAT.context).filter((_item,itemIndex)=>itemIndex!==index);CHAT.context={...CHAT.context,selections};chatContext();
}
function chatHideOffer(){const offer=$('#selection-ask');offer.classList.remove('on');offer.setAttribute('aria-hidden','true');}
function chatClearPending(){
 $$('.chat-selected').forEach(el=>el.classList.remove('chat-selected'));CHAT.selectedEl=null;CHAT.pending=null;chatHideOffer();
 try{window.getSelection()?.removeAllRanges();}catch(_err){}
}
function chatClearSelection(){
 chatClearPending();const tab=CHAT.context.tab||'universe';CHAT.context={tab,selections:[]};chatContext();
}
function chatShowOffer(rect,label='Collaborate'){
 const offer=$('#selection-ask'),w=126,h=40,pad=10;let left=Math.max(pad,Math.min(innerWidth-w-pad,rect.right-w));
 let top=rect.bottom+8;if(top+h>innerHeight-pad)top=Math.max(pad,rect.top-h-8);
 $('#selection-ask-label').textContent=label;
 offer.style.left=Math.round(left)+'px';offer.style.top=Math.round(top)+'px';offer.classList.add('on');offer.setAttribute('aria-hidden','false');
}
function chatStageSelection(el,next,rect){
 $$('.chat-selected').forEach(node=>node.classList.remove('chat-selected'));
 if(el){el.classList.add('chat-selected');CHAT.selectedEl=el;}
 CHAT.pending={action:'context',value:{...next,tab:CHAT.context.tab||'universe'}};chatShowOffer(rect||(el&&el.getBoundingClientRect())||{left:10,right:136,top:10,bottom:30});
}
function chatStageFeedback(anchor,rect){
 CHAT.pending={action:'feedback',value:anchor};chatShowOffer(rect||{left:10,right:136,top:10,bottom:30},'Add perspective');
}
async function chatAttachPending(){
 if(!CHAT.pending)return;const pending={...CHAT.pending,value:{...CHAT.pending.value}};chatClearPending();await chatActivate();
 if(pending.action==='feedback')chatStartFeedback(pending.value);else chatAddContext(pending.value);
}
const dataList=value=>(value||'').split('|').map(x=>x.trim()).filter(Boolean);
function chatSelectAsset(asset){
 chatStageSelection(asset,{
  selection_type:'asset',asset_id:asset.dataset.ev||'',asset_name:asset.dataset.evt||'',asset_stage:asset.dataset.evs||'',
  modality:asset.dataset.modality||'',targets:dataList(asset.dataset.targets),developers:dataList(asset.dataset.developers),target:'',gap_modality:'',gap_stage:''
 });
}
function chatSelectTarget(target,el){
 chatStageSelection(el,{selection_type:'target',target,asset_id:'',asset_name:'',asset_stage:'',modality:'',targets:[],developers:[],gap_modality:'',gap_stage:''});
}
function chatSelectText(text,rect){
 chatStageSelection(null,{selection_type:'text',selection_text:text,selection_label:'Selected dashboard text',target:'',asset_id:'',asset_name:'',asset_stage:'',modality:'',targets:[],developers:[],gap_modality:'',gap_stage:''},rect);
}
function md(text){
 let out=esc(text||'');
 out=out.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,'<a href="$2" target="_blank" rel="noopener">$1 ↗</a>');
 out=out.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>').replace(/`([^`]+)`/g,'<code>$1</code>');
 const lines=out.split('\n');let html='',inTable=false;
 for(let i=0;i<lines.length;i++){
  const line=lines[i];
  if(/^\s*\|.*\|\s*$/.test(line)&&i+1<lines.length&&/^\s*\|?\s*:?-+/.test(lines[i+1])){
   const cells=line.split('|').slice(1,-1).map(x=>x.trim());html+='<table><thead><tr>'+cells.map(x=>'<th>'+x+'</th>').join('')+'</tr></thead><tbody>';inTable=true;i++;continue;
  }
  if(inTable&&/^\s*\|.*\|\s*$/.test(line)){const cells=line.split('|').slice(1,-1).map(x=>x.trim());html+='<tr>'+cells.map(x=>'<td>'+x+'</td>').join('')+'</tr>';continue;}
  if(inTable){html+='</tbody></table>';inTable=false;}
  if(/^###?\s+/.test(line))html+='<strong>'+line.replace(/^###?\s+/,'')+'</strong><br>';
  else if(/^[-*]\s+/.test(line))html+='• '+line.replace(/^[-*]\s+/,'')+'<br>';
  else html+=line+(line?'':'&nbsp;')+'<br>';
 }
 if(inTable)html+='</tbody></table>';return html.replace(/(<br>){3,}/g,'<br><br>');
}
function chatTrace(trace){
 if(!trace||typeof trace!=='object')return'';
 const selections=Array.isArray(trace.selections)?trace.selections:[],steps=Array.isArray(trace.steps)?trace.steps:[],sources=Array.isArray(trace.sources)?trace.sources:[],caveats=Array.isArray(trace.caveats)?trace.caveats:[];
 const sections=[];
 if(trace.guidance){const guidance=trace.guidance,category=FEEDBACK_LABELS[guidance.category]||'Expert guidance';sections.push(`<section class="chat-trace-section"><h5>SME guidance applied</h5><p class="chat-trace-rationale"><b>${esc(category)}</b>${guidance.anchor_label?` · ${esc(guidance.anchor_label)}`:''}<br>${esc(guidance.text||'')}</p></section>`);}
 if(trace.expert_input){const input=trace.expert_input;sections.push(`<section class="chat-trace-section"><h5>Expert interview input applied</h5><p class="chat-trace-rationale"><b>${esc(input.topic||'Expert input')}</b> · ${esc(input.question||'')}<br>${esc(input.answer||'')}</p></section>`);}
 if(selections.length)sections.push(`<section class="chat-trace-section"><h5>Context used</h5><div class="chat-trace-context">${selections.map(item=>`<span class="chat-trace-chip">${esc(item)}</span>`).join('')}</div></section>`);
 if(steps.length)sections.push(`<section class="chat-trace-section"><h5>Analysis steps</h5>${steps.map(step=>{
  const filters=(step.filters||[]).map(pair=>`${pair[0]}: ${pair[1]}`),detail=[step.operation,...filters,step.result_count!=null?`${step.result_count} matching records`:null,step.error].filter(Boolean).join(' · ');
  const label=step.label||'Queried the dataset';return`<div class="chat-trace-step"><i class="chat-trace-dot${step.status==='failed'?' failed':''}"></i><span><strong>${esc(label)}</strong>${detail?`<span class="chat-trace-detail">${esc(detail)}</span>`:''}</span><button class="chat-trace-feedback" type="button" data-anchor-label="${esc(label)}" data-anchor-text="${esc(detail||label)}">Review step</button></div>`;
 }).join('')}</section>`);
 if(trace.rationale)sections.push(`<section class="chat-trace-section"><h5>Rationale summary</h5><p class="chat-trace-rationale">${esc(trace.rationale).replace(/\n/g,'<br>')}</p></section>`);
 if(sources.length)sections.push(`<section class="chat-trace-section"><h5>Supporting evidence</h5><div class="chat-trace-sources">${sources.map(source=>`<a class="chat-trace-source" href="${esc(source.url)}" target="_blank" rel="noopener">${esc(source.label||'Source')} ↗</a>`).join('')}</div></section>`);
 if(caveats.length)sections.push(`<section class="chat-trace-section"><h5>Scope & uncertainty</h5><ul class="chat-trace-caveats">${caveats.map(item=>`<li>${esc(item)}</li>`).join('')}</ul></section>`);
 if(!sections.length)return'';const failed=steps.filter(step=>step.status==='failed').length,meta=[`${steps.length} step${steps.length===1?'':'s'}`,`${sources.length} source${sources.length===1?'':'s'}`,failed?`${failed} failed`:null].filter(Boolean).join(' · ');
 return`<details class="chat-trace"><summary>Evidence &amp; rationale<span class="chat-trace-meta">${esc(meta)}</span></summary><div class="chat-trace-body">${sections.join('')}</div></details>`;
}
function chatLiveActivity(message,activity){
 const list=message.querySelector('.chat-live-steps');if(!list||!activity)return;
 const id=String(activity.id||activity.operation||activity.label),existing=[...list.children].find(node=>node.dataset.activityId===id),row=existing||document.createElement('div');
 row.className='chat-live-step';row.dataset.activityId=id;const filters=(activity.filters||[]).map(pair=>`${pair[0]}: ${pair[1]}`),detail=[activity.operation==='context'?null:activity.operation,...filters,activity.result_count!=null?`${activity.result_count} matching records`:null,activity.error].filter(Boolean).join(' · ');
 row.innerHTML=`<i class="${esc(activity.status||'in_progress')}"></i><span><strong>${esc(activity.label||'Analyzing the dashboard')}</strong>${detail?`<small>${esc(detail)}</small>`:''}</span>`;if(!existing)list.appendChild(row);
 const rows=[...list.children],working=rows.filter(node=>node.querySelector('i.in_progress')).length,failed=rows.filter(node=>node.querySelector('i.failed')).length;
 message.querySelector('.chat-live-status').textContent=working?`${working} working`:`${rows.length} step${rows.length===1?'':'s'}${failed?` · ${failed} failed`:''}`;
 $('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
}
function chatLiveRationale(message,text){
 const el=message.querySelector('.chat-live-rationale');if(!el||!text)return;el.textContent=text;el.classList.add('on');$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;
}
function chatExpertRequest(question){
 if(!question||!question.id)return'';const known=CHAT.expertQuestions.find(item=>item.id===question.id),resolved=known&&known.status!=='pending';
 return`<div class="chat-expert-request${resolved?' resolved':''}" data-expert-card="${esc(question.id)}"><b>${esc(question.topic||'Expert input requested')}</b><p>${esc(question.question||'')}</p><button class="chat-expert-card-answer" type="button">Share perspective</button></div>`;
}
async function chatStreamResponse(response,wait){
 const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='',complete=null;
 const handle=line=>{if(!line.trim())return;const event=JSON.parse(line);if(event.type==='activity')chatLiveActivity(wait,event.activity);else if(event.type==='rationale')chatLiveRationale(wait,event.text);else if(event.type==='complete')complete=event;else if(event.type==='error')throw new Error(event.error||'The Agent could not answer.');};
 while(true){const {value,done}=await reader.read();buffer+=decoder.decode(value||new Uint8Array(),{stream:!done});const lines=buffer.split('\n');buffer=lines.pop()||'';for(const line of lines)handle(line);if(done)break;}
 if(buffer.trim())handle(buffer);if(!complete)throw new Error('The Agent response ended before completion.');return complete;
}
function chatMessage(role,text,thinking=false,context=null){
 const el=document.createElement('div');el.className='chat-msg '+role;
 if(role==='assistant'){
  const guidance=context?.trace?.guidance,interviewInput=context?.trace?.expert_input,applied=guidance?`<div class="chat-guidance-applied"><strong>Analysis updated with your perspective</strong>${esc(FEEDBACK_LABELS[guidance.category]||'Expert perspective')} · ${esc(guidance.text||'')}</div>`:interviewInput?`<div class="chat-guidance-applied"><strong>Analysis updated with expert input</strong>${esc(interviewInput.topic||'Expert input')} · ${esc(interviewInput.answer||'')}</div>`:'';
  const action=`<div class="chat-response-actions"><button class="chat-feedback-start" type="button" data-anchor-label="Agent response" data-anchor-text="">Review this answer</button></div>`;
  el.innerHTML=`<div class="chat-label">Agent</div>${thinking?'<div class="chat-thinking"><span class="chat-thinking-dots"><i></i><i></i><i></i></span><span class="chat-thinking-copy">Collaborating · 0s</span></div><div class="chat-live-trace"><div class="chat-live-head">Analysis trace<span class="chat-live-status">Starting</span></div><div class="chat-live-steps"></div><p class="chat-live-rationale"></p></div>':`${applied}<div class="bubble">${md(text)}</div>${chatExpertRequest(context?.expert_question)}${action}${chatTrace(context?.trace)}`}`;
 }else{
  const feedback=context?.feedback,interview=context?.interview_response;if(feedback||interview)el.classList.add('expert');const summary=chatContextSummary(context);
  el.innerHTML=(summary?`<span class="chat-msg-context">${esc(summary)}</span>`:'')+(feedback?`<span class="chat-expert-badge">Expert perspective · ${esc(FEEDBACK_LABELS[feedback.category]||'Add nuance')}</span><span class="chat-expert-anchor">${feedback.anchor_type==='agent_response'?'Entire Agent answer':esc(feedback.anchor_label||'Selected analysis')}${feedback.anchor_text?` · ${esc(feedback.anchor_text)}`:''}</span>`:'')+(interview?`<span class="chat-expert-badge">Expert interview · ${esc(interview.topic||'Expert input')}</span><span class="chat-expert-anchor">${esc(interview.question||'')}</span>`:'')+`<span>${esc(text)}</span>`;
 }
 $('#chat-messages').appendChild(el);$('#chat-messages').scrollTop=$('#chat-messages').scrollHeight;return el;
}
async function chatAsk(question){
 const message=(question||'').trim();if(!message||CHAT.busy)return;
 const feedback=CHAT.feedback?{...CHAT.feedback,text:message}:null,interview=CHAT.interview?{...CHAT.interview,answer:message}:null,messageContext={...CHAT.context,...(feedback?{feedback}:{}),...(interview?{interview_response:interview}:{})};
 CHAT.busy=true;$('#chat-send').disabled=true;$('#chat-empty')?.remove();chatMessage('user',message,false,messageContext);$('#chat-input').value='';CHAT.feedback=null;CHAT.interview=null;chatFeedback();chatInterviewDraft();
 const wait=chatMessage('assistant','',true);
 const startedAt=Date.now(),status=wait.querySelector('.chat-thinking-copy');
 const ticker=setInterval(()=>{const seconds=Math.floor((Date.now()-startedAt)/1000);status.textContent=seconds<60?`Collaborating · ${seconds}s`:`Still collaborating · ${Math.floor(seconds/60)}m ${seconds%60}s`;},1000);
 try{
  const res=await fetch('/api/chat',{method:'POST',headers:{'content-type':'application/json','accept':'application/x-ndjson'},body:JSON.stringify({message,conversation_id:CHAT.conversation,context:CHAT.context,feedback,expert_question_id:interview?.id||null})});
  if(!res.ok){const errorBody=await res.json();throw new Error(errorBody.error||'Request failed');}
  const body=(res.headers.get('content-type')||'').includes('application/x-ndjson')?await chatStreamResponse(res,wait):await res.json();
  if(body.conversation_id){CHAT.conversation=body.conversation_id;CHAT.loadedConversation=body.conversation_id;try{localStorage.setItem('biologic-universe-conversation',CHAT.conversation);}catch(_err){}}
  if(interview)CHAT.expertQuestions=CHAT.expertQuestions.map(item=>item.id===interview.id?{...item,status:'answered',answer:message,resolved_at:Date.now()}:item);
  if(body.expert_question)CHAT.expertQuestions=[{...body.expert_question,conversation_id:CHAT.conversation,status:'pending',answer:null,created_at:Date.now(),resolved_at:null},...CHAT.expertQuestions];
  chatExpertRender();wait.remove();chatMessage('assistant',body.answer||'No answer returned.',false,{trace:body.trace,expert_question:body.expert_question});await chatRefreshExpertQuestions();if(CHAT.historyOpen)chatRefreshHistory();
 }catch(err){if(interview){CHAT.interview=interview;chatInterviewDraft();}wait.remove();chatMessage('assistant',err.message);}
 finally{clearInterval(ticker);CHAT.busy=false;$('#chat-send').disabled=false;$('#chat-input').focus();}
}
$('#chat-launch').onclick=()=>chatActivate();$('#chat-close').onclick=()=>chatOpen(false);$('#chat-scrim').onclick=()=>chatOpen(false);
$('#chat-new').onclick=chatNew;$('#chat-history-new').onclick=chatNew;$('#chat-history-toggle').onclick=()=>chatHistoryOpen(!CHAT.historyOpen);
$('#chat-expert-toggle').onclick=()=>chatExpertOpen(!CHAT.expertOpen);
$('#chat-expert-list').onclick=async e=>{
 const item=e.target.closest('.chat-expert-item');if(!item)return;const question=CHAT.expertQuestions.find(entry=>entry.id===item.dataset.expertId);if(!question)return;
 try{if(e.target.closest('.chat-expert-answer'))chatStartInterview(question);else if(e.target.closest('.chat-expert-dismiss'))await chatDismissInterview(question);}catch(err){alert(err.message);}
};
$('#chat-history-list').onclick=async e=>{
 const row=e.target.closest('.chat-history-row');if(!row)return;const id=row.dataset.conversation;
 try{
  if(e.target.closest('.delete')){if(confirm('Delete this conversation?')){const res=await fetch('/api/conversations/'+encodeURIComponent(id),{method:'DELETE'});const body=await res.json();if(!res.ok)throw new Error(body.error||'Delete failed');if(id===CHAT.conversation)chatNew();else chatRefreshHistory();}return;}
  if(e.target.closest('.rename')){const current=row.querySelector('.chat-history-title').textContent,next=prompt('Rename conversation',current);if(next&&next.trim()){const res=await fetch('/api/conversations/'+encodeURIComponent(id),{method:'PATCH',headers:{'content-type':'application/json'},body:JSON.stringify({title:next.trim()})});const body=await res.json();if(!res.ok)throw new Error(body.error||'Rename failed');chatRefreshHistory();}return;}
  await chatLoadConversation(id);
 }catch(err){alert(err.message);}
};
$('#selection-ask').onclick=e=>{e.stopPropagation();chatAttachPending();};
$('#chat-expand').onclick=()=>chatExpand($('#chat-expand').getAttribute('aria-pressed')!=='true');
const chatResizer=$('#chat-resizer');
chatResizer.onpointerdown=e=>{
 if(e.button!==0)return;const drawer=$('#chat-drawer'),startX=e.clientX,startWidth=drawer.getBoundingClientRect().width;
 drawer.classList.add('resizing');document.body.classList.add('chat-resizing');chatResizer.setPointerCapture(e.pointerId);
 chatResizer.onpointermove=move=>chatResize(startWidth+(startX-move.clientX),false);
 chatResizer.onpointerup=()=>{drawer.classList.remove('resizing');document.body.classList.remove('chat-resizing');chatResizer.onpointermove=null;chatResize(drawer.getBoundingClientRect().width,true);};
};
chatResizer.onkeydown=e=>{
 if(e.key!=='ArrowLeft'&&e.key!=='ArrowRight')return;e.preventDefault();
 const delta=e.key==='ArrowLeft'?40:-40;chatResize($('#chat-drawer').getBoundingClientRect().width+delta,true);
};
$('#chat-form').onsubmit=e=>{e.preventDefault();chatAsk($('#chat-input').value);};
$('#chat-input').onkeydown=e=>{if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();chatAsk(e.currentTarget.value);}};
$('#chat-input').oninput=e=>{e.currentTarget.style.height='auto';e.currentTarget.style.height=Math.min(120,e.currentTarget.scrollHeight)+'px';};
document.addEventListener('click',e=>{
 const expertAnswer=e.target.closest('.chat-expert-card-answer');if(expertAnswer){const card=expertAnswer.closest('[data-expert-card]'),question=CHAT.expertQuestions.find(item=>item.id===card?.dataset.expertCard);if(question)chatStartInterview(question);return;}
 const responseFeedback=e.target.closest('.chat-feedback-start');if(responseFeedback){chatStartFeedback({anchor_type:'agent_response',anchor_label:responseFeedback.dataset.anchorLabel||'Agent response',anchor_text:responseFeedback.dataset.anchorText||''});return;}
 const traceFeedback=e.target.closest('.chat-trace-feedback');if(traceFeedback){chatStartFeedback({anchor_type:'trace_step',anchor_label:traceFeedback.dataset.anchorLabel||'Analysis step',anchor_text:traceFeedback.dataset.anchorText||''});return;}
 if(e.target.closest('#selection-ask,#chat-drawer,#chat-launch'))return;
 const nav=e.target.closest('#nav button');if(nav){CHAT.context={...CHAT.context,tab:nav.dataset.t};chatClearPending();chatContext();return;}
 const target=e.target.closest('.ptgt,.chip.t');if(target){chatSelectTarget(target.textContent.trim(),target);return;}
 const gap=e.target.closest('[data-evg]');if(gap){
  const parts=(gap.dataset.evg||'').split('|');if(parts[0]==='mg'){
   const ci=Number(parts[2]),stage=$('#modgap-stage')?.selectedOptions?.[0]?.textContent||'';
   chatStageSelection(gap,{selection_type:'target_modality',target:parts[1]||'',gap_modality:D.modgap.cols[ci]||'',gap_stage:stage,
    asset_id:'',asset_name:'',asset_stage:'',modality:'',targets:[],developers:[]});return;
  }
 }
 const asset=e.target.closest('[data-ev]');if(asset){chatSelectAsset(asset);return;}
 const networkTarget=e.target.closest('[data-n]');if(networkTarget){chatSelectTarget(networkTarget.dataset.n||'',networkTarget);return;}
 const universeTarget=e.target.closest('[data-i]');if(universeTarget){
  const tile=D.universe.tiles[Number(universeTarget.dataset.i)];if(tile){chatSelectTarget(tile.sym,universeTarget);return;}
 }
 if(CHAT.pending)chatClearPending();
});
document.addEventListener('mouseup',e=>setTimeout(()=>{
 if(e.target.closest('#selection-ask,input,textarea,button'))return;
 const chatAnchor=e.target.closest('#chat-drawer')&&e.target.closest('.chat-msg.assistant .bubble,.chat-trace-step');if(e.target.closest('#chat-drawer')&&!chatAnchor)return;
 const selection=window.getSelection();if(!selection||selection.isCollapsed||!selection.rangeCount)return;
 const text=selection.toString().replace(/\s+/g,' ').trim();if(text.length<2)return;
 const rect=selection.getRangeAt(0).getBoundingClientRect();if(!rect.width&&!rect.height)return;
 if(chatAnchor){const trace=chatAnchor.closest('.chat-trace-step'),label=trace?.querySelector('strong')?.textContent||'Agent response';chatStageFeedback({anchor_type:trace?'trace_step':'agent_claim',anchor_label:label,anchor_text:text.slice(0,1000)},rect);}
 else chatSelectText(text.slice(0,2000),rect);
},0));
chatWelcome();
chatContext();
chatExpertRender();
try{const savedWidth=Number(localStorage.getItem('biologic-universe-chat-width-v3'));if(savedWidth)chatResize(savedWidth,false);}catch(_err){}
try{const savedConversation=localStorage.getItem('biologic-universe-conversation');if(savedConversation)CHAT.conversation=savedConversation;}catch(_err){}
</script>
</body></html>"""


def main(run="prod_batch_001"):
    dpath = os.path.join(_run_dir(run), "viz", "showcase_data.json")
    with open(dpath) as fh:
        data = fh.read()
    out_html = HTML.replace("__DATA__", data)
    out = os.path.join(_run_dir(run), "viz", "showcase.html")
    with open(out, "w") as fh:
        fh.write(out_html)
    print("wrote", out, f"({os.path.getsize(out)//1024:,} KB)")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else "prod_batch_001")
