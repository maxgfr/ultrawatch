// `ultrawatch html <run>`: one self-contained page to watch and understand a
// video. The player (the local file when the run was read from disk, else the
// site's embed), the summary with every [V1 mm:ss] a button that seeks the
// player there, the chapters, the frames, and the full transcript, searchable,
// following playback. No script or style is fetched: it opens from disk.
import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { formatStamp, readVideoRun, type VideoSegment } from "./engine.js";
import { OVERVIEW_CSS, OVERVIEW_SCRIPT, type OverviewLabels, overviewHtml } from "./overview.js";
import { stampSeconds } from "./stamps.js";

export { stampSeconds };

interface Frame {
  file: string;
  time: number;
  stamp: string;
}

const LABELS = {
  en: {
    summary: "Summary",
    chapters: "Chapters",
    frames: "Frames",
    transcript: "Transcript",
    search: "Search the video…",
    searchAria: "Search the transcript",
    follow: "follow playback",
    source: "source",
    open: "Open the video",
    noPlay: "Won't play?",
    onSite: "Watch on YouTube",
    at: "Frame at",
    whisper: "local whisper transcription",
    passage: "passage",
    passages: "passages",
    overview: "Overview",
    duration: "duration",
    parts: "parts",
    cited: "moments cited",
    words: "words spoken",
    rate: "speech rate",
    perMin: "words/min",
    outline: "Outline",
    outlineNote: "each part of the video, and below it the moments the summary cites — click to jump there",
    partLength: "Length of each part",
    speech: "Speech rate",
    speechNote: "words per minute across the video; the dashed line is the average, dips are pauses or inaudible passages",
    table: "Show as a table",
    part: "Part",
    start: "Start",
    length: "Length",
    min: "min",
    locale: "en-US",
  },
  fr: {
    summary: "Résumé",
    chapters: "Chapitres",
    frames: "Images",
    transcript: "Transcript",
    search: "Chercher dans la vidéo…",
    searchAria: "Chercher dans le transcript",
    follow: "suivre la lecture",
    source: "source",
    open: "Ouvrir la vidéo",
    noPlay: "Ne se lit pas ?",
    onSite: "Voir sur YouTube",
    at: "Image à",
    whisper: "transcription whisper locale",
    passage: "passage",
    passages: "passages",
    overview: "Vue d'ensemble",
    duration: "durée",
    parts: "parties",
    cited: "moments cités",
    words: "mots prononcés",
    rate: "débit",
    perMin: "mots/min",
    outline: "Déroulé",
    outlineNote: "chaque partie de la vidéo, et dessous les moments cités par le résumé — cliquez pour y aller",
    partLength: "Durée de chaque partie",
    speech: "Débit de parole",
    speechNote: "mots par minute au fil de la vidéo ; le pointillé est la moyenne, les creux sont des pauses ou des passages inaudibles",
    table: "Voir en tableau",
    part: "Partie",
    start: "Début",
    length: "Durée",
    min: "min",
    locale: "fr-FR",
  },
};
type Labels = (typeof LABELS)["en"] & OverviewLabels;

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const seek = (t: number, label: string) => `<button type="button" class="stamp" data-t="${Math.floor(t)}">${esc(label)}</button>`;

/**
 * Inline Markdown on already-escaped text: code, bold, italics, links, and
 * citations. `[V1 12:34; 13:00]` becomes one seek button per stamp of V1;
 * another video's stamps stay as text, and `[M]` (grounded by the page's own
 * header) is dropped with the space before it.
 */
function inline(raw: string): string {
  const codes: string[] = [];
  let s = esc(raw).replace(/`([^`]+)`/g, (_, c: string) => `\uE000${codes.push(c) - 1}\uE000`);
  s = s.replace(/(\s?)\[((?:V\d+|M)\b[^\]]*)\](?:\((https?:[^)\s]+)\))?/g, (_, space: string, body: string) => {
    let video = "";
    const parts = body.split(/[;,]/).map((part) => {
      const m = /^\s*(?:(V\d+)\s+)?(M|\d{1,2}(?::\d{2}){1,2})\s*$/.exec(part);
      if (!m) return esc(part.trim());
      video = m[1] ?? video;
      if (m[2] === "M") return "";
      const t = stampSeconds(m[2]!);
      if (t === undefined || (video && video !== "V1")) return `${video ? `${video} ` : ""}${m[2]}`;
      return seek(t, m[2]!);
    });
    const shown = parts.filter(Boolean);
    return shown.length ? `${space}<span class="cite">${shown.join(" ")}</span>` : "";
  });
  s = s
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*\w])\*([^*\s][^*]*)\*/g, "$1<em>$2</em>")
    .replace(/(^|\W)_([^_\s][^_]*)_(?=\W|$)/g, "$1<em>$2</em>");
  return s.replace(/\uE000(\d+)\uE000/g, (_, i: string) => `<code>${codes[Number(i)]}</code>`);
}

/** Headings, lists, quotes, rules, tables and paragraphs: what a summary uses. */
export function markdownToHtml(md: string): { html: string; toc: { id: string; title: string; level: number }[] } {
  const out: string[] = [];
  const toc: { id: string; title: string; level: number }[] = [];
  const lines = md.replace(/\r\n?/g, "\n").split("\n");
  let para: string[] = [];
  let list: { tag: "ul" | "ol"; items: string[] } | undefined;
  let quote: string[] = [];
  const flush = () => {
    if (para.length) out.push(`<p>${inline(para.join(" "))}</p>`);
    para = [];
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join("")}</${list.tag}>`);
    list = undefined;
    // A quote holds Markdown of its own: the "In short" box is a list in a quote.
    if (quote.length) out.push(`<blockquote>${markdownToHtml(quote.join("\n")).html}</blockquote>`);
    quote = [];
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const h = /^(#{1,4})\s+(.*)$/.exec(line);
    const li = /^\s*(?:([-*+])|(\d+)[.)])\s+(.*)$/.exec(line);
    if (!line.trim()) flush();
    else if (h) {
      flush();
      const level = h[1]!.length;
      const id = `s${toc.length + 1}`;
      toc.push({ id, title: h[2]!.replace(/\[[^\]]*\]/g, "").trim(), level });
      out.push(`<h${level + 1} id="${id}">${inline(h[2]!)}</h${level + 1}>`);
    } else if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      flush();
      out.push("<hr>");
    } else if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) {
      flush();
      const cells = (l: string) =>
        l
          .trim()
          .replace(/^\||\|$/g, "")
          .split("|")
          .map((c) => c.trim());
      const head = cells(line);
      i++;
      const rows: string[][] = [];
      while (i + 1 < lines.length && /^\s*\|.*\|\s*$/.test(lines[i + 1]!)) rows.push(cells(lines[++i]!));
      out.push(
        `<table><thead><tr>${head.map((c) => `<th>${inline(c)}</th>`).join("")}</tr></thead><tbody>${rows
          .map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join("")}</tr>`)
          .join("")}</tbody></table>`,
      );
    } else if (/^\s*>/.test(line)) {
      if (para.length || list) flush();
      quote.push(line.replace(/^\s*>\s?/, ""));
    } else if (li) {
      const tag = li[1] ? "ul" : "ol";
      if (para.length || quote.length || (list && list.tag !== tag)) flush();
      list ??= { tag, items: [] };
      list.items.push(li[3]!);
    } else if (list && /^\s+\S/.test(line)) list.items[list.items.length - 1] += ` ${line.trim()}`;
    else {
      if (list || quote.length) flush();
      para.push(line.trim());
    }
  }
  flush();
  return { html: out.join("\n"), toc };
}

function readFrames(runDir: string): Frame[] {
  try {
    const raw = JSON.parse(readFileSync(join(runDir, "frames.json"), "utf8")) as Frame[];
    return Array.isArray(raw) ? raw.filter((f) => typeof f.file === "string" && Number.isFinite(f.time)) : [];
  } catch {
    return [];
  }
}

/** A path the page can load: relative to where the page is written, else a file:// URL. */
function href(target: string, pageDir: string): string {
  const rel = relative(pageDir, target);
  if (!rel.startsWith("..") && !isAbsolute(rel)) return rel.split(sep).map(encodeURIComponent).join("/");
  return pathToFileURL(target).href;
}

function player(meta: { id: string; site?: string; webpageUrl: string; file?: unknown }, pageDir: string, L: Labels): { html: string; kind: string } {
  const file = typeof meta.file === "string" && existsSync(meta.file) ? meta.file : undefined;
  const yt = /[?&]v=([A-Za-z0-9_-]{11})/.exec(meta.webpageUrl)?.[1];
  if (file)
    return {
      kind: "video",
      html: `<video id="player" controls preload="metadata" src="${esc(href(file, pageDir))}"></video>${
        yt ? `<p class="fallback">${L.noPlay} <a href="${esc(meta.webpageUrl)}" target="_blank" rel="noopener">${L.onSite}</a></p>` : ""
      }`,
    };
  if (yt)
    return {
      kind: "youtube",
      html: `<div class="frame"><iframe id="player" data-yt="${yt}" src="https://www.youtube-nocookie.com/embed/${yt}" title="YouTube" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe></div>`,
    };
  return { kind: "link", html: `<p><a id="player" href="${esc(meta.webpageUrl)}" target="_blank" rel="noopener">${L.open}</a></p>` };
}

export interface HtmlOptions {
  /** The summary (or any answer) as Markdown, citing [V1 mm:ss]. */
  summary?: string;
  /** Where the page will be written: relative links (frames, the file) are computed from it. */
  to: string;
  /** The page's language (its labels): else the run's --lang, else the video's. */
  lang?: string;
}

/** The page for one run directory, or a reason it cannot be made. */
export function runHtml(runDir: string, opts: HtmlOptions): { html: string } | { error: string } {
  const run = readVideoRun(runDir);
  if (!run) return { error: `no video run in ${runDir} — fetch the video first` };
  const meta = run.meta as typeof run.meta & { file?: unknown; via?: string };
  const segments: VideoSegment[] = run.segments;
  const pageDir = dirname(opts.to);
  const frames = readFrames(runDir);
  const chapters = [...(meta.chapters ?? [])].sort((a, b) => a.start - b.start);
  const lang = (opts.lang ?? (meta as { lang?: string }).lang ?? meta.language ?? "en").toLowerCase().split(/[-_]/)[0]!;
  const L: Labels = lang === "fr" ? LABELS.fr : LABELS.en;
  const p = player(meta, pageDir, L);
  // The page's header already carries the title: a summary's leading `# Title` would repeat it.
  const summary = opts.summary ? markdownToHtml(opts.summary.replace(/^\s*#\s[^\n]*\n/, "")) : undefined;

  const overview = overviewHtml({ duration: meta.duration ?? Math.max(0, ...segments.map((s) => s.end)), segments, chapters, summary: opts.summary }, L);

  const facts = [
    meta.channel,
    meta.uploadDate,
    meta.duration !== undefined ? formatStamp(meta.duration) : undefined,
    meta.via === "whisper" ? L.whisper : meta.via,
  ].filter(Boolean);

  // Transcript: a chapter heading where one starts, a frame where one falls.
  const body: string[] = [];
  let c = -1;
  let f = 0;
  for (const s of segments) {
    while (c + 1 < chapters.length && chapters[c + 1]!.start <= s.start + 0.5) {
      c++;
      body.push(`<h3 class="chapter" id="c${c}">${seek(chapters[c]!.start, formatStamp(chapters[c]!.start))} ${esc(chapters[c]!.title)}</h3>`);
    }
    const shots: string[] = [];
    while (f < frames.length && frames[f]!.time < s.end + 0.5) {
      const fr = frames[f++]!;
      shots.push(
        `<figure>${seek(fr.time, fr.stamp)}<img loading="lazy" src="${esc(href(join(runDir, fr.file), pageDir))}" alt="${L.at} ${fr.stamp}"></figure>`,
      );
    }
    body.push(
      `<p class="seg" data-start="${s.start}" data-end="${s.end}">${seek(s.start, formatStamp(s.start))} <span>${esc(s.text)}</span></p>${
        shots.length ? `<div class="shots">${shots.join("")}</div>` : ""
      }`,
    );
  }

  const nav = [
    summary?.toc.length
      ? `<h2>${L.summary}</h2><ol class="toc">${summary.toc
          .filter((t) => t.level <= 2)
          .map((t) => `<li><a href="#${t.id}">${esc(t.title)}</a></li>`)
          .join("")}</ol>`
      : "",
    chapters.length
      ? `<h2>${L.chapters}</h2><ol class="toc">${chapters.map((ch, i) => `<li>${seek(ch.start, formatStamp(ch.start))} <a href="#c${i}">${esc(ch.title)}</a></li>`).join("")}</ol>`
      : "",
    frames.length
      ? `<h2>${L.frames} (${frames.length})</h2><div class="thumbs">${frames
          .map(
            (fr) =>
              `<button type="button" class="stamp thumb" data-t="${Math.floor(fr.time)}" title="${fr.stamp}"><img loading="lazy" src="${esc(href(join(runDir, fr.file), pageDir))}" alt="${fr.stamp}"></button>`,
          )
          .join("")}</div>`
      : "",
  ].join("");

  const html = `<!DOCTYPE html>
<html lang="${esc(lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="generator" content="ultrawatch">
<title>${esc(meta.title)}</title>
<style>${CSS}${OVERVIEW_CSS}</style>
</head>
<body data-duration="${meta.duration ?? ""}" data-player="${p.kind}" data-page="${esc(meta.webpageUrl)}" data-passage="${L.passage}" data-passages="${L.passages}">
<header class="top">
  <h1>${esc(meta.title)}</h1>
  <p class="facts">${facts.map((x) => esc(String(x))).join(" · ")} · <a href="${esc(meta.webpageUrl)}" target="_blank" rel="noopener">${L.source}</a></p>
</header>
<div class="layout">
  <aside class="side">
    <div class="player">${p.html}</div>
    <nav>${nav}</nav>
  </aside>
  <main>
    ${overview}
    ${summary ? `<section class="summary"><h2 class="kicker">${L.summary}</h2>${summary.html}</section>` : ""}
    <section class="transcript">
      <div class="tbar"><h2 class="kicker">${L.transcript}</h2><input id="q" type="search" placeholder="${L.search}" aria-label="${L.searchAria}"><label><input id="follow" type="checkbox" checked> ${L.follow}</label><span id="count"></span></div>
      ${body.join("\n")}
    </section>
  </main>
</div>
<script>${SCRIPT}</script>
<script>${OVERVIEW_SCRIPT}</script>
</body>
</html>
`;
  return { html };
}

const SCRIPT = `(() => {
const kind = document.body.dataset.player;
const player = document.getElementById("player");
const page = document.body.dataset.page;
const segs = [...document.querySelectorAll(".seg")];
const follow = document.getElementById("follow");
function go(t) {
  if (kind === "video") { player.currentTime = t; player.play().catch(() => {}); }
  else if (kind === "youtube") { player.src = "https://www.youtube-nocookie.com/embed/" + player.dataset.yt + "?start=" + t + "&autoplay=1"; }
  else { const u = new URL(page); u.searchParams.set("t", t + "s"); window.open(u, "_blank", "noopener"); }
  mark(t, true);
}
document.addEventListener("click", (e) => {
  const b = e.target.closest(".stamp, .stamp-like");
  if (b) { e.preventDefault(); go(Number(b.dataset.t)); }
});
let current;
function mark(t, scroll) {
  const s = segs.findLast ? segs.findLast((x) => Number(x.dataset.start) <= t + 0.5) : segs.filter((x) => Number(x.dataset.start) <= t + 0.5).pop();
  if (!s || s === current) return;
  current?.classList.remove("now");
  s.classList.add("now");
  current = s;
  if (scroll && follow.checked && !document.getElementById("q").value) s.scrollIntoView({ block: "center", behavior: "smooth" });
}
if (kind === "video") player.addEventListener("timeupdate", () => mark(player.currentTime, true));
const q = document.getElementById("q");
const count = document.getElementById("count");
const fold = (s) => s.normalize("NFD").replace(/[\\u0300-\\u036f]/g, "").toLowerCase();
q.addEventListener("input", () => {
  const v = fold(q.value.trim());
  let n = 0;
  for (const s of segs) {
    const hit = !v || fold(s.textContent).includes(v);
    s.hidden = !hit;
    if (s.nextElementSibling?.classList.contains("shots")) s.nextElementSibling.hidden = !hit;
    if (hit && v) n++;
  }
  document.querySelectorAll(".chapter").forEach((h) => (h.hidden = !!v));
  count.textContent = v ? n + " " + (n === 1 ? document.body.dataset.passage : document.body.dataset.passages) : "";
});
})();`;

const CSS = `
:root{--bg:#fbfaf7;--fg:#1d1c1a;--muted:#6b675f;--line:#e4e0d8;--accent:#b4441b;--soft:#f3efe6;--now:#fff1c2;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--fg:#ebe7df;--muted:#a19b90;--line:#2d2b27;--accent:#ef8a5b;--soft:#201f1c;--now:#3a3218}}
*{box-sizing:border-box}
html{scroll-padding-top:5rem}
body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}
.top{padding:1.5rem clamp(1rem,3vw,2.5rem) 1rem;border-bottom:1px solid var(--line)}
h1{font-size:clamp(1.3rem,2.4vw,1.9rem);line-height:1.25;margin:0 0 .35rem;max-width:60ch;text-wrap:balance}
.facts{margin:0;color:var(--muted);font-size:.9rem}
.layout{display:grid;grid-template-columns:minmax(320px,38%) 1fr;gap:clamp(1rem,3vw,2.5rem);padding:1.25rem clamp(1rem,3vw,2.5rem) 4rem}
.side{position:sticky;top:1rem;align-self:start;max-height:calc(100vh - 2rem);overflow:auto;padding-right:.25rem}
video,.frame{width:100%;border-radius:8px;background:#000;display:block}
.frame{aspect-ratio:16/9}.frame iframe{width:100%;height:100%;border:0;border-radius:8px}
.fallback{font-size:.8rem;color:var(--muted);margin:.35rem 0 0}
nav h2,.kicker{font-size:.75rem;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:1.5rem 0 .5rem;font-weight:600}
.toc{margin:0;padding-left:2rem;font-size:.92rem}.toc li{margin:.2rem 0}
.toc a{color:var(--fg);text-decoration:none}.toc a:hover{color:var(--accent)}
.thumbs{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:.4rem}
.thumb{padding:0;border:0;background:none;cursor:pointer;border-radius:4px;overflow:hidden}
.thumb img{width:100%;display:block;aspect-ratio:16/9;object-fit:cover;transition:opacity .15s}.thumb:hover img{opacity:.75}
main{min-width:0;max-width:75ch}
.summary{border-bottom:1px solid var(--line);padding-bottom:1.5rem;margin-bottom:1rem}
.summary h2,.summary h3,.summary h4{line-height:1.3;margin:1.6rem 0 .5rem;text-wrap:balance}
.summary h2{font-size:1.3rem}.summary h3{font-size:1.1rem}.summary h4{font-size:1rem}
.summary li{margin:.35rem 0}
blockquote{margin:1.25rem 0;padding:.5rem 1rem;border-left:3px solid var(--accent);background:var(--soft);border-radius:0 6px 6px 0}blockquote>:first-child{margin-top:0}blockquote>:last-child{margin-bottom:0}
table{border-collapse:collapse;width:100%;font-size:.92rem;margin:1rem 0}th,td{border-bottom:1px solid var(--line);padding:.4rem .5rem;text-align:left;vertical-align:top}
code{background:var(--soft);padding:.05rem .3rem;border-radius:3px;font-size:.88em}
hr{border:0;border-top:1px solid var(--line);margin:1.5rem 0}
.cite{white-space:nowrap}
.stamp{font:600 .78rem/1 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--accent);background:var(--soft);border:1px solid var(--line);border-radius:4px;padding:.18rem .35rem;cursor:pointer;vertical-align:.08em}
.stamp:hover{border-color:var(--accent)}.stamp:focus-visible,.thumb:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tbar{position:sticky;top:0;z-index:1;background:var(--bg);display:flex;flex-wrap:wrap;align-items:center;gap:.5rem 1rem;padding:.5rem 0;border-bottom:1px solid var(--line)}
.tbar .kicker{margin:0}
#q{flex:1;min-width:12rem;font:inherit;padding:.4rem .6rem;border:1px solid var(--line);border-radius:6px;background:var(--soft);color:var(--fg)}
.tbar label,#count{font-size:.85rem;color:var(--muted)}
.chapter{font-size:1.05rem;margin:1.75rem 0 .5rem}
.seg{margin:.5rem 0;padding:.35rem .5rem;border-radius:6px;transition:background .2s}
.seg.now{background:var(--now)}
.shots{display:flex;gap:.5rem;overflow-x:auto;margin:.25rem 0 .75rem .5rem}
.shots figure{margin:0;flex:0 0 min(320px,80%);position:relative}
.shots img{width:100%;border-radius:6px;display:block}
.shots .stamp{position:absolute;top:.4rem;left:.4rem}
@media (max-width:860px){.layout{grid-template-columns:1fr}.side{position:static;max-height:none}}
@media (prefers-reduced-motion:reduce){*{transition:none!important;scroll-behavior:auto!important}}
`;
