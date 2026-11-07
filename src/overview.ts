// The page's overview: key figures, the video's outline as a timeline, how
// long each part runs, and how densely it is spoken. Computed from the run
// (segments, chapters) and the summary's own sections and stamps; rendered as
// plain HTML and inline SVG, so the page still fetches nothing.
import { formatStamp, type VideoChapter, type VideoSegment } from "./engine.js";
import { stampSeconds } from "./stamps.js";

export interface Part {
  title: string;
  start: number;
  end: number;
}

export interface OverviewLabels {
  overview: string;
  duration: string;
  parts: string;
  cited: string;
  words: string;
  rate: string;
  perMin: string;
  outline: string;
  outlineNote: string;
  partLength: string;
  speech: string;
  speechNote: string;
  table: string;
  part: string;
  start: string;
  length: string;
  min: string;
  locale: string;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

/** Every V1 stamp a piece of Markdown cites, in seconds. */
export function citedSeconds(md: string): number[] {
  const out: number[] = [];
  for (const m of md.matchAll(/\[((?:V\d+|M)\b[^\]]*)\]/g)) {
    let video = "";
    for (const part of m[1]!.split(/[;,]/)) {
      const p = /^\s*(?:(V\d+)\s+)?(\d{1,2}(?::\d{2}){1,2})\s*$/.exec(part);
      const v = /^\s*(V\d+)/.exec(part)?.[1];
      if (v) video = v;
      if (!p) continue;
      const t = stampSeconds(p[2]!);
      if (t !== undefined && (!video || video === "V1")) out.push(t);
    }
  }
  return out;
}

/** The summary's `##` sections and the stamps each one cites. */
export function summarySections(md: string): { title: string; stamps: number[] }[] {
  const out: { title: string; stamps: number[] }[] = [];
  let cur: { title: string; lines: string[] } | undefined;
  const close = () => {
    if (cur) out.push({ title: cur.title, stamps: citedSeconds(cur.lines.join("\n")) });
  };
  for (const line of md.split("\n")) {
    const h = /^##\s+(.*)$/.exec(line);
    if (h) {
      close();
      cur = { title: h[1]!.replace(/\s*\[[^\]]*\]/g, "").trim(), lines: [] };
    } else cur?.lines.push(line);
  }
  close();
  return out;
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)]!;
};

/**
 * The video's parts, in order: its own chapters when it has them, else the
 * summary's sections that follow the video. A section that spans most of the
 * video (a recap, "takeaways") or breaks the order is not a part; each part
 * runs from where its section is first cited to where the next one starts.
 */
export function videoParts(duration: number, chapters: VideoChapter[], summary?: string): Part[] {
  if (!(duration > 0)) return [];
  if (chapters.length) {
    const cs = [...chapters].sort((a, b) => a.start - b.start);
    return cs.map((c, i) => ({ title: c.title, start: c.start, end: cs[i + 1]?.start ?? duration }));
  }
  if (!summary) return [];
  const kept: { title: string; start: number; mid: number }[] = [];
  for (const s of summarySections(summary)) {
    const st = s.stamps.filter((t) => t <= duration);
    if (st.length < 2) continue;
    const lo = Math.min(...st);
    const hi = Math.max(...st);
    if (hi - lo > duration * 0.5) continue;
    const mid = median(st);
    const prev = kept[kept.length - 1];
    if (prev && mid <= prev.mid) continue;
    kept.push({ title: s.title, start: Math.max(lo, prev ? prev.start + 1 : 0), mid });
  }
  if (kept.length < 2) return [];
  kept[0]!.start = 0;
  return kept.map((k, i) => ({ title: k.title, start: k.start, end: kept[i + 1]?.start ?? duration }));
}

/** Words spoken per minute, in bins across the video: each segment's words spread evenly over its span. */
export function speechRate(segments: VideoSegment[], duration: number, bins = 120): { width: number; rate: number[] } {
  const n = Math.max(1, Math.min(bins, Math.ceil(duration / 30)));
  const width = duration / n;
  const count = new Array<number>(n).fill(0);
  for (const s of segments) {
    const w = words(s.text);
    const a = Math.max(0, s.start);
    const b = Math.min(duration, Math.max(s.end, a + 0.01));
    for (let i = Math.floor(a / width); i < n && i * width < b; i++) {
      const overlap = Math.min(b, (i + 1) * width) - Math.max(a, i * width);
      if (overlap > 0) count[i]! += (w * overlap) / (b - a);
    }
  }
  return { width, rate: count.map((c) => (c * 60) / width) };
}

const seekAttr = (t: number) => `data-t="${Math.floor(t)}"`;
const pct = (x: number, d: number) => `${((x / d) * 100).toFixed(3)}%`;
const minutes = (s: number) => Math.round(s / 60);

export function overviewHtml(o: { duration: number; segments: VideoSegment[]; chapters: VideoChapter[]; summary?: string }, L: OverviewLabels): string {
  const { duration, segments } = o;
  if (!(duration > 0) || !segments.length) return "";
  const parts = videoParts(duration, o.chapters, o.summary);
  const cited = o.summary ? [...new Set(citedSeconds(o.summary).filter((t) => t <= duration))].sort((a, b) => a - b) : [];
  const spoken = segments.reduce((n, s) => n + words(s.text), 0);
  const tiles = [
    [formatStamp(duration), L.duration],
    parts.length ? [String(parts.length), L.parts] : undefined,
    cited.length ? [String(cited.length), L.cited] : undefined,
    [spoken.toLocaleString(L.locale), L.words],
    [String(Math.round(spoken / (duration / 60))), `${L.rate} (${L.perMin})`],
  ].filter((t): t is string[] => !!t);

  const out: string[] = [`<section class="overview viz" aria-label="${esc(L.overview)}">`, `<h2 class="kicker">${esc(L.overview)}</h2>`];
  out.push(
    `<div class="tiles">${tiles.map(([v, k]) => `<div class="tile"><span class="v">${esc(v!)}</span><span class="k">${esc(k!)}</span></div>`).join("")}</div>`,
  );

  // The outline: one strip the length of the video, a segment per part, the
  // cited moments as ticks beneath, a playhead that follows the player.
  out.push(`<figure class="chart"><figcaption><strong>${esc(L.outline)}</strong> <span>${esc(L.outlineNote)}</span></figcaption>`);
  out.push(`<div class="strip" role="group" aria-label="${esc(L.outline)}">`);
  if (parts.length)
    parts.forEach((p, i) => {
      const tip = `${i + 1}. ${p.title} — ${formatStamp(p.start)}–${formatStamp(p.end)} · ${minutes(p.end - p.start)} ${L.min}`;
      out.push(
        `<button type="button" class="seg-part stamp-like" ${seekAttr(p.start)} style="left:${pct(p.start, duration)};width:${pct(p.end - p.start, duration)}" data-tip="${esc(tip)}" aria-label="${esc(tip)}"><span>${i + 1}</span></button>`,
      );
    });
  else out.push(`<span class="seg-part whole" style="left:0;width:100%"></span>`);
  out.push(`<span class="playhead" hidden></span></div>`);
  if (cited.length)
    out.push(
      `<div class="rug" aria-hidden="true">${cited.map((t) => `<button type="button" tabindex="-1" class="tick stamp-like" ${seekAttr(t)} style="left:${pct(t, duration)}" data-tip="${formatStamp(t)}"></button>`).join("")}</div>`,
    );
  const ticks = axisTicks(duration);
  out.push(`<div class="axis">${ticks.map((t) => `<span style="left:${pct(t, duration)}">${formatStamp(t)}</span>`).join("")}</div></figure>`);

  // How long each part runs: magnitude, so one hue, bars from a shared baseline.
  if (parts.length) {
    const longest = Math.max(...parts.map((p) => p.end - p.start));
    out.push(`<figure class="chart"><figcaption><strong>${esc(L.partLength)}</strong></figcaption><ol class="bars">`);
    parts.forEach((p, i) => {
      const len = p.end - p.start;
      const tip = `${p.title} — ${formatStamp(p.start)} · ${minutes(len)} ${L.min}`;
      out.push(
        `<li><button type="button" class="bar-row stamp-like" ${seekAttr(p.start)} data-tip="${esc(tip)}"><span class="bl"><b>${i + 1}</b> ${esc(p.title)}</span><span class="bt"><span class="bf" style="width:${pct(len, longest)}"></span><span class="bv">${minutes(len)} ${L.min}</span></span></button></li>`,
      );
    });
    out.push("</ol>");
    out.push(
      `<details class="table-view"><summary>${esc(L.table)}</summary><table><thead><tr><th>#</th><th>${esc(L.part)}</th><th>${esc(L.start)}</th><th>${esc(L.length)}</th></tr></thead><tbody>${parts
        .map(
          (p, i) =>
            `<tr><td>${i + 1}</td><td>${esc(p.title)}</td><td><button type="button" class="stamp" ${seekAttr(p.start)}>${formatStamp(p.start)}</button></td><td>${minutes(p.end - p.start)} ${L.min}</td></tr>`,
        )
        .join("")}</tbody></table></details></figure>`,
    );
  }

  // Speech rate: a single series over time, so an area with a crosshair.
  const { width, rate } = speechRate(segments, duration);
  const top = Math.max(60, Math.ceil(Math.max(...rate) / 50) * 50);
  const W = 1000;
  const H = 120;
  const x = (i: number) => ((i + 0.5) / rate.length) * W;
  const y = (v: number) => H - (v / top) * H;
  const line = rate.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join("");
  const area = `${line}L${x(rate.length - 1).toFixed(1)},${H}L${x(0).toFixed(1)},${H}Z`;
  const avg = spoken / (duration / 60);
  out.push(
    `<figure class="chart rate" data-unit="${esc(L.perMin)}" data-bin="${width}" data-rates="${rate.map((r) => Math.round(r)).join(",")}"><figcaption><strong>${esc(L.speech)}</strong> <span>${esc(L.speechNote)}</span></figcaption>`,
    `<div class="plot"><div class="yaxis"><span style="top:0">${top}</span><span style="top:50%">${top / 2}</span><span style="top:100%">0</span></div>`,
    `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="${esc(L.speech)}"><line class="grid" x1="0" x2="${W}" y1="${H / 2}" y2="${H / 2}"/><line class="grid" x1="0" x2="${W}" y1="0" y2="0"/><path class="area" d="${area}"/><path class="line" d="${line}"/><line class="avg" x1="0" x2="${W}" y1="${y(avg).toFixed(1)}" y2="${y(avg).toFixed(1)}"/><line class="cross" x1="0" x2="0" y1="0" y2="${H}" visibility="hidden"/></svg>`,
    `</div><div class="axis">${ticks.map((t) => `<span style="left:${pct(t, duration)}">${formatStamp(t)}</span>`).join("")}</div></figure>`,
  );
  out.push("</section>");
  return out.join("\n");
}

/** Round stamps for an axis: every 15 or 30 min on a long video, fewer on a short one. */
function axisTicks(duration: number): number[] {
  const steps = [30, 60, 120, 300, 600, 900, 1800, 3600];
  const step = steps.find((s) => duration / s <= 7) ?? 3600;
  const out: number[] = [];
  for (let t = 0; t <= duration - step * 0.4; t += step) out.push(t);
  return out;
}

export const OVERVIEW_CSS = `
.overview{border-bottom:1px solid var(--line);padding-bottom:1.25rem;margin-bottom:1rem}
.viz{--series:#2a78d6;--series-soft:rgba(42,120,214,.16);--grid:#e4e0d8}
@media (prefers-color-scheme:dark){.viz{--series:#3987e5;--series-soft:rgba(57,135,229,.22);--grid:#2d2b27}}
.tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(7.5rem,1fr));gap:.5rem;margin:.25rem 0 1.25rem}
.tile{background:var(--soft);border-radius:8px;padding:.6rem .75rem;display:flex;flex-direction:column;gap:.1rem}
.tile .v{font-size:1.35rem;font-weight:650;font-variant-numeric:tabular-nums;line-height:1.2}
.tile .k{font-size:.78rem;color:var(--muted)}
.chart{margin:0 0 1.5rem}
.chart figcaption{font-size:.9rem;margin-bottom:.5rem}.chart figcaption span{color:var(--muted);font-size:.82rem}
.strip{position:relative;height:30px}
.seg-part{position:absolute;top:0;height:100%;border:0;padding:0;background:var(--series);border-radius:4px;cursor:pointer;color:#fff;font:600 .72rem/1 ui-sans-serif,system-ui,sans-serif;box-shadow:0 0 0 1px var(--bg);overflow:hidden;opacity:.82}
.seg-part:hover,.seg-part:focus-visible,.seg-part.on{opacity:1;outline:none;box-shadow:0 0 0 1px var(--bg),0 0 0 3px var(--series)}
.seg-part.whole{background:var(--series-soft);cursor:default}
.playhead{position:absolute;top:-4px;bottom:-4px;width:2px;background:var(--fg);border-radius:1px;pointer-events:none}
.rug{position:relative;height:12px;margin-top:3px}
.tick{position:absolute;top:0;width:2px;height:10px;margin-left:-1px;padding:0;border:0;border-radius:1px;background:var(--accent);opacity:.55;cursor:pointer}.tick:hover{opacity:1}
.tick::before{content:"";position:absolute;inset:-4px -4px}
.axis{position:relative;height:1.1rem;margin-top:.2rem;font:.7rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.axis span{position:absolute;transform:translateX(-50%);white-space:nowrap}.axis span:first-child{transform:none}
.bars{list-style:none;margin:0;padding:0;display:grid;gap:2px}
.bar-row{display:grid;grid-template-columns:minmax(9rem,38%) 1fr;gap:.75rem;align-items:center;width:100%;padding:.2rem .25rem;border:0;background:none;color:var(--fg);font:inherit;font-size:.84rem;text-align:left;cursor:pointer;border-radius:4px}
.bar-row:hover,.bar-row:focus-visible,.bar-row.on{background:var(--soft);outline:none}
.bl{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.bl b{display:inline-block;min-width:1.6em;text-align:right;color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums;margin-right:.35rem}
.bt{display:flex;align-items:center;gap:.4rem;min-width:0}
.bf{height:12px;background:var(--series);border-radius:0 4px 4px 0;min-width:2px}
.bv{font-size:.75rem;color:var(--muted);font-variant-numeric:tabular-nums;white-space:nowrap}
.table-view{margin-top:.5rem;font-size:.82rem}.table-view summary{cursor:pointer;color:var(--muted)}
.plot{position:relative;padding-left:2.2rem}
.plot svg{display:block;width:100%;height:120px;overflow:visible;cursor:crosshair}
.yaxis{position:absolute;left:0;top:0;bottom:0;width:2rem;font:.68rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--muted)}
.yaxis span{position:absolute;right:.3rem;transform:translateY(-50%)}
.rate .axis{margin-left:2.2rem}
.grid{stroke:var(--grid);stroke-width:1;vector-effect:non-scaling-stroke}
.area{fill:var(--series-soft)}
.line{fill:none;stroke:var(--series);stroke-width:2;vector-effect:non-scaling-stroke;stroke-linejoin:round}
.avg{stroke:var(--muted);stroke-width:1;stroke-dasharray:4 4;vector-effect:non-scaling-stroke}
.cross{stroke:var(--fg);stroke-width:1;vector-effect:non-scaling-stroke}
.tip{position:fixed;z-index:10;pointer-events:none;background:var(--fg);color:var(--bg);font-size:.78rem;line-height:1.35;padding:.35rem .5rem;border-radius:6px;max-width:22rem;box-shadow:0 4px 14px rgba(0,0,0,.18)}
`;

/** Hover tooltips, the playhead, the active part, the speech-rate crosshair. */
export const OVERVIEW_SCRIPT = `(() => {
const tip = document.createElement("div");
tip.className = "tip"; tip.hidden = true; document.body.append(tip);
const fmt = (t) => { t = Math.max(0, Math.floor(t)); const h = Math.floor(t / 3600), m = Math.floor(t % 3600 / 60), s = t % 60, p = (n) => String(n).padStart(2, "0"); return h ? h + ":" + p(m) + ":" + p(s) : p(m) + ":" + p(s); };
function show(text, x, y) { tip.textContent = text; tip.hidden = false; const r = tip.getBoundingClientRect(); tip.style.left = Math.min(window.innerWidth - r.width - 8, x + 12) + "px"; tip.style.top = Math.max(8, y - r.height - 10) + "px"; }
document.addEventListener("pointermove", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) show(el.dataset.tip, e.clientX, e.clientY); else if (!e.target.closest?.(".rate svg")) tip.hidden = true; });
document.addEventListener("focusin", (e) => { const el = e.target.closest?.("[data-tip]"); if (el) { const r = el.getBoundingClientRect(); show(el.dataset.tip, r.left, r.top); } });
document.addEventListener("focusout", () => { tip.hidden = true; });
const rate = document.querySelector(".rate");
if (rate) {
  const svg = rate.querySelector("svg"), cross = svg.querySelector(".cross"), bin = Number(rate.dataset.bin), rates = rate.dataset.rates.split(",").map(Number);
  const at = (e) => { const r = svg.getBoundingClientRect(); return Math.min(rates.length - 1, Math.max(0, Math.floor((e.clientX - r.left) / r.width * rates.length))); };
  svg.addEventListener("pointermove", (e) => { const i = at(e), x = (i + 0.5) / rates.length * 1000; cross.setAttribute("x1", x); cross.setAttribute("x2", x); cross.setAttribute("visibility", "visible"); show(fmt(i * bin) + "–" + fmt((i + 1) * bin) + " · " + rates[i] + " " + rate.dataset.unit, e.clientX, e.clientY); });
  svg.addEventListener("pointerleave", () => { cross.setAttribute("visibility", "hidden"); tip.hidden = true; });
  svg.addEventListener("click", (e) => { const b = document.createElement("button"); b.className = "stamp"; b.dataset.t = Math.floor(at(e) * bin); b.hidden = true; document.body.append(b); b.click(); b.remove(); });
}
const player = document.getElementById("player");
const strip = document.querySelector(".strip"), head = strip?.querySelector(".playhead"), total = Number(document.body.dataset.duration);
const parts = [...document.querySelectorAll(".seg-part[data-t]")], rows = [...document.querySelectorAll(".bar-row")];
function follow(t) {
  if (!head || !(total > 0)) return;
  head.hidden = false; head.style.left = (t / total * 100) + "%";
  let k = -1; parts.forEach((p, i) => { if (Number(p.dataset.t) <= t + 0.5) k = i; });
  parts.forEach((p, i) => p.classList.toggle("on", i === k)); rows.forEach((r, i) => r.classList.toggle("on", i === k));
}
if (player && player.tagName === "VIDEO") player.addEventListener("timeupdate", () => follow(player.currentTime));
document.addEventListener("click", (e) => { const b = e.target.closest(".stamp, .stamp-like"); if (b && b.dataset.t) follow(Number(b.dataset.t)); }, true);
})();`;
