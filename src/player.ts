// The page's player: the local file, the YouTube embed, or both with a switch;
// a speed control; and one time signal (`uw:time` on document) the transcript
// and the overview follow, whichever source plays. YouTube is driven through
// its embed's postMessage protocol, so no script is loaded from it. YouTube
// refuses to play in a page opened from disk (error 153): there, the page says
// so and points to `ultrawatch serve`, instead of showing a broken player.

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export const SPEEDS = [1, 1.25, 1.5, 2, 2.5, 3];
/** YouTube's own ceiling: faster steps are only offered for the local file. */
export const YOUTUBE_MAX_SPEED = 2;

export interface PlayerLabels {
  local: string;
  youtube: string;
  speed: string;
  sourceGroup: string;
  open: string;
  onSite: string;
  ytFromDisk: string;
  ytMax: string;
  decimal: string;
}

export function playerHtml(o: { file?: string; youtubeId?: string; pageUrl: string }, L: PlayerLabels): { html: string; kind: string } {
  const { file, youtubeId: yt } = o;
  if (!file && !yt) return { kind: "link", html: `<p><a id="player" href="${esc(o.pageUrl)}" target="_blank" rel="noopener">${esc(L.open)}</a></p>` };
  const kind = file ? "video" : "youtube";
  const speed = (r: number) => `${String(r).replace(".", L.decimal)}×`;
  const sources =
    file && yt
      ? `<div class="seg-ctl" role="group" aria-label="${esc(L.sourceGroup)}"><button type="button" data-src="file" aria-pressed="true">${esc(L.local)}</button><button type="button" data-src="youtube" aria-pressed="false">${esc(L.youtube)}</button></div>`
      : "";
  const speeds = `<div class="seg-ctl speed" role="group" aria-label="${esc(L.speed)}"><span>${esc(L.speed)}</span>${SPEEDS.map(
    (r) =>
      `<button type="button" data-rate="${r}" aria-pressed="${r === 1}"${r > YOUTUBE_MAX_SPEED ? ` data-title="${esc(L.ytMax)}"` : ""}>${speed(r)}</button>`,
  ).join("")}</div>`;
  const html = `<div class="uwp" data-kind="${kind}"${yt ? ` data-yt="${yt}"` : ""} data-page="${esc(o.pageUrl)}">
<div class="screen">${file ? `<video id="video" controls preload="metadata" src="${esc(file)}"></video>` : ""}${
    yt
      ? `<div class="frame" id="ytbox"${file ? " hidden" : ""}></div><p class="ytnote" hidden>${L.ytFromDisk} <a href="${esc(o.pageUrl)}" target="_blank" rel="noopener">${esc(L.onSite)}</a></p>`
      : ""
  }</div>
<div class="pbar">${sources}${speeds}</div>
</div>`;
  return { kind, html };
}

export const PLAYER_CSS = `
.uwp .screen{position:relative}
.uwp [hidden]{display:none!important}
.uwp video,.uwp .frame{width:100%;border-radius:8px;background:#000;display:block}
.uwp .frame{aspect-ratio:16/9}.uwp .frame iframe{width:100%;height:100%;border:0;border-radius:8px;display:block}
.ytnote{aspect-ratio:16/9;margin:0;display:flex;flex-direction:column;justify-content:center;gap:.5rem;padding:1.5rem;border-radius:8px;background:var(--soft);font-size:.9rem;line-height:1.5}
.ytnote[hidden]{display:none}
.ytnote code{font-size:.85em}
.pbar{display:flex;flex-wrap:wrap;gap:.5rem 1rem;align-items:center;justify-content:space-between;margin-top:.5rem}
.seg-ctl{display:inline-flex;align-items:center;gap:2px;font-size:.8rem}
.seg-ctl span{color:var(--muted);margin-right:.35rem}
.seg-ctl button{font:inherit;font-variant-numeric:tabular-nums;color:var(--fg);background:var(--soft);border:1px solid var(--line);padding:.22rem .5rem;cursor:pointer}
.seg-ctl button:first-of-type{border-radius:6px 0 0 6px}.seg-ctl button:last-of-type{border-radius:0 6px 6px 0}
.seg-ctl button[aria-pressed="true"]{background:var(--accent);border-color:var(--accent);color:var(--bg)}
.seg-ctl button:disabled{opacity:.4;cursor:not-allowed}
.seg-ctl button:focus-visible{outline:2px solid var(--accent);outline-offset:1px}
`;

export const PLAYER_SCRIPT = `(() => {
const box = document.querySelector(".uwp");
const link = document.getElementById("player");
const pageUrl = box ? box.dataset.page : link ? link.href : "";
const at = (t) => { try { const u = new URL(pageUrl); u.searchParams.set("t", Math.floor(t) + "s"); return u.toString(); } catch { return pageUrl; } };
const store = { get: (k) => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };
const emit = (t) => document.dispatchEvent(new CustomEvent("uw:time", { detail: t }));
if (!box) { window.uwPlayer = { seek: (t) => window.open(at(t), "_blank", "noopener"), time: () => 0 }; return; }
const video = document.getElementById("video");
const ytBox = document.getElementById("ytbox");
const note = box.querySelector(".ytnote");
const yt = box.dataset.yt;
const fromDisk = location.protocol === "file:";
const rates = [...box.querySelectorAll("[data-rate]")];
const srcs = [...box.querySelectorAll("[data-src]")];
let mode = video ? (yt && store.get("uw:src") === "youtube" ? "youtube" : "file") : "youtube";
let rate = Number(store.get("uw:rate")) || 1;
let iframe, ready = false, ytTime = 0, pending = null;
const send = (func, args = []) => iframe && iframe.contentWindow && iframe.contentWindow.postMessage(JSON.stringify({ event: "command", func, args, id: 1, channel: "widget" }), "*");
function mount(start) {
  if (fromDisk) { ytBox.hidden = true; note.hidden = false; return; }
  note.hidden = true; ytBox.hidden = false;
  if (iframe) return;
  iframe = document.createElement("iframe");
  iframe.title = "YouTube";
  iframe.allow = "autoplay; encrypted-media; picture-in-picture; fullscreen";
  iframe.src = "https://www.youtube-nocookie.com/embed/" + yt + "?enablejsapi=1&playsinline=1&rel=0&origin=" + encodeURIComponent(location.origin) + (start ? "&start=" + Math.floor(start) : "");
  iframe.addEventListener("load", () => iframe.contentWindow.postMessage(JSON.stringify({ event: "listening", id: 1, channel: "widget" }), "*"));
  ytBox.append(iframe);
}
window.addEventListener("message", (e) => {
  if (!iframe || e.source !== iframe.contentWindow) return;
  let d; try { d = typeof e.data === "string" ? JSON.parse(e.data) : e.data; } catch { return; }
  if (!d) return;
  if (!ready && (d.event === "onReady" || d.event === "initialDelivery")) {
    ready = true;
    send("setPlaybackRate", [Math.min(rate, ${YOUTUBE_MAX_SPEED})]);
    if (pending !== null) { send("seekTo", [pending, true]); send("playVideo"); pending = null; }
  }
  if (d.info && typeof d.info.currentTime === "number") { ytTime = d.info.currentTime; if (mode === "youtube") emit(ytTime); }
});
if (video) video.addEventListener("timeupdate", () => { if (mode === "file") emit(video.currentTime); });
function paint() {
  srcs.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.src === mode)));
  rates.forEach((b) => {
    const r = Number(b.dataset.rate), off = mode === "youtube" && r > ${YOUTUBE_MAX_SPEED};
    b.disabled = off; b.title = off ? b.dataset.title || "" : "";
    b.setAttribute("aria-pressed", String(r === (mode === "youtube" ? Math.min(rate, ${YOUTUBE_MAX_SPEED}) : rate)));
  });
}
function setRate(r) {
  rate = r; store.set("uw:rate", String(r));
  if (video) video.playbackRate = r;
  if (ready) send("setPlaybackRate", [Math.min(r, ${YOUTUBE_MAX_SPEED})]);
  paint();
}
function setMode(m) {
  if (m === mode) return;
  const t = time();
  mode = m; store.set("uw:src", m);
  if (m === "youtube") { if (video) { video.pause(); video.hidden = true; } pending = t; mount(t); if (ready) { send("seekTo", [t, true]); pending = null; } }
  else { send("pauseVideo"); ytBox.hidden = true; note.hidden = true; video.hidden = false; video.currentTime = t; }
  paint();
}
function time() { return mode === "youtube" ? ytTime : video ? video.currentTime : 0; }
function seek(t) {
  if (mode === "file") { video.currentTime = t; video.play().catch(() => {}); }
  else if (fromDisk) { window.open(at(t), "_blank", "noopener"); }
  else if (ready) { send("seekTo", [t, true]); send("playVideo"); }
  else { pending = t; mount(t); }
  emit(t);
}
box.addEventListener("click", (e) => {
  const r = e.target.closest("[data-rate]"); if (r && !r.disabled) setRate(Number(r.dataset.rate));
  const s = e.target.closest("[data-src]"); if (s) setMode(s.dataset.src);
});
if (video) { video.playbackRate = rate; video.addEventListener("ratechange", () => { if (video.playbackRate !== rate) { rate = video.playbackRate; store.set("uw:rate", String(rate)); paint(); } }); }
if (mode === "youtube") { if (video) video.hidden = true; mount(0); }
paint();
window.uwPlayer = { seek, time };
})();`;
