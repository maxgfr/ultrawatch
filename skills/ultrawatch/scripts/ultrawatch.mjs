#!/usr/bin/env node

// src/cli.ts
import { existsSync as existsSync5, readFileSync as readFileSync7, realpathSync } from "fs";
import { join as join7, resolve as resolve2 } from "path";
import { pathToFileURL } from "url";

// src/check.ts
import { existsSync, readFileSync as readFileSync2 } from "fs";
import { join } from "path";

// src/vendor/webindex-engine.mjs
import { spawn, spawnSync } from "child_process";
import { readdirSync, readFileSync } from "fs";
import { mkdtempSync as mkdtempSync2, readdirSync as readdirSync2, readFileSync as readFileSync3, rmSync as rmSync2, writeFileSync as writeFileSync2 } from "fs";
import { tmpdir as tmpdir2 } from "os";
import { join as join2 } from "path";
import { spawn as spawn3, spawnSync as spawnSync2 } from "child_process";
import { existsSync as existsSync2, readFileSync as readFileSync4, writeFileSync as writeFileSync3 } from "fs";
import { join as join3 } from "path";
import { existsSync as existsSync3, readdirSync as readdirSync3, readFileSync as readFileSync5, statSync } from "fs";
import { tmpdir as tmpdir3 } from "os";
import { join as join4, resolve } from "path";
import { mkdirSync, renameSync, unlinkSync, writeFileSync as writeFileSync4 } from "fs";
import { copyFileSync, cpSync, existsSync as existsSync4, mkdirSync as mkdirSync2, readdirSync as readdirSync4, readFileSync as readFileSync6, renameSync as renameSync2, rmSync as rmSync3 } from "fs";
import { join as join5 } from "path";
import { join as join6 } from "path";
import { promisify } from "util";
import { gunzip } from "zlib";
import { basename as basename2 } from "path";
var ENGINE_VERSION = "1.25.0";
var DEFAULT_BRAND = {
  name: "webindex",
  envPrefix: "WEBINDEX",
  cli: "webindex",
  contactUrl: "https://github.com/maxgfr/webindex"
};
var current = { ...DEFAULT_BRAND };
function configure(next) {
  if (!next.envPrefix || !/^[A-Z][A-Z0-9_]*$/.test(next.envPrefix)) {
    throw new Error(`webindex: envPrefix must be UPPER_SNAKE, got ${JSON.stringify(next.envPrefix)}`);
  }
  if (!next.name || !next.cli) {
    throw new Error("webindex: configure() requires both `name` and `cli`");
  }
  current = { ...next };
}
function brand() {
  return current;
}
function envName(suffix) {
  return `${current.envPrefix}_${suffix}`;
}
function env(suffix) {
  const raw = process.env[envName(suffix)];
  if (typeof raw !== "string") return void 0;
  const trimmed = raw.trim();
  return trimmed ? trimmed : void 0;
}
function envFlag(suffix) {
  const v = env(suffix);
  if (v === void 0) return false;
  const lower = v.toLowerCase();
  return lower !== "0" && lower !== "false" && lower !== "no" && lower !== "off";
}
function envInt(suffix, def, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const raw = env(suffix);
  if (raw === void 0) return def;
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, Math.trunc(n)));
}
var MAX_STREAM_BYTES = 32 * 1024 * 1024;
var MAX_TOTAL_BYTES = 128 * 1024 * 1024;
function addChild(tree, parent, child) {
  const siblings = tree.get(parent);
  if (siblings) siblings.push(child);
  else tree.set(parent, [child]);
}
function treeFromProc() {
  let entries;
  try {
    entries = readdirSync("/proc");
  } catch {
    return void 0;
  }
  const tree = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    if (!/^\d+$/.test(entry)) continue;
    let stat;
    try {
      stat = readFileSync(`/proc/${entry}/stat`, "latin1");
    } catch {
      continue;
    }
    const ppid = Number(stat.slice(stat.lastIndexOf(")") + 2).split(" ")[1]);
    if (ppid > 0) addChild(tree, ppid, Number(entry));
  }
  return tree;
}
function treeFromPs() {
  const r = spawnSync("ps", ["-A", "-o", "pid=,ppid="], { encoding: "utf8", timeout: 5e3 });
  if (r.status !== 0 || !r.stdout) return void 0;
  const tree = /* @__PURE__ */ new Map();
  for (const line of r.stdout.split("\n")) {
    const [pid, ppid] = line.trim().split(/\s+/).map(Number);
    if (pid && ppid) addChild(tree, ppid, pid);
  }
  return tree;
}
function descendants(pid) {
  const tree = (process.platform === "linux" ? treeFromProc() : void 0) ?? treeFromPs();
  if (!tree) return [];
  const found = /* @__PURE__ */ new Set();
  const queue = [pid];
  while (queue.length) {
    for (const child of tree.get(queue.shift()) ?? []) {
      if (found.has(child) || child === pid) continue;
      found.add(child);
      queue.push(child);
    }
  }
  return [...found];
}
function killTree(child) {
  try {
    if (process.platform === "win32" && child.pid) {
      spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => child.kill("SIGKILL"));
    } else {
      const pids = child.pid ? descendants(child.pid) : [];
      child.kill("SIGKILL");
      for (const pid of pids) {
        try {
          process.kill(pid, "SIGKILL");
        } catch {
        }
      }
    }
  } catch {
    child.kill("SIGKILL");
  }
  child.stdin?.destroy();
  child.stdout?.destroy();
  child.stderr?.destroy();
  child.unref();
}
var MAX_STDOUT_BYTES = 24 * 1024 * 1024;
var warnedEngineValues = /* @__PURE__ */ new Set();
function enginesFromEnv(name, known) {
  const raw = env(name)?.trim();
  if (!raw) return void 0;
  const asked = raw.toLowerCase().split(",").map((s) => s.trim()).filter(Boolean);
  if (asked.length === 1 && asked[0] === "none") return [];
  const picked = [...new Set(asked.filter((s) => known.includes(s)))];
  const unknown = asked.filter((s) => !known.includes(s));
  if (unknown.length && !warnedEngineValues.has(`${name}=${raw}`)) {
    warnedEngineValues.add(`${name}=${raw}`);
    const fallback = picked.length ? "" : " \u2014 using the full ladder";
    process.emitWarning(`${envName(name)}: ignoring unknown rung ${unknown.map((u) => `"${u}"`).join(", ")} (known: ${known.join(", ")}, or none)${fallback}`);
  }
  return picked.length ? picked : void 0;
}
var BINARY = { textFallback: false };
var CSV = { format: "csv", textFallback: true };
var BY_EXTENSION = {
  // Word
  doc: BINARY,
  docx: BINARY,
  docm: BINARY,
  odt: BINARY,
  rtf: BINARY,
  // PowerPoint
  ppt: BINARY,
  pps: BINARY,
  pot: BINARY,
  pptx: BINARY,
  pptm: BINARY,
  ppsx: BINARY,
  ppsm: BINARY,
  odp: BINARY,
  // Excel
  xls: BINARY,
  xlsx: BINARY,
  xlsm: BINARY,
  xlsb: BINARY,
  ods: BINARY,
  // Everything else the converter reads
  epub: BINARY,
  csv: CSV
};
var DOC_EXTENSIONS = Object.keys(BY_EXTENSION);
var OLE_SIGNATURE = Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]);
var MAX_ENTRY_BYTES = 64 * 1024 * 1024;
var MAX_TOTAL_BYTES2 = 256 * 1024 * 1024;
var MAX_OUTPUT_CHARS = 24 * 1024 * 1024;
var EXCEL_EPOCH = Date.UTC(1899, 11, 30);
var OLE_SIGNATURE2 = Buffer.from([208, 207, 17, 224, 161, 177, 26, 225]);
var VIDEO_ID = /^[A-Za-z0-9_-]{11}$/;
var YOUTUBE_HOSTS = ["youtube.com", "youtube-nocookie.com"];
function parse(url) {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u : void 0;
  } catch {
    return void 0;
  }
}
function isYoutubeHost(host) {
  const h = host.toLowerCase();
  return YOUTUBE_HOSTS.some((d) => h === d || h.endsWith(`.${d}`));
}
function youtubeVideoId(url) {
  const u = parse(url);
  if (!u) return void 0;
  const host = u.hostname.toLowerCase();
  let id;
  if (host === "youtu.be" || host === "www.youtu.be") id = u.pathname.split("/")[1];
  else if (isYoutubeHost(host)) {
    if (u.pathname === "/watch") id = u.searchParams.get("v") ?? void 0;
    else id = /^\/(?:shorts|embed|live|v)\/([^/]+)/.exec(u.pathname)?.[1];
  }
  return id && VIDEO_ID.test(id) ? id : void 0;
}
function youtubeListKind(url) {
  const u = parse(url);
  if (!u || !isYoutubeHost(u.hostname)) return void 0;
  if (u.searchParams.get("list")) return "playlist";
  if (/^\/(?:@[^/]+|channel\/[^/]+|c\/[^/]+|user\/[^/]+)/.test(u.pathname)) return "channel";
  return void 0;
}
var STDOUT_CAP = 24 * 1024 * 1024;
var defaultTimeoutMs = () => envInt("SH_TIMEOUT_MS", 6e4, 1e3);
function toResult(status, stdout, stderr, err) {
  const missing = err?.code === "ENOENT";
  return {
    ok: !missing && status === 0,
    status: status ?? (missing ? 127 : 1),
    stdout,
    stderr: stderr || (err ? err.message : ""),
    ...missing ? { missing: true } : {}
  };
}
var havePresence = /* @__PURE__ */ new Map();
function have(cmd) {
  let hit = havePresence.get(cmd);
  if (hit === void 0) {
    const probe = spawnSync2(process.platform === "win32" ? "where" : "which", [cmd], { encoding: "utf8" });
    hit = probe.status === 0 && (probe.stdout ?? "").trim().length > 0;
    havePresence.set(cmd, hit);
  }
  return hit;
}
function shAsync(cmd, args, opts = {}) {
  const timeoutMs = opts.timeoutMs ?? defaultTimeoutMs();
  if (opts.signal?.aborted) return Promise.resolve({ ok: false, status: 130, stdout: "", stderr: "aborted" });
  return new Promise((resolve7) => {
    let settled = false;
    let timer;
    let onAbort;
    const done = (r) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (onAbort) opts.signal?.removeEventListener("abort", onAbort);
      resolve7(r);
    };
    let child;
    try {
      child = spawn3(cmd, args, { cwd: opts.cwd, env: opts.env ?? process.env, stdio: ["ignore", "pipe", "pipe"] });
    } catch (e) {
      done({ ok: false, status: 1, stdout: "", stderr: e.message });
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (d) => {
      if (stdout.length < STDOUT_CAP) stdout += d;
    });
    child.stderr?.on("data", (d) => {
      if (stderr.length < STDOUT_CAP) stderr += d;
    });
    timer = setTimeout(() => {
      killTree(child);
      done({ ok: false, status: 124, stdout, stderr: stderr || `timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    if (opts.signal) {
      onAbort = () => {
        killTree(child);
        done({ ok: false, status: 130, stdout, stderr: "aborted" });
      };
      opts.signal.addEventListener("abort", onAbort, { once: true });
    }
    child.on("error", (e) => done(toResult(null, stdout, stderr, e)));
    child.on("close", (code) => done(toResult(code, stdout, stderr)));
  });
}
var defaultVideoRunner = (cmd, args, opts) => shAsync(cmd, args, opts);
var PROBE_TIMEOUT_MS = 12e4;
var SUBTITLE_TIMEOUT_MS = 12e4;
function ytdlpExtraArgs() {
  return (env("YTDLP_ARGS") ?? "").split(/\s+/).filter(Boolean);
}
function runYtdlp(args, opts = {}) {
  const argv = [...args, ...ytdlpExtraArgs(), ...opts.url ? ["--", opts.url] : []];
  return (opts.run ?? defaultVideoRunner)("yt-dlp", argv, { timeoutMs: opts.timeoutMs ?? PROBE_TIMEOUT_MS, signal: opts.signal });
}
var str = (v) => typeof v === "string" && v.trim() ? v.trim() : void 0;
var num = (v) => typeof v === "number" && Number.isFinite(v) ? v : void 0;
function videoMetaFromInfo(info) {
  const id = str(info.id);
  if (!id) return void 0;
  const date = str(info.upload_date);
  const tracks = (v) => v && typeof v === "object" ? Object.keys(v).filter((k) => k !== "live_chat") : [];
  const duration = num(info.duration);
  const chapters = Array.isArray(info.chapters) ? info.chapters.map((c) => ({
    start: num(c.start_time) ?? 0,
    end: num(c.end_time) ?? duration ?? 0,
    title: (str(c.title) ?? "").replace(/^<Untitled Chapter (\d+)>$/, "Chapter $1")
  })).filter((c) => c.title) : [];
  return {
    id,
    title: str(info.title) ?? id,
    channel: str(info.channel) ?? str(info.uploader),
    uploadDate: date && /^\d{8}$/.test(date) ? `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6)}` : void 0,
    duration,
    language: str(info.language),
    chapters,
    subtitles: tracks(info.subtitles),
    autoCaptions: tracks(info.automatic_captions),
    webpageUrl: str(info.webpage_url) ?? `https://www.youtube.com/watch?v=${id}`,
    ...info.live_status === "is_live" || info.is_live === true ? { live: "live" } : {},
    ...info.live_status === "is_upcoming" ? { live: "upcoming" } : {}
  };
}
async function probeVideo(url, run2 = defaultVideoRunner, signal) {
  const r = await runYtdlp(["-J", "--skip-download", "--no-playlist", "--no-warnings"], { run: run2, url, signal });
  if (signal?.aborted) return { error: "cancelled" };
  if (r.missing) return { error: "install yt-dlp (https://github.com/yt-dlp/yt-dlp) to read videos", missing: true };
  if (!r.ok) return { error: classifyYtdlpError(r.stderr) };
  try {
    const meta = videoMetaFromInfo(JSON.parse(r.stdout));
    return meta ? { meta, info: r.stdout } : { error: "yt-dlp returned no video for this URL" };
  } catch {
    return { error: "yt-dlp returned unreadable metadata" };
  }
}
function classifyYtdlpError(stderr) {
  const s = stderr || "";
  const unblock = `update yt-dlp (\`${brand().cli} doctor\` shows how old it is) or set ${envName("YTDLP_ARGS")}="--cookies-from-browser firefox"`;
  if (/private video/i.test(s)) return "private video";
  if (/members[- ]only|join this channel/i.test(s)) return "members-only video";
  if (/confirm your age|age[- ]restricted|inappropriate for some users/i.test(s)) {
    return `age-restricted video \u2014 it needs a signed-in session: ${envName("YTDLP_ARGS")}="--cookies-from-browser firefox"`;
  }
  if (/not a bot|sign in to confirm|po[ _-]?token|HTTP Error 403/i.test(s)) return `YouTube refused yt-dlp \u2014 ${unblock}`;
  if (/has been removed|account .*terminated|no longer available|copyright claim/i.test(s)) return "video removed";
  if (/unavailable|not available/i.test(s)) return "video unavailable";
  if (/timed out after/i.test(s)) return "yt-dlp timed out";
  const line = s.split("\n").map((l) => l.trim()).find((l) => l.startsWith("ERROR:"));
  return `yt-dlp failed: ${(line ?? s.trim().split("\n")[0] ?? "").replace(/^ERROR:\s*/, "").slice(0, 200) || "no output"}`;
}
async function withTempDir(label, fn) {
  const dir = mkdtempSync2(join2(tmpdir2(), `${brand().name}-${label}-`));
  try {
    return await fn(dir);
  } finally {
    rmSync2(dir, { recursive: true, force: true });
  }
}
async function downloadSubtitle(info, lang, auto, run2 = defaultVideoRunner, signal) {
  return withTempDir("subs", async (dir) => {
    const infoPath = join2(dir, "info.json");
    writeFileSync2(infoPath, info);
    const r = await runYtdlp(
      [
        "--load-info-json",
        infoPath,
        "--skip-download",
        "--no-warnings",
        auto ? "--write-auto-subs" : "--write-subs",
        "--sub-langs",
        lang,
        "--sub-format",
        "vtt",
        "-o",
        join2(dir, "sub.%(ext)s")
      ],
      { run: run2, timeoutMs: SUBTITLE_TIMEOUT_MS, signal }
    );
    const file = readdirSync2(dir).find((f) => f.endsWith(".vtt"));
    if (file) return { vtt: readFileSync3(join2(dir, file), "utf8") };
    if (signal?.aborted) return { error: "cancelled" };
    return { error: r.ok ? `yt-dlp wrote no ${lang} track` : classifyYtdlpError(r.stderr) };
  });
}
async function ytdlpVersionAge(run2 = defaultVideoRunner, now = Date.now()) {
  const r = await run2("yt-dlp", ["--version"], { timeoutMs: 2e4 });
  if (!r.ok) return void 0;
  const version = r.stdout.trim().split("\n")[0] ?? "";
  const m = /^(\d{4})\.(\d{2})\.(\d{2})/.exec(version);
  if (!m) return { version };
  const released = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return { version, ageDays: Math.max(0, Math.floor((now - released) / 864e5)) };
}
async function downloadMedia(args, dir, stem, opts) {
  let stderr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const timeoutMs = typeof opts.timeoutMs === "function" ? opts.timeoutMs() : opts.timeoutMs;
    const r = await runYtdlp([...args, "--no-warnings", "-o", join2(dir, `${stem}.%(ext)s`)], { run: opts.run, url: opts.url, timeoutMs, signal: opts.signal });
    if (opts.signal?.aborted) return { error: "cancelled" };
    if (r.status === 124) return { error: "timed out", timedOut: true };
    const file = r.ok ? readdirSync2(dir).find((f) => f.startsWith(`${stem}.`) && !/\.part(?:-Frag\d+)?$|\.ytdl$|\.f\d+\.\w+$/.test(f)) : void 0;
    if (file) return { file };
    stderr = r.ok ? "yt-dlp wrote no file" : r.stderr;
  }
  return { error: classifyYtdlpError(stderr) };
}
var TIMING = /^((?:\d+:)?\d{1,2}:\d{2}\.\d{3})\s+-->\s+((?:\d+:)?\d{1,2}:\d{2}\.\d{3})/;
var MIN_CUE_S = 0.05;
function seconds(stamp) {
  const parts = stamp.split(":").map(Number);
  return parts.reduce((acc, p) => acc * 60 + p, 0);
}
var ENTITIES2 = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", lrm: "", rlm: "" };
function decode(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole2, name) => {
    if (name[0] === "#") {
      const code = name[1] === "x" || name[1] === "X" ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return Number.isFinite(code) && code > 0 && code <= 1114111 ? String.fromCodePoint(code) : whole2;
    }
    return ENTITIES2[name.toLowerCase()] ?? whole2;
  });
}
var clean = (line) => decode(line.replace(/<[^>]*>/g, "")).replace(/\s+/g, " ").trim();
function parseVtt(src, opts = {}) {
  const text = src.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  if (!/^WEBVTT/.test(text)) return [];
  const rolling = opts.rolling ?? (/<\d{2}:\d{2}[:.]\d/.test(text) || /<c>/.test(text));
  const out = [];
  let shown = [];
  for (const block of text.split(/\n{2,}/)) {
    const raw = block.split("\n");
    const at = raw.findIndex((l) => TIMING.test(l));
    if (at < 0) continue;
    const m = TIMING.exec(raw[at]);
    const start = seconds(m[1]);
    const end = seconds(m[2]);
    const lines = raw.slice(at + 1).map(clean).filter(Boolean);
    const previous = shown;
    shown = lines;
    if (end - start < MIN_CUE_S) continue;
    let fresh = lines;
    if (rolling) {
      fresh = lines.slice(repeatedLead(lines, previous));
      const last = previous[previous.length - 1];
      if (last && fresh[0]?.startsWith(`${last} `)) fresh = [fresh[0].slice(last.length + 1), ...fresh.slice(1)];
    }
    if (fresh.length) out.push({ start, end, text: fresh.join(" ") });
  }
  return out;
}
function repeatedLead(lines, previous) {
  for (let n = Math.min(lines.length, previous.length); n > 0; n--) {
    const tail = previous.slice(previous.length - n);
    if (tail.every((l, i) => l === lines[i])) return n;
  }
  return 0;
}
var SENTENCE_END = /[.!?…]+["'”’)\]]*(?=\s|$)/g;
var MAX_SEGMENT_S = 30;
var MAX_SENTENCES = 3;
var PAUSE_S = 5;
var WORDS_TO_CLOSE = 25;
var BREAK_SLACK_S = 0.5;
function mergeSegments(cues, breaks = []) {
  const out = [];
  let cur;
  const flush = () => {
    if (cur) out.push(cur);
    cur = void 0;
  };
  const crossesBreak = (from, to) => breaks.some((b) => b > from + BREAK_SLACK_S && b <= to + BREAK_SLACK_S);
  for (const cue of cues) {
    if (cur && (cue.start - cur.end > PAUSE_S || cue.end - cur.start > MAX_SEGMENT_S || crossesBreak(cur.start, cue.start))) flush();
    cur = cur ? { start: cur.start, end: Math.max(cur.end, cue.end), text: `${cur.text} ${cue.text}` } : { ...cue };
    const sentences = cur.text.match(SENTENCE_END)?.length ?? 0;
    const endsSentence = /[.!?…]+["'”’)\]]*$/.test(cur.text);
    const words2 = cur.text.split(/\s+/).length;
    if (sentences >= MAX_SENTENCES || endsSentence && words2 >= WORDS_TO_CLOSE) flush();
  }
  flush();
  return out;
}
var DEFAULT_MAX = 3;
var DEFAULT_TIMEOUT_MS2 = 30 * 6e4;
var DEFAULT_MODEL = "small";
var PYAV_PIN = "av<18";
var spent2 = 0;
function whisperBudgetLeft() {
  return Math.max(0, envInt("WHISPER_MAX", DEFAULT_MAX) - spent2);
}
function whisperModel() {
  return env("WHISPER_MODEL") ?? DEFAULT_MODEL;
}
function whisperSegments(json) {
  try {
    const parsed = JSON.parse(json);
    return (parsed.segments ?? []).map((s) => ({
      start: Number(s.start),
      end: Number(s.end),
      text: String(s.text ?? "").replace(/\s+/g, " ").trim()
    })).filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text);
  } catch {
    return [];
  }
}
function whisperLanguage(tag) {
  const base2 = tag?.toLowerCase().split(/[-_]/)[0];
  return base2 && /^[a-z]{2,3}$/.test(base2) ? base2 : void 0;
}
async function whisperTranscribe(info, language, run2, signal) {
  if (whisperBudgetLeft() <= 0) return { declined: "budget" };
  spent2++;
  const refund = (r) => {
    spent2 = Math.max(0, spent2 - 1);
    return r;
  };
  const budgetMs = envInt("WHISPER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS2, 1e3);
  const deadline = Date.now() + budgetMs;
  const left = () => Math.max(1e3, deadline - Date.now());
  const timedOut = { failed: `whisper: timed out after ${Math.round(budgetMs / 6e4)} min (${envName("WHISPER_TIMEOUT_MS")})` };
  return withTempDir("whisper", async (dir) => {
    const infoPath = join3(dir, "info.json");
    writeFileSync3(infoPath, info);
    const dl = await downloadMedia(["--load-info-json", infoPath, "-f", "bestaudio/best"], dir, "audio", { run: run2, timeoutMs: left, signal });
    if (signal?.aborted) return refund({ failed: "whisper: cancelled" });
    if ("timedOut" in dl) return timedOut;
    if ("error" in dl) return refund({ failed: `whisper: the audio download failed (${dl.error})` });
    const audio = dl.file;
    const wav = join3(dir, "speech.wav");
    const ff = await run2("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", join3(dir, audio), "-ar", "16000", "-ac", "1", wav], {
      timeoutMs: left(),
      signal
    });
    if (ff.missing) return refund({ failed: "whisper needs ffmpeg", unavailable: true });
    if (signal?.aborted) return refund({ failed: "whisper: cancelled" });
    if (ff.status === 124) return timedOut;
    if (!ff.ok || !existsSync2(wav)) return refund({ failed: "whisper: ffmpeg could not convert the audio" });
    const args = ["--with", PYAV_PIN, "whisper-ctranslate2", wav, "--model", whisperModel(), "--output_format", "json", "--output_dir", dir];
    const lang = whisperLanguage(language);
    if (lang) args.push("--language", lang);
    const w = await run2("uvx", args, { timeoutMs: left(), cwd: dir, signal });
    if (w.missing) return refund({ failed: "whisper needs uvx", unavailable: true });
    if (signal?.aborted) return { failed: "whisper: cancelled" };
    if (w.status === 124) return timedOut;
    const out = join3(dir, "speech.json");
    if (!w.ok || !existsSync2(out)) return { failed: `whisper: ${w.stderr.trim().split("\n").pop() || "failed"}` };
    return { segments: whisperSegments(readFileSync4(out, "utf8")) };
  });
}
var VIDEO_TRANSCRIBERS = ["manual-subs", "auto-subs", "whisper"];
var processDeps = {};
function videoDeps(own) {
  return { run: own?.run ?? processDeps.run ?? defaultVideoRunner, have: own?.have ?? processDeps.have ?? have };
}
var dead3 = /* @__PURE__ */ new Map();
function enabledTranscribers(engines) {
  return engines ?? enginesFromEnv("VIDEO_ENGINES", VIDEO_TRANSCRIBERS) ?? VIDEO_TRANSCRIBERS;
}
var MIN_WORDS_PER_MINUTE = 5;
function assessTranscript(segments, duration) {
  const words2 = segments.reduce((n, s) => n + s.text.split(/\s+/).filter(Boolean).length, 0);
  if (!words2) return { ok: false, reason: "empty transcript" };
  if (duration && duration > 60) {
    const minutes = duration / 60;
    if (words2 / minutes < MIN_WORDS_PER_MINUTE) {
      return { ok: false, reason: `transcript too sparse: ${words2} words over ${Math.round(minutes)} min \u2014 music or a silent video?` };
    }
  }
  return { ok: true };
}
var base = (tag) => tag.toLowerCase().split(/[-_]/)[0];
function pickManualTrack(meta, lang) {
  const tracks = meta.subtitles;
  if (!tracks.length) return void 0;
  for (const want of [lang, meta.language, "en"]) {
    if (!want) continue;
    const exact = tracks.find((t) => t.toLowerCase() === want.toLowerCase());
    if (exact) return exact;
    const sameBase = tracks.find((t) => base(t) === base(want));
    if (sameBase) return sameBase;
  }
  return tracks[0];
}
function pickAutoTrack(meta) {
  const tracks = meta.autoCaptions;
  const lang = meta.language;
  if (lang) {
    for (const want of [`${lang}-orig`, lang]) {
      const hit = tracks.find((t) => t.toLowerCase() === want.toLowerCase());
      if (hit) return hit;
    }
    const orig = tracks.find((t) => t.endsWith("-orig") && base(t) === base(lang));
    if (orig) return orig;
    return void 0;
  }
  const origs = tracks.filter((t) => t.endsWith("-orig"));
  return origs.length === 1 ? origs[0] : void 0;
}
var chapterStarts = (meta) => meta.chapters.map((c) => c.start);
async function subtitleRung(auto, meta, info, opts, deps) {
  const track = auto ? pickAutoTrack(meta) : pickManualTrack(meta, opts.lang);
  if (!track) return { failure: auto ? "no auto-captions in the video's language" : "no manual subtitles", noTrack: true };
  const got = await downloadSubtitle(info, track, auto, deps.run, opts.signal);
  if ("error" in got) return { failure: `${auto ? "auto-captions" : "subtitles"} (${track}): ${got.error}` };
  return { segments: mergeSegments(parseVtt(got.vtt, { rolling: auto }), chapterStarts(meta)), track };
}
async function whisperRung(meta, info, opts, deps) {
  const missing = ["uvx", "ffmpeg"].filter((c) => !deps.have(c));
  if (missing.length) return { failure: "whisper needs uvx and ffmpeg", unavailable: true };
  if (whisperBudgetLeft() <= 0) return { failure: `this run's whisper budget is spent (raise ${envName("WHISPER_MAX")})` };
  const r = await whisperTranscribe(info, meta.language, deps.run, opts.signal);
  if ("segments" in r) return { segments: mergeSegments(r.segments, chapterStarts(meta)) };
  if ("declined" in r) return { failure: `this run's whisper budget is spent (raise ${envName("WHISPER_MAX")})` };
  return { failure: r.failed, unavailable: r.unavailable };
}
var plain = (segments) => segments.map((s) => s.text).join("\n");
async function transcribeVideo(url, opts = {}) {
  const none = (reason2, meta2) => ({
    text: "",
    segments: [],
    chapters: meta2?.chapters ?? [],
    ...meta2 ? { meta: meta2 } : {},
    reason: reason2
  });
  const id = youtubeVideoId(url);
  if (!id) return none(`not a YouTube video URL: ${url}`);
  const deps = videoDeps(opts.deps);
  const rungs = enabledTranscribers(opts.engines);
  if (!rungs.length) return none(`every transcript rung is switched off (${envName("VIDEO_ENGINES")})`);
  const probe = await probeVideo(`https://www.youtube.com/watch?v=${id}`, deps.run, opts.signal);
  if ("error" in probe) return none(probe.error);
  const { meta, info } = probe;
  if (meta.live) return none(`live stream ${meta.live === "live" ? "in progress" : "not started yet"} \u2014 read it once it has ended`, meta);
  const failures = [];
  let noTrack = 0;
  let subtitleRungs = 0;
  let whisperMissing = false;
  let gateReason;
  for (const rung of rungs) {
    if (opts.signal?.aborted) return none("cancelled", meta);
    if (rung !== "whisper") subtitleRungs++;
    const known = dead3.get(rung);
    let got;
    if (known) got = { failure: known, unavailable: true };
    else {
      try {
        got = rung === "whisper" ? await whisperRung(meta, info, opts, deps) : await subtitleRung(rung === "auto-subs", meta, info, opts, deps);
      } catch (e) {
        got = { failure: `${rung}: ${e.message}` };
      }
    }
    if (opts.signal?.aborted) return none("cancelled", meta);
    if ("failure" in got) {
      if (got.unavailable) dead3.set(rung, got.failure);
      if (rung === "whisper" && got.unavailable) whisperMissing = true;
      if (got.noTrack) noTrack++;
      failures.push(got.failure);
      continue;
    }
    const verdict = assessTranscript(got.segments, meta.duration);
    if (verdict.ok)
      return { text: plain(got.segments), segments: got.segments, chapters: meta.chapters, meta, via: rung, ...got.track ? { track: got.track } : {} };
    gateReason = verdict.reason;
  }
  let reason;
  if (subtitleRungs && noTrack === subtitleRungs && whisperMissing && !gateReason) reason = "no subtitles, and whisper needs uvx and ffmpeg";
  else reason = [...new Set([gateReason, ...failures].filter(Boolean))].join("; ");
  return none(reason || "no transcript", meta);
}
function formatStamp(seconds3) {
  const t = Math.max(0, Math.floor(Number.isFinite(seconds3) ? seconds3 : 0));
  const pad2 = (n) => String(n).padStart(2, "0");
  const h = Math.floor(t / 3600);
  const m = Math.floor(t % 3600 / 60);
  const s = t % 60;
  return h ? `${h}:${pad2(m)}:${pad2(s)}` : `${pad2(m)}:${pad2(s)}`;
}
var VIA_LABEL = {
  "manual-subs": "manual subtitles",
  "auto-subs": "YouTube auto-captions",
  whisper: "local whisper transcription"
};
var paragraph = (s) => `[${formatStamp(s.start)}] ${s.text}`;
var baseLang = (tag) => tag.toLowerCase().replace(/-orig$/, "").split(/[-_]/)[0];
function source(t) {
  if (!t.via) return void 0;
  const how = `${VIA_LABEL[t.via] ?? t.via} (${t.via}${t.track ? `, track ${t.track}` : ""})`;
  const spoken = t.meta?.language;
  if (t.track && spoken && baseLang(t.track) !== baseLang(spoken)) return `${how} \u2014 a translation: the video speaks ${spoken}`;
  return how;
}
function transcriptMarkdown(t) {
  if (!t.segments.length) return "";
  const meta = t.meta;
  const head = [`# ${meta?.title ?? "Video transcript"}`, ""];
  if (meta) {
    const facts = [
      meta.channel && `- Channel: ${meta.channel}`,
      meta.uploadDate && `- Published: ${meta.uploadDate}`,
      meta.duration !== void 0 && `- Duration: ${formatStamp(meta.duration)}`,
      `- URL: ${meta.webpageUrl}`,
      t.via && `- Transcript: ${source(t)}`
    ].filter(Boolean);
    head.push(...facts, "");
  }
  const body = [];
  const chapters = [...t.chapters].sort((a, b) => a.start - b.start);
  let c = -1;
  for (const seg of t.segments) {
    while (c + 1 < chapters.length && chapters[c + 1].start <= seg.start + 0.5) {
      c++;
      body.push(`## ${chapters[c].title}`, "");
    }
    body.push(paragraph(seg), "");
  }
  return [...head, ...body].join("\n").trimEnd() + "\n";
}
var flagged = false;
function isNoWrite() {
  return flagged || envFlag("NO_WRITE");
}
var collected = [];
function ensureDir(dir) {
  if (isNoWrite()) return;
  mkdirSync(dir, { recursive: true });
}
function writeArtifact(path, content) {
  if (isNoWrite()) {
    const at = collected.findIndex((a) => a.path === path);
    if (at !== -1) collected[at] = { path, content };
    else collected.push({ path, content });
    return path;
  }
  writeFileAtomic(path, content);
  return path;
}
var tmpCounter = 0;
function writeFileAtomic(path, content) {
  const tmp = `${path}.${process.pid}.${tmpCounter++}.tmp`;
  try {
    writeFileSync4(tmp, content);
    renameSync(tmp, path);
  } catch (e) {
    try {
      unlinkSync(tmp);
    } catch {
    }
    throw e;
  }
}
var STOPWORDS = /* @__PURE__ */ new Set([
  "the",
  "a",
  "an",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "do",
  "does",
  "did",
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "who",
  "whom",
  "this",
  "that",
  "these",
  "those",
  "of",
  "in",
  "on",
  "to",
  "for",
  "with",
  "and",
  "or",
  "but",
  "if",
  "then",
  "else",
  "than",
  "as",
  "at",
  "by",
  "from",
  "into",
  "about",
  "it",
  "its",
  "i",
  "you",
  "we",
  "they",
  "he",
  "she",
  "there",
  "here",
  "can",
  "could",
  "should",
  "would",
  "will",
  "shall",
  "may",
  "might",
  "must",
  "have",
  "has",
  "had",
  "not",
  "no",
  "yes",
  "so",
  "such",
  "only",
  "any",
  "some",
  "all",
  "get",
  "set",
  "use",
  "used",
  "using",
  "work",
  "works",
  "working",
  "handle",
  "handled",
  "happen",
  "happens",
  "default",
  "value",
  "values",
  "please",
  "explain",
  "tell",
  "me",
  "my",
  "our",
  "vs"
]);
var LOCALE_STOPWORDS = /* @__PURE__ */ new Set([
  "le",
  "la",
  "les",
  "de",
  "des",
  "du",
  "un",
  "une",
  "est",
  "sont",
  "que",
  "qui",
  "quoi",
  "quel",
  "quelle",
  "quels",
  "quelles",
  "pour",
  "dans",
  "avec",
  "entre",
  "sur",
  "par",
  "pas",
  "plus",
  "et",
  "ou",
  "o\xF9",
  "ce",
  "cette",
  "ces",
  "se",
  "sa",
  "son",
  "ses",
  "leur",
  "leurs",
  "comment",
  "pourquoi",
  "quand",
  "fait",
  "faire",
  "peut",
  "doit",
  "\xEAtre",
  "avoir",
  "il",
  "elle",
  "nous",
  "vous",
  "ils",
  "elles",
  "au",
  "aux",
  "si",
  "ne",
  // German.
  "der",
  "die",
  "das",
  "und",
  "ist",
  "sind",
  "wie",
  "ein",
  "eine",
  "einen",
  "einem",
  "einer",
  "mit",
  "f\xFCr",
  "von",
  "zu",
  "den",
  "dem",
  "im",
  "auf",
  "nicht",
  "sich",
  "oder",
  "warum",
  "wann",
  "welche",
  "welcher",
  "welches",
  "kann",
  "wird"
]);
function isStopword(term) {
  const t = term.toLowerCase();
  if (STOPWORDS.has(t)) return true;
  if (LOCALE_STOPWORDS.has(t) && !(term !== t && term === term.toUpperCase())) return true;
  const extra = brand().extraStopwords;
  return extra ? extraStopwordSet(extra).has(t) : false;
}
var extraSets = /* @__PURE__ */ new WeakMap();
function extraStopwordSet(extra) {
  const hit = extraSets.get(extra);
  if (hit && hit.length === extra.length) return hit.set;
  const set = new Set(extra.map((w) => w.toLowerCase()));
  extraSets.set(extra, { length: extra.length, set });
  return set;
}
var TOKEN_RE = new RegExp("(?<![\\p{L}\\p{M}\\p{N}_])\\.net(?![\\p{L}\\p{M}\\p{N}_])|[\\p{L}\\p{M}\\p{N}_]+(?:(?<=\\p{L})[+#]{1,2}\\d*(?![\\p{L}\\p{M}\\p{N}_+#])|\\/\\d(?:\\.\\d)?(?![\\p{L}\\p{M}\\p{N}_./]))?", "giu");
var ACCENT_CLASSES = {
  a: "a\xE0\xE1\xE2\xE3\xE4\xE5\u0101\u0103\u0105",
  c: "c\xE7\u0107\u0109\u010B\u010D",
  d: "d\u010F\u0111",
  e: "e\xE8\xE9\xEA\xEB\u0113\u0115\u0117\u0119\u011B",
  g: "g\u011D\u011F\u0121\u0123",
  i: "i\xEC\xED\xEE\xEF\u0129\u012B\u012D\u012F\u0131",
  l: "l\u013A\u013C\u013E\u0140\u0142",
  n: "n\xF1\u0144\u0146\u0148",
  o: "o\xF2\xF3\xF4\xF5\xF6\xF8\u014D\u014F\u0151",
  r: "r\u0155\u0157\u0159",
  s: "s\u015B\u015D\u015F\u0161",
  t: "t\u0163\u0165\u0167",
  u: "u\xF9\xFA\xFB\xFC\u0169\u016B\u016D\u016F\u0171\u0173",
  y: "y\xFD\xFF\u0177",
  z: "z\u017A\u017C\u017E"
};
var BASE_OF = /* @__PURE__ */ new Map();
for (const [base2, cls] of Object.entries(ACCENT_CLASSES)) {
  for (const ch of cls) BASE_OF.set(ch, base2);
}
function baseChar(ch) {
  const known = BASE_OF.get(ch);
  if (known) return known;
  const stripped = ch.normalize("NFD").replace(new RegExp("\\p{M}+", "gu"), "");
  return stripped.length === 1 ? stripped : ch;
}
var NON_ASCII = /[\u0080-\uffff]/;
function deaccent(s) {
  if (!NON_ASCII.test(s)) return s;
  let out = "";
  for (const ch of s) out += baseChar(ch);
  return out;
}
function foldPlural(t) {
  if (t.length > 4 && t.endsWith("ies")) return t.slice(0, -3) + "y";
  if (t.length > 4 && /(?:[sxz]|[cs]h)es$/.test(t)) return t.slice(0, -2);
  if (t.length > 3 && t.endsWith("s") && !/(?:ss|us|is)$/.test(t)) return t.slice(0, -1);
  return t;
}
function foldTerm(raw) {
  return foldPlural(deaccent(raw.toLowerCase()));
}
function subtokens(raw) {
  const spaced = raw.replace(new RegExp("([\\p{Ll}\\p{N}])(\\p{Lu})", "gu"), "$1 $2").replace(new RegExp("(\\p{Lu}+)(\\p{Lu}\\p{Ll})", "gu"), "$1 $2").replace(new RegExp("(\\p{L})(\\p{N})", "gu"), "$1 $2").replace(new RegExp("(\\p{N})(\\p{L})", "gu"), "$1 $2");
  const parts = spaced.split(/[^\p{L}\p{M}\p{N}]+/u).filter(Boolean);
  if (parts.length < 2) return [];
  const out = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower.length < 3 || isStopword(p)) continue;
    if (!out.includes(lower)) out.push(lower);
    if (out.length >= 4) break;
  }
  return out;
}
var indexTokenCache = /* @__PURE__ */ new WeakMap();
function bm25Tokenize(text, opts = {}) {
  return tokenize(text, opts.subtokens !== false);
}
var WORD_SPLIT = /[^\p{L}\p{M}\p{N}_]+/u;
var NON_ASCII2 = /[^\p{ASCII}]/u;
var CJK_CHAR2 = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]/u;
var CJK_RUNS2 = /([\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}]+)/u;
var IDENT_BOUNDARY = new RegExp("_|[\\p{Ll}\\p{N}]\\p{Lu}|\\p{Lu}\\p{Lu}\\p{Ll}|\\p{L}\\p{N}|\\p{N}\\p{L}", "u");
var MAX_IDENT = 64;
function tokenize(text, expand2) {
  if (!text) return [];
  const out = [];
  const nonAscii = NON_ASCII2.test(text);
  for (const raw of (nonAscii ? text.normalize("NFC") : text).split(WORD_SPLIT)) {
    if (!raw) continue;
    if (nonAscii && CJK_CHAR2.test(raw)) {
      for (const piece of raw.split(CJK_RUNS2)) {
        if (!piece) continue;
        if (CJK_CHAR2.test(piece)) pushBigrams(piece, out);
        else pushTerm(piece, out, expand2);
      }
    } else pushTerm(raw, out, expand2);
  }
  return out;
}
function pushTerm(raw, out, expand2) {
  if (raw.length < 2 || isStopword(raw)) return;
  const t = foldCached(raw);
  if (t.length < 2) return;
  out.push(t);
  if (!expand2 || raw.length > MAX_IDENT) return;
  for (const sub of subtermsCached(raw, t)) out.push(sub);
}
function pushBigrams(run2, out) {
  const chars = Array.from(run2);
  if (chars.length === 1) {
    out.push(run2);
    return;
  }
  for (let i = 0; i + 1 < chars.length; i++) out.push(chars[i] + chars[i + 1]);
}
var FOLD_CACHE_MAX = 5e4;
var foldCache = /* @__PURE__ */ new Map();
function foldCached(raw) {
  const hit = foldCache.get(raw);
  if (hit !== void 0) return hit;
  const t = foldTerm(raw);
  if (foldCache.size >= FOLD_CACHE_MAX) foldCache.clear();
  foldCache.set(raw, t);
  return t;
}
var NO_SUBTERMS = [];
var subtermCache = /* @__PURE__ */ new Map();
var subtermExtras = { list: void 0, length: 0 };
function subtermsCached(raw, folded) {
  const list = brand().extraStopwords;
  if (list !== subtermExtras.list || (list?.length ?? 0) !== subtermExtras.length) {
    subtermCache.clear();
    subtermExtras = { list, length: list?.length ?? 0 };
  }
  const hit = subtermCache.get(raw);
  if (hit !== void 0) return hit;
  let subs = NO_SUBTERMS;
  if (IDENT_BOUNDARY.test(raw)) {
    subs = subtokens(raw).map(foldCached).filter((sub) => sub !== folded && sub.length >= 2);
  }
  if (subtermCache.size >= FOLD_CACHE_MAX) subtermCache.clear();
  subtermCache.set(raw, subs);
  return subs;
}
function docTokens(doc, titleWeight, headingWeight, body) {
  const out = body ? [...body] : bm25Tokenize(doc.body);
  const headings = bm25Tokenize(doc.headings);
  for (let r = 0; r < headingWeight; r++) out.push(...headings);
  const title = bm25Tokenize(doc.title);
  for (let r = 0; r < titleWeight; r++) out.push(...title);
  return out;
}
function proximityBonus(tokens, queryTerms, window = 6, cap = 0.1) {
  if (queryTerms.length < 2) return 0;
  const q = new Set(queryTerms);
  const hits = [];
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    if (q.has(tok)) hits.push({ pos: i, term: tok });
  }
  if (hits.length < 2) return 0;
  let close = 0;
  for (let i = 1; i < hits.length; i++) {
    if (hits[i].term !== hits[i - 1].term && hits[i].pos - hits[i - 1].pos <= window) close++;
  }
  return Math.min(cap, cap * (close / Math.max(1, queryTerms.length - 1)));
}
function buildBm25Index(question, docs, opts = {}) {
  const k1 = opts.k1 ?? 1.2;
  const b = opts.b ?? 0.75;
  const titleWeight = 3;
  const headingWeight = 2;
  const queryTerms = [...new Set(bm25Tokenize(question))];
  const N = docs.length;
  const df = /* @__PURE__ */ new Map();
  const tokenCache = /* @__PURE__ */ new WeakMap();
  let totalLen = 0;
  for (const doc of docs) {
    const toks = docTokens(doc, titleWeight, headingWeight, opts.tokensOf?.(doc));
    tokenCache.set(doc, { title: doc.title, headings: doc.headings, body: doc.body, tokens: toks });
    totalLen += toks.length;
    for (const t of new Set(toks)) df.set(t, (df.get(t) ?? 0) + 1);
  }
  const avgdl = N ? totalLen / N : 0;
  const idf = /* @__PURE__ */ new Map();
  for (const t of queryTerms) {
    if (N < 3) {
      idf.set(t, 1);
      continue;
    }
    const dfi = df.get(t) ?? 0;
    idf.set(t, Math.log(1 + (N - dfi + 0.5) / (dfi + 0.5)));
  }
  const index = { idf, avgdl, N, queryTerms, k1, b, titleWeight, headingWeight };
  indexTokenCache.set(index, tokenCache);
  return index;
}
function indexedDocTokens(index, doc) {
  const cache2 = indexTokenCache.get(index);
  const cached = cache2?.get(doc);
  if (cached && cached.title === doc.title && cached.headings === doc.headings && cached.body === doc.body) return cached.tokens;
  const tokens = docTokens(doc, index.titleWeight, index.headingWeight);
  cache2?.set(doc, { title: doc.title, headings: doc.headings, body: doc.body, tokens });
  return tokens;
}
function bm25Score(index, doc) {
  if (!index.queryTerms.length) return 0;
  const toks = indexedDocTokens(index, doc);
  const dl = toks.length;
  if (!dl) return 0;
  const tf = /* @__PURE__ */ new Map();
  for (const t of toks) tf.set(t, (tf.get(t) ?? 0) + 1);
  const { k1, b, avgdl } = index;
  const lenNorm = 1 - b + b * (avgdl ? dl / avgdl : 1);
  let score = 0;
  for (const term of index.queryTerms) {
    const f = tf.get(term);
    if (!f) continue;
    const idf = index.idf.get(term) ?? 0;
    score += idf * (f * (k1 + 1)) / (f + k1 * lenNorm);
  }
  return score * (1 + proximityBonus(toks, index.queryTerms));
}
function videoRoot(out) {
  return resolve(out ?? env("VIDEO_DIR") ?? join4(tmpdir3(), brand().name, "video"));
}
var baseLang2 = (tag) => tag.toLowerCase().replace(/-orig$/, "").split(/[-_]/)[0];
function servesLang(meta, lang) {
  if (!lang) return true;
  const read2 = meta.track ?? meta.lang ?? meta.language;
  return read2 !== void 0 && baseLang2(read2) === baseLang2(lang);
}
var readJson = (path) => {
  try {
    return JSON.parse(readFileSync5(path, "utf8"));
  } catch {
    return void 0;
  }
};
function readVideoRun(dir) {
  const meta = readJson(join4(dir, "meta.json"));
  const segments = readJson(join4(dir, "segments.json"));
  if (!meta?.id || !Array.isArray(segments)) return void 0;
  return { meta, segments };
}
async function fetchVideoRun(url, root, opts = {}) {
  const id = youtubeVideoId(url);
  if (!id) return { ok: false, reason: `not a YouTube video URL: ${url}` };
  const dir = join4(root, id);
  const transcriptPath = join4(dir, "TRANSCRIPT.md");
  if (!opts.refresh) {
    const kept = readVideoRun(dir);
    if (kept && existsSync3(transcriptPath) && servesLang(kept.meta, opts.lang))
      return { ok: true, id, dir, transcript: transcriptPath, reused: true, meta: kept.meta, segments: kept.segments.length };
  }
  const t = await transcribeVideo(url, opts);
  if (!t.via || !t.meta) return { ok: false, id, reason: t.reason ?? "no transcript" };
  const meta = {
    ...t.meta,
    via: t.via,
    ...t.track ? { track: t.track } : {},
    ...opts.lang ? { lang: opts.lang } : {},
    fetchedAt: (/* @__PURE__ */ new Date()).toISOString()
  };
  const markdown = transcriptMarkdown(t);
  const done = { ok: true, id, dir, transcript: transcriptPath, reused: false, meta, segments: t.segments.length };
  if (isNoWrite()) return { ...done, markdown };
  try {
    ensureDir(dir);
    writeArtifact(join4(dir, "segments.json"), `${JSON.stringify(t.segments, null, 1)}
`);
    writeArtifact(transcriptPath, markdown);
    writeArtifact(join4(dir, "meta.json"), `${JSON.stringify(meta, null, 2)}
`);
  } catch (e) {
    return { ok: false, id, reason: `cannot write the run in ${dir}: ${e.message}` };
  }
  return done;
}
var PASSAGE_S = 45;
function videoPassages(segments, chapterStarts2 = []) {
  const out = [];
  let cur;
  for (const s of segments) {
    if (cur && chapterStarts2.some((b) => b > cur.start + 0.5 && b <= s.start + 0.5)) {
      out.push(cur);
      cur = void 0;
    }
    cur = cur ? { start: cur.start, end: s.end, text: `${cur.text} ${s.text}` } : { ...s };
    if (cur.end - cur.start >= PASSAGE_S) {
      out.push(cur);
      cur = void 0;
    }
  }
  if (cur) out.push(cur);
  return out;
}
function videoUrlAt(webpageUrl, seconds3) {
  try {
    const u = new URL(webpageUrl);
    u.searchParams.set("t", `${Math.floor(seconds3)}s`);
    return u.toString();
  } catch {
    return webpageUrl;
  }
}
function listVideoRuns(dir) {
  const self = readVideoRun(dir);
  if (self) return [{ dir, ...self }];
  let names = [];
  try {
    names = readdirSync3(dir).sort();
  } catch {
    return [];
  }
  return names.flatMap((name) => {
    const child = join4(dir, name);
    try {
      if (!statSync(child).isDirectory()) return [];
    } catch {
      return [];
    }
    const run2 = readVideoRun(child);
    return run2 ? [{ dir: child, ...run2 }] : [];
  });
}
function corpusLabels(dir) {
  const c = readJson(join4(dir, "corpus.json"));
  const out = /* @__PURE__ */ new Map();
  for (const v of c?.videos ?? []) if (typeof v.id === "string" && typeof v.label === "string") out.set(v.id, v.label);
  return out;
}
var chapterAt = (chapters, t) => [...chapters].reverse().find((c) => c.start <= t + 0.5)?.title;
function searchVideoRuns(dir, query, opts = {}) {
  const labels = opts.labels ?? corpusLabels(dir);
  const docs = [];
  for (const run2 of listVideoRuns(dir)) {
    const { meta } = run2;
    for (const p of videoPassages(
      run2.segments,
      (meta.chapters ?? []).map((c) => c.start)
    )) {
      const chapter = chapterAt(meta.chapters ?? [], p.start);
      docs.push({
        id: `${meta.id}@${p.start}`,
        title: "",
        headings: chapter ?? "",
        body: p.text,
        hit: {
          label: labels.get(meta.id) ?? meta.id,
          videoId: meta.id,
          title: meta.title,
          ...chapter ? { chapter } : {},
          start: p.start,
          stamp: formatStamp(p.start),
          url: videoUrlAt(meta.webpageUrl, p.start),
          text: p.text
        }
      });
    }
  }
  const index = buildBm25Index(query, docs);
  return docs.map((d) => ({ ...d.hit, score: Math.round(bm25Score(index, d) * 1e3) / 1e3 })).filter((h) => h.score > 0).sort((a, b) => b.score - a.score || a.videoId.localeCompare(b.videoId) || a.start - b.start).slice(0, opts.limit ?? 10);
}
var BEFORE_S = 5;
var AFTER_S = 10;
function transcriptAround(segments, t) {
  return segments.filter((s) => s.end >= t - BEFORE_S && s.start <= t + AFTER_S).map((s) => `[${formatStamp(s.start)}] ${s.text}`).join("\n");
}
var chapterAt2 = (chapters, t) => [...chapters].sort((a, b) => b.start - a.start).find((c) => c.start <= t + 0.5)?.title;
function alignFrames(frames, segments, chapters) {
  return frames.map((f) => {
    const chapter = chapterAt2(chapters, f.time);
    return { file: f.file, time: f.time, stamp: formatStamp(f.time), kind: f.kind, ...chapter ? { chapter } : {}, text: transcriptAround(segments, f.time) };
  });
}
function framesMarkdown(meta, frames, note) {
  const out = [`# ${meta.title} \u2014 frames`, "", `- URL: ${meta.webpageUrl}`, `- ${note}`, ""];
  const quoted = /* @__PURE__ */ new Set();
  for (const f of frames) {
    out.push(`## [${f.stamp}]${f.chapter ? ` ${f.chapter}` : ""}`, "", `![${f.stamp}](${f.file})`, "");
    const lines = f.text ? f.text.split("\n") : [];
    const fresh = lines.filter((l) => !quoted.has(l));
    for (const l of fresh) quoted.add(l);
    if (fresh.length) out.push(...fresh.map((l) => `> ${l}`), "");
    else if (lines.length) out.push(`_(said over the passage quoted above, from ${lines[0].slice(0, lines[0].indexOf("]") + 1)})_`, "");
    else out.push("_(nothing said around this frame)_", "");
  }
  return out.join("\n").trimEnd() + "\n";
}
var DHASH_FRAME_BYTES = 72;
var DHASH_SAME = 6;
function dhash(gray) {
  if (gray.length < DHASH_FRAME_BYTES) throw new Error(`dhash needs ${DHASH_FRAME_BYTES} bytes, got ${gray.length}`);
  let h = 0n;
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      h = h << 1n | (gray[y * 9 + x] > gray[y * 9 + x + 1] ? 1n : 0n);
    }
  }
  return h;
}
function hamming(a, b) {
  let x = a ^ b;
  let n = 0;
  while (x) {
    x &= x - 1n;
    n++;
  }
  return n;
}
function dhashStream(raw) {
  const out = [];
  for (let at = 0; at + DHASH_FRAME_BYTES <= raw.length; at += DHASH_FRAME_BYTES) out.push(dhash(raw.subarray(at, at + DHASH_FRAME_BYTES)));
  return out;
}
var FRAME_EFFORT = { low: 20, med: 50, high: 100 };
var SCENE_THRESHOLD = 0.3;
var FRAMES_TIMEOUT_MS = 30 * 6e4;
var MIN_FRAMES = 3;
var INTERVAL_FRAMES = 10;
var JPEG_FILTER = "scale='min(1280,iw)':-2:out_range=full,format=yuvj420p";
function parseShowinfo(stderr) {
  const out = [];
  for (const m of stderr.matchAll(/\bn:\s*(\d+)\s+pts:\s*-?\d+\s+pts_time:(-?[\d.]+)/g)) out[Number(m[1])] = Number(m[2]);
  return out.filter((t) => Number.isFinite(t));
}
function capFrames(frames, max) {
  const kept = [...frames].sort((a, b) => a.time - b.time);
  const limit = Math.max(1, max);
  while (kept.length > limit) {
    const spareChapters = kept.some((f) => f.kind !== "chapter");
    let worst = kept.length - 1;
    let gap = Number.POSITIVE_INFINITY;
    for (let i = 0; i < kept.length; i++) {
      if (spareChapters && kept[i].kind === "chapter") continue;
      const g = i ? kept[i].time - kept[i - 1].time : kept[1].time - kept[0].time;
      if (g < gap) {
        gap = g;
        worst = i;
      }
    }
    kept.splice(worst, 1);
  }
  return kept;
}
var plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
var fileStamp = (t) => formatStamp(t).replace(/:/g, "-");
async function extractFrames(runDir, opts = {}) {
  if (isNoWrite()) return { ok: false, reason: "frames are image files, and nothing may be written (NO_WRITE)" };
  const run2 = readVideoRun(runDir);
  if (!run2) return { ok: false, reason: `no video run in ${runDir} \u2014 fetch the video first` };
  const deps = videoDeps(opts.deps);
  if (!deps.have("ffmpeg")) return { ok: false, reason: "frames need ffmpeg" };
  const effort = opts.effort ?? "med";
  const { meta, segments } = run2;
  const duration = meta.duration ?? 0;
  return withTempDir("frames", async (tmp) => {
    const dl = await downloadMedia(["-f", "bv*[height<=720]/b[height<=720]/bv*/b", "--no-playlist"], tmp, "video", {
      run: deps.run,
      url: `https://www.youtube.com/watch?v=${meta.id}`,
      timeoutMs: FRAMES_TIMEOUT_MS,
      signal: opts.signal
    });
    if (opts.signal?.aborted) return { ok: false, reason: "cancelled" };
    if ("error" in dl) return { ok: false, reason: `the video download failed: ${dl.error}` };
    const video = dl.file;
    const input = join5(tmp, video);
    const ffmpeg = (args) => deps.run("ffmpeg", ["-nostdin", "-hide_banner", ...args], { timeoutMs: FRAMES_TIMEOUT_MS, signal: opts.signal });
    const sceneDir = join5(tmp, "scene");
    mkdirSync2(sceneDir);
    const scenes = await ffmpeg([
      "-i",
      input,
      "-vf",
      `select='gt(scene,${SCENE_THRESHOLD})',showinfo,${JPEG_FILTER}`,
      "-fps_mode",
      "vfr",
      "-q:v",
      "3",
      join5(sceneDir, "%04d.jpg")
    ]);
    if (opts.signal?.aborted) return { ok: false, reason: "cancelled" };
    const times = parseShowinfo(scenes.stderr);
    const sceneFiles = readdirSync4(sceneDir).sort();
    const candidates = sceneFiles.slice(0, times.length).map((f, i) => ({ path: join5(sceneDir, f), time: times[i], kind: "scene" }));
    const single = async (time, kind) => {
      const path = join5(tmp, `${kind}-${candidates.length}.jpg`);
      await ffmpeg(["-loglevel", "error", "-ss", time.toFixed(2), "-i", input, "-frames:v", "1", "-vf", JPEG_FILTER, "-q:v", "3", "-y", path]);
      if (existsSync4(path)) candidates.push({ path, time, kind });
    };
    const last = duration > 1 ? duration - 0.5 : Number.POSITIVE_INFINITY;
    for (const c of meta.chapters ?? []) await single(Math.min(c.start + 1, last), "chapter");
    if (candidates.length < MIN_FRAMES && duration > 0) {
      const n = Math.min(FRAME_EFFORT[effort], INTERVAL_FRAMES);
      for (let i = 0; i < n; i++) await single(duration * (i + 0.5) / n, "interval");
    }
    if (opts.signal?.aborted) return { ok: false, reason: "cancelled" };
    if (!candidates.length)
      return { ok: false, reason: `ffmpeg took no frame from the video${scenes.ok ? "" : ` (${scenes.stderr.trim().split("\n").pop()})`}` };
    candidates.sort((a, b) => a.time - b.time);
    const candDir = join5(tmp, "cand");
    mkdirSync2(candDir);
    candidates.forEach((c, i) => copyFileSync(c.path, join5(candDir, `${String(i + 1).padStart(4, "0")}.jpg`)));
    const raw = join5(tmp, "hash.raw");
    await ffmpeg(["-loglevel", "error", "-i", join5(candDir, "%04d.jpg"), "-vf", "scale=9:8,format=gray", "-f", "rawvideo", "-y", raw]);
    const hashes = existsSync4(raw) ? dhashStream(readFileSync6(raw)) : [];
    const kept = [];
    for (const [i, c] of candidates.entries()) {
      const hash = hashes.length === candidates.length ? hashes[i] : void 0;
      if (hash !== void 0 && kept.some((k) => k.hash !== void 0 && hamming(k.hash, hash) <= DHASH_SAME)) continue;
      kept.push({ ...c, ...hash !== void 0 ? { hash } : {} });
    }
    const chosen = capFrames(kept, FRAME_EFFORT[effort]);
    const staged = join5(tmp, "frames");
    mkdirSync2(staged);
    const placed = chosen.map((c, i) => {
      const file = `frames/${String(i + 1).padStart(4, "0")}_${fileStamp(c.time)}.jpg`;
      copyFileSync(c.path, join5(tmp, file));
      return { file, time: c.time, kind: c.kind };
    });
    const frames = alignFrames(placed, segments, meta.chapters ?? []);
    const dropped = candidates.length - kept.length;
    const note = `${plural(frames.length, "frame")} (effort ${effort}: at most ${FRAME_EFFORT[effort]}) from ${plural(candidates.length, "candidate")} \u2014 scene changes above ${SCENE_THRESHOLD}, one per chapter start, ${plural(dropped, "near-duplicate")} dropped`;
    const framesDir = join5(runDir, "frames");
    try {
      const incoming = `${framesDir}.${process.pid}.${Date.now()}.new`;
      cpSync(staged, incoming, { recursive: true });
      rmSync3(framesDir, { recursive: true, force: true });
      renameSync2(incoming, framesDir);
      writeArtifact(join5(runDir, "frames.json"), `${JSON.stringify(frames, null, 2)}
`);
      const markdown = writeArtifact(join5(runDir, "FRAMES.md"), framesMarkdown(meta, frames, note));
      return { ok: true, dir: framesDir, markdown, frames, candidates: candidates.length, duplicates: dropped, effort };
    } catch (e) {
      return { ok: false, reason: `cannot write the frames in ${runDir}: ${e.message}` };
    }
  });
}
async function mapLimit(items, limit, fn) {
  const width = typeof limit !== "number" || Number.isNaN(limit) ? 1 : Math.max(1, Math.floor(limit));
  if (items.length <= 1 || width === 1) {
    const out = [];
    for (let i = 0; i < items.length; i++) out.push(await fn(items[i], i));
    return out;
  }
  const results = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (; ; ) {
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        next = items.length;
        throw e;
      }
    }
  });
  await Promise.all(workers);
  return results;
}
var LIST_TIMEOUT_MS = 12e4;
var DEFAULT_LIMIT = 10;
var CORPUS_CONCURRENCY = 2;
function listingUrl(url) {
  const u = new URL(url);
  if (youtubeListKind(url) === "channel" && /^\/(?:@[^/]+|(?:channel|c|user)\/[^/]+)\/?$/.test(u.pathname)) {
    u.pathname = `${u.pathname.replace(/\/$/, "")}/videos`;
  }
  return u.toString();
}
async function listVideos(url, opts = {}) {
  const kind = youtubeListKind(url);
  if (!kind) return { error: `not a YouTube playlist or channel URL: ${url}` };
  const limit = Math.max(1, Math.trunc(opts.limit ?? DEFAULT_LIMIT));
  const r = await runYtdlp(["--flat-playlist", "-J", "--playlist-end", String(limit), "--no-warnings"], {
    run: videoDeps(opts.deps).run,
    url: listingUrl(url),
    timeoutMs: LIST_TIMEOUT_MS,
    signal: opts.signal
  });
  if (r.missing) return { error: "install yt-dlp (https://github.com/yt-dlp/yt-dlp) to read videos" };
  if (!r.ok) return { error: classifyYtdlpError(r.stderr) };
  try {
    const info = JSON.parse(r.stdout);
    const videos = (info.entries ?? []).flatMap((e) => {
      const id = typeof e.id === "string" ? e.id : "";
      const watch = `https://www.youtube.com/watch?v=${id}`;
      if (e._type === "playlist" || typeof e.ie_key === "string" && e.ie_key !== "Youtube" || !youtubeVideoId(watch)) return [];
      return [{ id, title: typeof e.title === "string" ? e.title : id, ...typeof e.duration === "number" ? { duration: e.duration } : {}, url: watch }];
    });
    const unique = videos.filter((v, i) => videos.findIndex((w) => w.id === v.id) === i);
    return { ...info.title ? { title: info.title } : {}, videos: unique.slice(0, limit) };
  } catch {
    return { error: "yt-dlp returned an unreadable listing" };
  }
}
function corpusMarkdown(c, root) {
  const cell2 = (s) => s.replace(/\|/g, "\\|").replace(/\s+/g, " ");
  const rows = c.videos.map(
    (v) => [
      v.label,
      v.id,
      cell2(v.title),
      v.duration !== void 0 ? formatStamp(v.duration) : "",
      v.via ?? "\u2014",
      v.dir ? `${v.id}/TRANSCRIPT.md` : cell2(`not read: ${v.reason ?? "no transcript"}`)
    ].join(" | ")
  );
  const read2 = c.videos.filter((v) => v.dir).length;
  return [
    `# ${c.title ?? "Video corpus"}`,
    "",
    `- Source: ${c.source}`,
    `- Directory: ${root}`,
    `- ${read2} of ${c.videos.length} videos read, ${c.createdAt}`,
    "",
    "| V# | id | title | duration | via | transcript |",
    "|---|---|---|---|---|---|",
    ...rows.map((r) => `| ${r} |`),
    ""
  ].join("\n");
}
async function fetchVideoCorpus(url, root, opts = {}) {
  if (isNoWrite()) return { ok: false, reason: "a corpus is kept on disk, and nothing may be written (NO_WRITE)" };
  const listed = await listVideos(url, { limit: opts.limit, deps: opts.deps, signal: opts.signal });
  if ("error" in listed) return { ok: false, reason: listed.error };
  if (!listed.videos.length) return { ok: false, reason: `no videos listed at ${url}` };
  let done = 0;
  const videos = await mapLimit(listed.videos, CORPUS_CONCURRENCY, async (v, i) => {
    const r = await fetchVideoRun(v.url, root, { ...opts });
    opts.onVideo?.(++done, listed.videos.length, v.title);
    const base2 = { label: `V${i + 1}`, id: v.id, title: r.ok ? r.meta.title : v.title, ...v.duration !== void 0 ? { duration: v.duration } : {} };
    return r.ok ? { ...base2, ...r.meta.duration !== void 0 ? { duration: r.meta.duration } : {}, via: r.meta.via, dir: r.dir, reused: r.reused } : { ...base2, reason: r.reason };
  });
  const corpus = { source: url, ...listed.title ? { title: listed.title } : {}, createdAt: (/* @__PURE__ */ new Date()).toISOString(), videos };
  let path;
  try {
    ensureDir(root);
    writeArtifact(join6(root, "corpus.json"), `${JSON.stringify(corpus, null, 2)}
`);
    path = writeArtifact(join6(root, "CORPUS.md"), corpusMarkdown(corpus, root));
  } catch (e) {
    return { ok: false, reason: `cannot write the corpus in ${root}: ${e.message}` };
  }
  return { ok: true, dir: root, corpus: path, videos, ...listed.title ? { title: listed.title } : {} };
}
var AMBIGUOUS_TYPES = /* @__PURE__ */ new Set([
  "",
  "application/octet-stream",
  "binary/octet-stream",
  "application/x-download",
  "application/force-download",
  "application/download",
  "application/unknown",
  "application/zip",
  "application/x-zip-compressed"
]);
var SNIFFABLE_MIME = /* @__PURE__ */ new Set(["text/html", "application/xhtml+xml", ...AMBIGUOUS_TYPES]);
var CP1252_C1 = [
  8364,
  129,
  8218,
  402,
  8222,
  8230,
  8224,
  8225,
  710,
  8240,
  352,
  8249,
  338,
  141,
  381,
  143,
  144,
  8216,
  8217,
  8220,
  8221,
  8226,
  8211,
  8212,
  732,
  8482,
  353,
  8250,
  339,
  157,
  382,
  376
];
var NAMED = `
  quot 22 amp 26 apos 27 lt 3c gt 3e QUOT 22 AMP 26 LT 3c GT 3e COPY a9 REG ae
  nbsp a0 iexcl a1 cent a2 pound a3 curren a4 yen a5 brvbar a6 sect a7 uml a8 copy a9 ordf aa laquo ab not ac shy ad reg ae macr af
  deg b0 plusmn b1 sup2 b2 sup3 b3 acute b4 micro b5 para b6 middot b7 cedil b8 sup1 b9 ordm ba raquo bb frac14 bc frac12 bd frac34 be iquest bf
  Agrave c0 Aacute c1 Acirc c2 Atilde c3 Auml c4 Aring c5 AElig c6 Ccedil c7 Egrave c8 Eacute c9 Ecirc ca Euml cb Igrave cc Iacute cd Icirc ce Iuml cf
  ETH d0 Ntilde d1 Ograve d2 Oacute d3 Ocirc d4 Otilde d5 Ouml d6 times d7 Oslash d8 Ugrave d9 Uacute da Ucirc db Uuml dc Yacute dd THORN de szlig df
  agrave e0 aacute e1 acirc e2 atilde e3 auml e4 aring e5 aelig e6 ccedil e7 egrave e8 eacute e9 ecirc ea euml eb igrave ec iacute ed icirc ee iuml ef
  eth f0 ntilde f1 ograve f2 oacute f3 ocirc f4 otilde f5 ouml f6 divide f7 oslash f8 ugrave f9 uacute fa ucirc fb uuml fc yacute fd thorn fe yuml ff
  OElig 152 oelig 153 Scaron 160 scaron 161 Yuml 178 fnof 192 circ 2c6 tilde 2dc
  Alpha 391 Beta 392 Gamma 393 Delta 394 Epsilon 395 Zeta 396 Eta 397 Theta 398 Iota 399 Kappa 39a Lambda 39b Mu 39c Nu 39d Xi 39e Omicron 39f
  Pi 3a0 Rho 3a1 Sigma 3a3 Tau 3a4 Upsilon 3a5 Phi 3a6 Chi 3a7 Psi 3a8 Omega 3a9
  alpha 3b1 beta 3b2 gamma 3b3 delta 3b4 epsilon 3b5 zeta 3b6 eta 3b7 theta 3b8 iota 3b9 kappa 3ba lambda 3bb mu 3bc nu 3bd xi 3be omicron 3bf
  pi 3c0 rho 3c1 sigmaf 3c2 sigma 3c3 tau 3c4 upsilon 3c5 phi 3c6 chi 3c7 psi 3c8 omega 3c9 thetasym 3d1 upsih 3d2 piv 3d6
  ensp 2002 emsp 2003 thinsp 2009 zwnj 200c zwj 200d lrm 200e rlm 200f ndash 2013 mdash 2014 lsquo 2018 rsquo 2019 sbquo 201a
  ldquo 201c rdquo 201d bdquo 201e dagger 2020 Dagger 2021 bull 2022 hellip 2026 permil 2030 prime 2032 Prime 2033 lsaquo 2039 rsaquo 203a
  oline 203e frasl 2044 euro 20ac image 2111 weierp 2118 real 211c trade 2122 alefsym 2135
  larr 2190 uarr 2191 rarr 2192 darr 2193 harr 2194 crarr 21b5 lArr 21d0 uArr 21d1 rArr 21d2 dArr 21d3 hArr 21d4
  forall 2200 part 2202 exist 2203 empty 2205 nabla 2207 isin 2208 notin 2209 ni 220b prod 220f sum 2211 minus 2212 lowast 2217 radic 221a
  prop 221d infin 221e ang 2220 and 2227 or 2228 cap 2229 cup 222a int 222b there4 2234 sim 223c cong 2245 asymp 2248 ne 2260 equiv 2261
  le 2264 ge 2265 sub 2282 sup 2283 nsub 2284 sube 2286 supe 2287 oplus 2295 otimes 2297 perp 22a5 sdot 22c5
  lceil 2308 rceil 2309 lfloor 230a rfloor 230b lang 27e8 rang 27e9 loz 25ca spades 2660 clubs 2663 hearts 2665 diams 2666
`;
var INVISIBLE = /* @__PURE__ */ new Set([173, 8203, 8204, 8205, 8206, 8207, 8288, 65279]);
var charFor = (cp) => INVISIBLE.has(cp) ? "" : String.fromCodePoint(cp);
var ENTITY_BY_NAME = /* @__PURE__ */ new Map();
{
  const parts = NAMED.trim().split(/\s+/);
  for (let i = 0; i < parts.length; i += 2) ENTITY_BY_NAME.set(parts[i], charFor(Number.parseInt(parts[i + 1], 16)));
  ENTITY_BY_NAME.set("nbsp", " ");
}
var ENTITY_RE = /&(#[xX][0-9a-fA-F]+|#\d+|[a-zA-Z][a-zA-Z0-9]*);/g;
function numericChar(n) {
  if (n >= 128 && n <= 159) return String.fromCodePoint(CP1252_C1[n - 128]);
  if (n === 0 || !(n <= 1114111) || n >= 55296 && n <= 57343) return "\uFFFD";
  return charFor(n);
}
function decodeEntities(s) {
  return s.replace(ENTITY_RE, (m, ref) => {
    if (ref[0] !== "#") return ENTITY_BY_NAME.get(ref) ?? m;
    return numericChar(ref[1] === "x" || ref[1] === "X" ? Number.parseInt(ref.slice(2), 16) : Number(ref.slice(1)));
  });
}
var BLOCK_TAGS = /* @__PURE__ */ new Set([
  "p",
  "div",
  "section",
  "article",
  "li",
  "tr",
  "td",
  "th",
  "ul",
  "ol",
  "pre",
  "blockquote",
  "table",
  "caption",
  "dl",
  "dt",
  "dd",
  "header",
  "footer",
  "nav",
  "aside",
  "main",
  "search",
  "figure",
  "figcaption",
  "details",
  "summary",
  "address",
  "form",
  "fieldset",
  "legend",
  "hgroup",
  "center",
  "dialog",
  "menu"
]);
var INLINE_TAGS = /* @__PURE__ */ new Set([
  "a",
  "abbr",
  "acronym",
  "b",
  "bdi",
  "bdo",
  "big",
  "cite",
  "code",
  "data",
  "del",
  "dfn",
  "em",
  "font",
  "i",
  "ins",
  "kbd",
  "label",
  "mark",
  "nobr",
  "q",
  "s",
  "samp",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "time",
  "tt",
  "u",
  "var",
  "wbr"
]);
var SCRAPE_MAX_AGE_MS = 24 * 60 * 60 * 1e3;
var PROBE_DOWN_TTL_MS = 3e4;
var ProbeMemo = class {
  entries = /* @__PURE__ */ new Map();
  /** The verdict for `key`, probing when there is none or a "down" one expired. */
  get(key, probe) {
    const hit = this.entries.get(key);
    if (hit && (hit.downAt === void 0 || Date.now() - hit.downAt < PROBE_DOWN_TTL_MS)) return hit.verdict;
    const entry = { verdict: probe() };
    void entry.verdict.then((up) => {
      if (!up) entry.downAt = Date.now();
    });
    this.entries.set(key, entry);
    return entry.verdict;
  }
  markDown(key) {
    this.entries.set(key, { verdict: Promise.resolve(false), downAt: Date.now() });
  }
  clear() {
    this.entries.clear();
  }
};
var probeCache = new ProbeMemo();
var DEFAULT_MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
var INLINE_FORMAT = /* @__PURE__ */ new Set([...INLINE_TAGS, "br", "scp"]);
var PDF_FETCH_OPTS = { accept: "application/pdf,*/*", binary: true, maxBytes: 16 * 1024 * 1024 };
var DOC_FETCH_OPTS = { accept: "*/*", binary: true, maxBytes: 16 * 1024 * 1024 };
var STALE_STAGING_MS = 24 * 60 * 60 * 1e3;
var MAX_BODY_BYTES = 4 * 1024 * 1024;
var NPM_TIME_TAIL_FIRST_BYTES = 256 * 1024;
var NPM_TIME_TAIL_BYTES = 2 * 1024 * 1024;
var ROBOTS_TTL_MS = 24 * 60 * 60 * 1e3;
var UNREACHABLE_TTL_MS = 5 * 60 * 1e3;
var HTML_ELEMENTS = /* @__PURE__ */ new Set([...BLOCK_TAGS, ...INLINE_TAGS, "br", "hr", "img", "h1", "h2", "h3", "h4", "h5", "h6"]);
var SITEMAP_MAX_BYTES = 50 * 1024 * 1024;
var gunzipAsync = promisify(gunzip);
var INLINE_TAG = /<\/?(?:a|abbr|b|bdi|bdo|cite|code|em|i|kbd|mark|q|s|samp|small|span|strong|sub|sup|time|u|var|wbr)\b[^<>]*>/gi;
function stripTags(s) {
  return decodeEntities(s.replace(INLINE_TAG, "").replace(/<[^<>]*>/g, " ")).replace(/\s+/g, " ").trim();
}
function ddgRedirectTarget(href) {
  const uddg = /[?&]uddg=([^&]+)/.exec(href);
  if (uddg) {
    try {
      return decodeURIComponent(uddg[1]);
    } catch {
    }
  }
  return href.startsWith("//") ? `https:${href}` : href;
}
var attrPattern = (name) => new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>=\`]+))`, "i");
var HREF_ATTR = attrPattern("href");
var CLASS_ATTR = attrPattern("class");
var NAME_ATTR = attrPattern("name");
var TYPE_ATTR = attrPattern("type");
var VALUE_ATTR = attrPattern("value");
function attr2(attrs, re) {
  const m = re.exec(attrs);
  return m ? decodeEntities(m[1] ?? m[2] ?? m[3] ?? "") : void 0;
}
function hasClass(attrs, cls) {
  return (attr2(attrs, CLASS_ATTR) ?? "").split(/\s+/).includes(cls);
}
function hostIs(url, domain) {
  try {
    const host = new URL(url).hostname;
    return host === domain || host.endsWith(`.${domain}`);
  } catch {
    return false;
  }
}
var OPEN_A = /<a\b([^<>]*)>/gi;
var element = (tag, cls) => ({ open: new RegExp(`<${tag}\\b([^<>]*)>`, "gi"), close: new RegExp(`</${tag}\\s*>`, "i"), cls });
function parseBlocks(body, limit, shape) {
  const anchors = [];
  for (const m of body.matchAll(OPEN_A)) {
    if (hasClass(m[1], shape.anchor)) anchors.push({ start: m.index, end: m.index + m[0].length, attrs: m[1] });
  }
  const found = [];
  for (let i = 0; i < anchors.length && found.length < limit; i++) {
    const a = anchors[i];
    const block = body.slice(a.end, anchors[i + 1]?.start ?? body.length);
    const close = /<\/a\s*>/i.exec(block);
    const href = attr2(a.attrs, HREF_ATTR);
    if (!close || !href) continue;
    const url = shape.resolve(href);
    if (!url) continue;
    const rest = block.slice(close.index + close[0].length);
    found.push({ url, title: stripTags(block.slice(0, close.index)) || url, snippet: elementText(rest, shape.snippet) });
  }
  return found;
}
function elementText(html, el) {
  for (const m of html.matchAll(el.open)) {
    if (!hasClass(m[1], el.cls)) continue;
    const inner = html.slice(m.index + m[0].length);
    const end = el.close.exec(inner);
    return end ? stripTags(inner.slice(0, end.index)) : "";
  }
  return "";
}
function ddgDestination(href) {
  const url = ddgRedirectTarget(href);
  if (!/^https?:\/\//i.test(url)) return void 0;
  const unwrapped = url !== (href.startsWith("//") ? `https:${href}` : href);
  return unwrapped || !hostIs(url, "duckduckgo.com") ? url : void 0;
}
function parseDdgHtml(body, limit = 50) {
  return parseBlocks(body, limit, { anchor: "result__a", snippet: element("a", "result__snippet"), resolve: ddgDestination });
}
function parseDdgLite(body, limit = 50) {
  return parseBlocks(body, limit, { anchor: "result-link", snippet: element("td", "result-snippet"), resolve: ddgDestination });
}
function parseMojeek(body, limit = 50) {
  return parseBlocks(body, limit, {
    anchor: "title",
    snippet: element("p", "s"),
    // Mojeek links its results directly, so its own links are the ones on its
    // own host. Its blog, or a page ABOUT Mojeek, is a result like any other.
    resolve: (h) => {
      const url = h.startsWith("//") ? `https:${h}` : h;
      return /^https?:\/\//i.test(url) && !/^https?:\/\/(?:www\.)?mojeek\.com(?:[:/?#]|$)/i.test(url) ? url : void 0;
    }
  });
}
var OPEN_FORM = /<form\b[^<>]*>/gi;
var INPUT = /<input\b([^<>]*)>/gi;
function ddgNextForm(body) {
  const forms = [...body.matchAll(OPEN_FORM)];
  for (let i = 0; i < forms.length; i++) {
    const chunk = body.slice(forms[i].index + forms[i][0].length, forms[i + 1]?.index ?? body.length);
    const end = chunk.search(/<\/form\s*>/i);
    const fields = {};
    let next = false;
    for (const m of (end < 0 ? chunk : chunk.slice(0, end)).matchAll(INPUT)) {
      const value = attr2(m[1], VALUE_ATTR) ?? "";
      if (attr2(m[1], TYPE_ATTR)?.toLowerCase() === "submit") next ||= /^\s*next\b/i.test(value);
      else {
        const name = attr2(m[1], NAME_ATTR);
        if (name) fields[name] = value;
      }
    }
    if (next) return fields;
  }
  return void 0;
}
function ddgNext(endpoint) {
  return (body, q, kl, p) => {
    const form = ddgNextForm(body);
    if (!form) return null;
    return `${endpoint}?${new URLSearchParams({ ...form, q, kl, s: form.s || String((p + 1) * 10) })}`;
  };
}
function mojeekLocaleParams(locale) {
  if (!locale) return "";
  const lang = `&lb=${encodeURIComponent(locale.lang)}&lbb=100`;
  return locale.region === "WT" ? lang : `${lang}&rb=${encodeURIComponent(locale.region)}&rbb=10`;
}
var SPECS = {
  // Page one only: every later page is the one the previous page's own Next
  // form names (see ddgNextForm).
  ddg: {
    label: "DuckDuckGo",
    url: (q, _p, kl) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}&kl=${encodeURIComponent(kl)}`,
    parse: parseDdgHtml,
    next: ddgNext("https://html.duckduckgo.com/html/")
  },
  ddglite: {
    label: "DuckDuckGo Lite",
    url: (q, _p, kl) => `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(q)}&kl=${encodeURIComponent(kl)}`,
    parse: parseDdgLite,
    next: ddgNext("https://lite.duckduckgo.com/lite/")
  },
  // Mojeek's `s` is the 1-BASED index of the first result, 10 per page — so
  // page 2 starts at 11, not 10. Its own crawler and index, which is why it is
  // worth asking at all: it surfaces pages the DDG family does not have.
  mojeek: {
    label: "Mojeek",
    url: (q, p, _kl, locale) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}${p > 0 ? `&s=${p * 10 + 1}` : ""}${mojeekLocaleParams(locale)}`,
    parse: parseMojeek
  }
};
var probeCache2 = new ProbeMemo();
var DEFAULT_TTL_MS = 24 * 60 * 60 * 1e3;
var PDF_CACHE_NS = "pdf";
var DOC_CACHE_NS = "doc";
var VIDEO_CACHE_NS = "video";
var DOCUMENT_NAMESPACES = [PDF_CACHE_NS, DOC_CACHE_NS, VIDEO_CACHE_NS, "pdf-inspector", "pdftotext", "anydoc", "ocr"];
var WRITTEN_NAMESPACES = ["native", "firecrawl", ...DOCUMENT_NAMESPACES];
var ORPHAN_GRACE_MS = 10 * 60 * 1e3;
var MODEL_PULL_TIMEOUT_MS = 6e5;
function embedModel() {
  return env("EMBED_MODEL") ?? "nomic-embed-text";
}
var STACKS = {
  searxng: {
    profiles: ["search"],
    summary: "SearXNG is up (:8888) \u2014 keyless discovery, JSON API enabled."
  },
  firecrawl: {
    profiles: ["search", "extract"],
    summary: "Firecrawl is up (:3002 \xB7 playwright \xB7 redis \xB7 rabbitmq \xB7 postgres), with SearXNG behind it.",
    postUp: () => [
      "  keyless: USE_DB_AUTHENTICATION=false \u2014 no API key is sent or needed.",
      "  effect:  pages are now cleaned by a real browser; --firecrawl off opts out."
    ]
  },
  semantic: {
    profiles: ["semantic"],
    summary: "Qdrant (:6333) and Ollama (:11434) are up.",
    postUp: (file, run2) => {
      const model = embedModel();
      const pull = run2("docker", ["compose", "-f", file, "exec", "-T", "ollama", "ollama", "pull", model], { timeoutMs: MODEL_PULL_TIMEOUT_MS, capture: true });
      return [pull.ok ? `  model:   ${model} ready` : `  model:   pull it yourself: docker compose -f ${file} exec ollama ollama pull ${model}`];
    }
  },
  all: {
    profiles: ["all", "extract"],
    summary: "The whole stack is up (Qdrant \xB7 Ollama \xB7 SearXNG \xB7 Firecrawl).",
    postUp: (file, run2) => STACKS.semantic.postUp(file, run2)
  }
};
var STACK_SERVICES = Object.keys(STACKS);
var SERVICE_PROFILES = Object.fromEntries(Object.entries(STACKS).map(([k, v]) => [k, v.profiles]));
var FINGERPRINT_MAX_BYTES = 64 * 1024 * 1024;
var MAX_TIMER_MS = 2 ** 31 - 1;
var TOKEN_RE2 = /\[([^\]\n]+)\](?!\()/g;
function stripHtmlComments(text) {
  return text.replace(/<!--[\s\S]*?-->/g, (m) => m.replace(/[^\n]/g, " "));
}
function stripInlineCode(line) {
  return line.replace(/`[^`\n]*`/g, " ");
}
function codeMask(lines) {
  const mask = new Array(lines.length).fill(false);
  let open;
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(`{3,}|~{3,})(.*)$/.exec(lines[i]);
    if (!open) {
      if (m && !(m[1][0] === "`" && m[2].includes("`"))) {
        open = { ch: m[1][0], len: m[1].length };
        mask[i] = true;
      }
      continue;
    }
    mask[i] = true;
    if (m && m[1][0] === open.ch && m[1].length >= open.len && m[2].trim() === "") open = void 0;
  }
  return mask;
}
var isHeadingOrRule = (t) => /^#{1,6}\s/.test(t) || /^([-*_])\1{2,}$/.test(t);
var isTableSeparator = (line) => /\|/.test(line) && /^[\s:|-]+$/.test(line.trim()) && /-/.test(line);
var isTableRow = (line) => /\|/.test(line.trim()) && !isTableSeparator(line);
var isListItem = (line) => /^\s*([-*+]|\d+\.)\s+\S/.test(line);
var isReferenceDefinition = (line) => /^ {0,3}\[[^\]\n]+\]:[ \t]*(?:<[^>\n]*>|\S+)(?:[ \t]+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?[ \t]*$/.test(line);
function tableCells(line) {
  return line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()).join(" ");
}
function extractClaimUnits(text, opts = {}) {
  const lines = stripHtmlComments(text).split("\n");
  const code = codeMask(lines);
  const extra = opts.exclude ? opts.exclude(lines) : [];
  const skip = (i2) => code[i2] === true || extra[i2] === true;
  const quoteMode = opts.blockquotes ?? "unit";
  const skipHeader = opts.skipTableHeader !== false;
  const stored = (raw) => opts.keepInlineCode ? raw : stripInlineCode(raw);
  const units = [];
  let prose = [];
  let section;
  const tag = (u) => section === void 0 ? u : { ...u, section };
  const flush = () => {
    if (prose.length) units.push(tag({ kind: "text", text: prose.join(" ") }));
    prose = [];
  };
  let i = 0;
  while (i < lines.length) {
    if (skip(i)) {
      flush();
      i++;
      continue;
    }
    const raw = lines[i];
    const line = stripInlineCode(raw);
    const t = line.trim();
    if (!prose.length && isReferenceDefinition(raw)) {
      i++;
      continue;
    }
    if (t === "" || isHeadingOrRule(t) || isTableSeparator(line)) {
      flush();
      if (/^#{1,6}\s/.test(t)) section = opts.sectionTag?.(t);
      i++;
      continue;
    }
    if (isTableRow(line)) {
      flush();
      const next = i + 1 < lines.length && !skip(i + 1) ? stripInlineCode(lines[i + 1]) : "";
      if (!(skipHeader && isTableSeparator(next))) units.push(tag({ kind: "text", text: tableCells(stored(raw)) }));
      i++;
      continue;
    }
    if (/^\s*>/.test(line)) {
      if (quoteMode === "prose") {
        const dequoted = stored(raw).replace(/^\s*>\s?/, "").trim();
        if (dequoted) prose.push(dequoted);
        i++;
        continue;
      }
      flush();
      const quoted = [];
      while (i < lines.length && !skip(i)) {
        if (!/^\s*>/.test(stripInlineCode(lines[i]))) break;
        const dq = stored(lines[i]).replace(/^\s*>\s?/, "").trim();
        if (dq) quoted.push(dq);
        i++;
      }
      if (quoted.length) units.push(tag({ kind: "text", text: quoted.join(" ") }));
      continue;
    }
    if (isListItem(line)) {
      flush();
      const items = [];
      while (i < lines.length && !skip(i)) {
        const rawL = lines[i];
        const l = stripInlineCode(rawL);
        const tt = l.trim();
        if (tt === "" || isHeadingOrRule(tt) || isTableSeparator(l) || isTableRow(l)) break;
        if (isListItem(l))
          items.push(
            stored(rawL).replace(/^\s*([-*+]|\d+\.)\s+/, "").trim()
          );
        else if (items.length) items[items.length - 1] += ` ${stored(rawL).trim()}`;
        else items.push(stored(rawL).trim());
        i++;
      }
      units.push(tag({ kind: "list", items }));
      continue;
    }
    prose.push(stored(raw));
    i++;
  }
  flush();
  return units;
}
function unitTexts(unit) {
  return unit.kind === "text" ? [unit.text] : unit.items;
}
function citationTokensIn(text, isCitation) {
  const masked = stripInlineCode(text);
  const out = [];
  for (const m of masked.matchAll(TOKEN_RE2)) {
    for (const tok of citationsInBracket(m[1], isCitation)) if (!out.includes(tok)) out.push(tok);
  }
  return out;
}
function citationsInBracket(inner, isCitation) {
  const tok = inner.trim();
  const unwrapped = tok.startsWith("[") ? tok.slice(1).trim() : tok;
  const parts = unwrapped.split(/[,;]/).map((p) => p.trim());
  if (parts.length > 1 && parts.every((p) => isCitation(p))) return parts;
  if (isCitation(tok)) return [tok];
  return unwrapped !== tok && isCitation(unwrapped) ? [unwrapped] : [];
}
function collectCitations(text, isCitation, opts = {}) {
  const grounding = [];
  for (const unit of extractClaimUnits(text, opts)) {
    for (const part of unitTexts(unit)) {
      for (const tok of citationTokensIn(part, isCitation)) if (!grounding.includes(tok)) grounding.push(tok);
    }
  }
  const all = [];
  for (const m of text.matchAll(TOKEN_RE2)) {
    for (const tok of citationsInBracket(m[1], isCitation)) if (!all.includes(tok)) all.push(tok);
  }
  return { grounding, inertOnly: all.filter((t) => !grounding.includes(t)) };
}
var EXIT_OK = 0;
var EXIT_FAILURE = 1;
var EXIT_USAGE = 2;
var UsageError = class extends Error {
  exitCode = EXIT_USAGE;
};
function parseArgs(argv, spec) {
  const commands = new Set(spec.commands);
  const valueFlags = new Set(spec.valueFlags);
  const boolFlags = new Set(spec.boolFlags);
  if (argv.length === 0) return { kind: "help" };
  if (isHelpWord(argv[0])) return argv[1] !== void 0 && commands.has(argv[1]) ? { kind: "help", command: argv[1] } : { kind: "help" };
  if (isVersionWord(argv[0])) return { kind: "version" };
  const command = argv[0];
  if (!commands.has(command)) {
    throw new UsageError(`unknown command "${command}" \u2014 run --help for the supported commands`);
  }
  const values = {};
  const bools = /* @__PURE__ */ new Set();
  const positional = [];
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--") {
      positional.push(...argv.slice(i + 1));
      break;
    }
    if (!arg.startsWith("--") && arg !== "-h" && arg !== "-v") {
      positional.push(arg);
      continue;
    }
    const eq = arg.indexOf("=");
    const key = eq !== -1 ? arg.slice(2, eq) : arg.slice(2);
    if (!boolFlags.has(key) && !valueFlags.has(key)) {
      if (isHelpWord(arg)) return { kind: "help", command };
      if (isVersionWord(arg)) return { kind: "version" };
    }
    if (boolFlags.has(key)) {
      if (eq !== -1) throw new UsageError(`--${key} is a boolean flag and takes no value`);
      bools.add(key);
      continue;
    }
    if (!valueFlags.has(key)) {
      throw new UsageError(`unknown flag "--${key}" \u2014 run --help for the supported options`);
    }
    if (eq !== -1) {
      values[key] = arg.slice(eq + 1);
      continue;
    }
    const next = argv[i + 1];
    if (next === void 0 || next.startsWith("--")) {
      throw new UsageError(`missing value for --${key}`);
    }
    values[key] = next;
    i++;
  }
  return { kind: "command", command, positional, values, bools };
}
function isHelpWord(a) {
  return a === "--help" || a === "-h" || a === "help";
}
function isVersionWord(a) {
  return a === "--version" || a === "-v" || a === "version";
}
function argValue(p, name) {
  return p.values[name];
}
function argBool(p, name) {
  return p.bools.has(name);
}
function argInt(p, name, range = {}) {
  const raw = p.values[name];
  if (raw === void 0) return void 0;
  const n = raw.trim() ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || !Number.isInteger(n)) {
    throw new UsageError(`--${name} expects a whole number, got "${raw}"`);
  }
  const { min, max } = range;
  if (min !== void 0 && n < min || max !== void 0 && n > max) {
    const bound = min !== void 0 && max !== void 0 ? `from ${min} to ${max}` : min !== void 0 ? `of at least ${min}` : `of at most ${max}`;
    throw new UsageError(`--${name} expects a whole number ${bound}, got "${raw}"`);
  }
  return n;
}
function jsonLine(value) {
  return `${JSON.stringify(value, null, 2)}
`;
}
function isInvokedDirectly(argv1 = process.argv[1], cli = brand().cli) {
  if (!argv1) return false;
  return basename2(argv1).replace(/\.(mjs|cjs|js)$/, "") === cli;
}
var PROTOCOL_VERSIONS = ["2024-11-05", "2025-03-26", "2025-06-18", "2025-11-25"];
var LATEST_PROTOCOL = PROTOCOL_VERSIONS[PROTOCOL_VERSIONS.length - 1];
var MAX_BODY_BYTES2 = 4 * 1024 * 1024;
var DRAIN_LIMIT = MAX_BODY_BYTES2 * 8;

// src/engine.ts
configure({
  name: "ultrawatch",
  envPrefix: "ULTRAWATCH",
  cli: "ultrawatch",
  contactUrl: "https://github.com/maxgfr/ultrawatch"
});

// src/check.ts
var CLAIM_MIN_WORDS = 6;
var SLACK_S = 5;
var STAMP = /^V(\d+) ((?:\d+:)?\d{1,2}:\d{2})$/;
var META = /^(?:V(\d+) )?M$/;
var BARE_STAMP = /^(?:\d+:)?\d{1,2}:\d{2}$/;
function isVideoCitation(token) {
  return STAMP.test(token) || META.test(token);
}
function stampSeconds(stamp) {
  return stamp.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}
function normalizeCitations(answer) {
  return answer.replace(/\[([^\]\n]+)\](\([^)\s]*\))?/g, (whole, inner, link) => {
    const parts = inner.split(/[;,]/).map((p) => p.trim());
    let video;
    const out = [];
    for (const p of parts) {
      const m = STAMP.exec(p) ?? META.exec(p);
      if (m) {
        video = m[1] !== void 0 ? `V${m[1]}` : video;
        out.push(p);
      } else if (video && BARE_STAMP.test(p)) out.push(`${video} ${p}`);
      else return whole;
    }
    return link !== void 0 || out.join("; ") !== inner ? `[${out.join("; ")}]` : whole;
  });
}
var readJson2 = (path) => {
  try {
    return JSON.parse(readFileSync2(path, "utf8"));
  } catch {
    return void 0;
  }
};
function checked(label, dir) {
  const run2 = readVideoRun(dir);
  if (!run2) return { label, unread: `no run in ${dir}` };
  const frames = readJson2(join(dir, "frames.json"));
  return {
    label,
    meta: run2.meta,
    segments: run2.segments,
    ...Array.isArray(frames) ? { frames: frames.map((f) => Number(f.time)).filter(Number.isFinite) } : {}
  };
}
function videosOf(dir, videos) {
  const out = /* @__PURE__ */ new Map();
  if (videos?.length) {
    videos.forEach((id, i) => out.set(`V${i + 1}`, checked(`V${i + 1}`, join(dir, id))));
    return out;
  }
  if (readVideoRun(dir)) return /* @__PURE__ */ new Map([["V1", checked("V1", dir)]]);
  if (existsSync(join(dir, "corpus.json"))) {
    const corpus = readJson2(join(dir, "corpus.json"));
    if (!Array.isArray(corpus?.videos)) return { error: `${join(dir, "corpus.json")} is not a readable corpus \u2014 run \`ultrawatch list\` again` };
    for (const v of corpus.videos) {
      if (typeof v.label !== "string" || typeof v.id !== "string") continue;
      const c = checked(v.label, join(dir, v.id));
      out.set(v.label, c.unread ? { label: v.label, unread: typeof v.reason === "string" ? v.reason : "not read" } : c);
    }
    return out;
  }
  const runs = listVideoRuns(dir);
  if (runs.length === 1) return /* @__PURE__ */ new Map([["V1", checked("V1", runs[0].dir)]]);
  if (runs.length > 1) {
    return {
      error: `${dir} holds ${runs.length} videos and no corpus \u2014 pass --videos <id,id,\u2026> to say which is V1, V2\u2026 (${runs.map((r) => r.meta.id).join(", ")})`
    };
  }
  return { error: `${dir} is neither a video run (meta.json, segments.json) nor a corpus (corpus.json)` };
}
var NOTE_KINDS = /* @__PURE__ */ new Set(["inert", "meta-only"]);
var words = (t) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
var SOURCES_HEADING = /^#{1,6}\s+(?:sources?|references?|citations?|liens?|références?|bibliograph\w*)\b/i;
function closingSourcesMask(lines) {
  const mask = lines.map(() => false);
  const headings = lines.map((l, i) => /^#{1,6}\s/.test(l.trim()) ? i : -1).filter((i) => i >= 0);
  const last = headings[headings.length - 1];
  if (last !== void 0 && SOURCES_HEADING.test(lines[last].trim())) for (let i = last; i < lines.length; i++) mask[i] = true;
  return mask;
}
function lineFinder(lines) {
  const flat = lines.map(
    (l) => l.replace(/`/g, "").replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, "").replace(/\|/g, " ").replace(/\s+/g, " ").trim()
  );
  let cursor = 0;
  return (text) => {
    const probe = text.replace(/`/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!probe) return void 0;
    for (const from of [cursor, 0]) {
      for (let i = from; i < flat.length; i++) {
        const l = flat[i];
        if (l && (l.includes(probe) || l.length >= 10 && probe.startsWith(l.slice(0, 30)))) {
          cursor = i + 1;
          return i + 1;
        }
      }
    }
    return void 0;
  };
}
function checkAnswer(dir, rawAnswer, opts = {}) {
  const videos = videosOf(dir, opts.videos);
  if ("error" in videos) return videos;
  const answer = normalizeCitations(rawAnswer);
  const lines = answer.split(/\r?\n/);
  const lineOf = lineFinder(lines);
  const problems = [];
  const unitOpts = { exclude: closingSourcesMask };
  const units = extractClaimUnits(answer, unitOpts);
  let claims = 0;
  const cited = /* @__PURE__ */ new Set();
  for (const unit of units) {
    for (const text of unitTexts(unit)) {
      const tokens = citationTokensIn(text, isVideoCitation);
      const line = lineOf(text);
      for (const t of tokens) cited.add(t);
      if (words(text.replace(/\[[^\]]*\]/g, " ")) >= CLAIM_MIN_WORDS) {
        claims++;
        const quote = text.length > 70 ? `${text.slice(0, 67)}\u2026` : text;
        if (!tokens.length) problems.push({ line, kind: "uncited", message: `uncited claim \u2014 "${quote}"` });
        else if (tokens.every((t) => META.test(t)))
          problems.push({
            line,
            kind: "meta-only",
            message: `grounded only by the header [M] \u2014 fine for a title, a date or a duration, not for what the video says: "${quote}"`
          });
      }
      for (const tok of tokens) problems.push(...judge(tok, videos, line));
    }
  }
  if (!claims) problems.push({ kind: "empty", message: "the answer makes no claim to check \u2014 nothing outside headings, code and a closing sources list" });
  const { inertOnly } = collectCitations(answer, isVideoCitation, unitOpts);
  for (const tok of inertOnly) problems.push({ kind: "inert", message: `[${tok}] appears only in code or in a sources list, where it grounds no claim` });
  problems.sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER));
  return { claims, citations: cited.size, videos: videos.size, problems };
}
function judge(tok, videos, line) {
  const stamp = STAMP.exec(tok);
  const metaVideo = META.exec(tok)?.[1];
  const label = stamp ? `V${stamp[1]}` : metaVideo ? `V${metaVideo}` : "V1";
  if (!stamp && !metaVideo && videos.size > 1) return [];
  const v = videos.get(label);
  if (!v) return [{ line, kind: "unknown-video", message: `[${tok}] \u2014 ${label} is not in this run (it holds ${[...videos.keys()].join(", ")})` }];
  if (v.unread) return [{ line, kind: "unread-video", message: `[${tok}] \u2014 ${label} was never read (${v.unread}), so it grounds nothing` }];
  if (!stamp) return [];
  const t = stampSeconds(stamp[2]);
  const duration = v.meta?.duration;
  if (duration !== void 0 && t > duration + 1) return [{ line, kind: "past-end", message: `[${tok}] \u2014 ${label} is only ${formatStamp(duration)} long` }];
  const said = (v.segments ?? []).some((s) => t >= Math.floor(s.start) - SLACK_S && t <= s.end + SLACK_S);
  const shown = (v.frames ?? []).some((f) => Math.abs(Math.floor(f) - t) <= SLACK_S);
  if (said || shown) return [];
  return [{ line, kind: "no-segment", message: `[${tok}] \u2014 nothing is said or shown in ${label} around ${stamp[2]} (\xB1${SLACK_S} s)` }];
}

// src/version.ts
var VERSION = "1.0.0";

// src/cli.ts
var HELP = `ultrawatch v${VERSION} (webindex ${ENGINE_VERSION})
Watch YouTube for an agent: a video, a playlist or a channel turned into
timestamped transcripts and on-screen frames, kept on disk, searchable, and
checked \u2014 every claim cites a [V# mm:ss] stamp that exists. Local and keyless.

USAGE
  ultrawatch fetch <url> [--out <dir>] [--lang <tag>] [--refresh] [--json]
  ultrawatch search <query> [--out <dir>] [--limit <n>] [--videos <id,id,\u2026>] [--json]
  ultrawatch frames <url|id|dir> [--effort low|med|high] [--out <dir>] [--lang <tag>] [--json]
  ultrawatch list <playlist|channel> [--limit <n>] [--out <dir>] [--lang <tag>] [--refresh] [--json]
  ultrawatch check <run> <answer.md> [--videos <id,id,\u2026>] [--json]
  ultrawatch doctor [--json]
  ultrawatch version

COMMANDS
  fetch    Read one video into <dir>/<id>/: TRANSCRIPT.md (header, a heading
           per chapter, a [mm:ss] stamp per paragraph), segments.json and
           meta.json. Manual subtitles, else the video's own auto-captions
           (never a machine translation), else a local whisper transcription.
           A video already on disk is reused without touching YouTube;
           --refresh reads it again, --lang picks the subtitle language.
  search   Rank ~45 s passages of every video under the directory \u2014 or of a
           corpus, labelled V1\u2026Vn \u2014 against a question: each with its stamp,
           chapter and a link that opens the video there. For follow-up
           questions, without reading the video again. Hits are labelled as
           an answer cites them: V1 for a single video, V1\u2026Vn in a corpus or
           in the order --videos gives.
  frames   What is on screen: a frame at every scene change and chapter start,
           near-duplicates dropped, at most 20/50/100 by --effort (med), in
           <id>/frames/, with FRAMES.md pairing each with what was said from
           5 s before to 10 s after. Needs ffmpeg.
  list     Read the first --limit videos (default 10) of a playlist or channel,
           two at a time, and write CORPUS.md naming them V1\u2026Vn.
  check    Check an answer against its run: every claim of six words or more
           cites [V# mm:ss] (or [M] for the header's facts), every V# exists
           and was read, every stamp falls inside the video and on something
           said or shown (\xB15 s of a segment or a kept frame). <run> is a
           video's directory, a corpus, or a directory of videos fetched one
           by one with --videos naming V1, V2\u2026 in order. Exits 1 with a
           line-by-line report otherwise; an answer with no claim fails too.
  doctor   yt-dlp (and how old it is), ffmpeg, uvx, the whisper model, the
           transcript rungs, and where runs are kept.

The directory is --out, else ULTRAWATCH_VIDEO_DIR, else <tmp>/ultrawatch/video.

ENVIRONMENT
  ULTRAWATCH_VIDEO_DIR      where runs are kept
  ULTRAWATCH_VIDEO_ENGINES  the transcript rungs, in order: manual-subs,auto-subs,whisper, or none
  ULTRAWATCH_WHISPER_MODEL, ULTRAWATCH_WHISPER_MAX, ULTRAWATCH_WHISPER_TIMEOUT_MS
                            whisper's model (small), videos per process (3), one video's budget (1800000)
  ULTRAWATCH_YTDLP_ARGS     extra yt-dlp flags on every call: browser cookies, a proxy
  ULTRAWATCH_NO_WRITE       write nothing: fetch prints the transcript, frames and list refuse

Nothing here needs an API key. yt-dlp is required; ffmpeg and uv (uvx) unlock
frames and whisper.`;
var VALUE_FLAGS = ["out", "lang", "limit", "effort", "videos"];
var BOOL_FLAGS = ["json", "refresh"];
var COMMANDS = ["fetch", "search", "frames", "list", "check", "doctor"];
var SPEC = { commands: COMMANDS, valueFlags: VALUE_FLAGS, boolFlags: BOOL_FLAGS };
var YTDLP_STALE_DAYS = 60;
function fail(msg, code = EXIT_FAILURE) {
  process.stderr.write(`ultrawatch: ${msg}
`);
  process.exit(code);
}
function videoList(args) {
  const raw = argValue(args, "videos");
  if (raw === void 0) return void 0;
  const ids = raw.split(",").map((s) => s.trim()).filter(Boolean);
  if (!ids.length || ids.some((id) => !/^[\w-]{11}$/.test(id))) usage(`--videos takes YouTube video ids separated by commas, not "${raw}"`);
  return ids;
}
function citeLabels(root, videos) {
  if (videos) return new Map(videos.map((id, i) => [id, `V${i + 1}`]));
  if (existsSync5(join7(root, "corpus.json"))) return void 0;
  const runs = listVideoRuns(root);
  return runs.length === 1 ? /* @__PURE__ */ new Map([[runs[0].meta.id, "V1"]]) : void 0;
}
function usage(msg) {
  return fail(msg, EXIT_USAGE);
}
var plural2 = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
function arity(args) {
  if (args.command === "search") return Number.POSITIVE_INFINITY;
  if (args.command === "check") return 2;
  if (args.command === "doctor") return 0;
  return 1;
}
async function run(args) {
  const cmd = args.command;
  const root = videoRoot(argValue(args, "out"));
  const asJson = argBool(args, "json");
  if (cmd === "fetch") {
    const url = args.positional[0];
    if (!url) usage("usage: ultrawatch fetch <url> [--out <dir>] [--lang <tag>] [--refresh] [--json]");
    const r = await fetchVideoRun(url, root, { refresh: argBool(args, "refresh"), lang: argValue(args, "lang") });
    if (!r.ok) {
      if (asJson) process.stdout.write(jsonLine(r));
      fail(`no transcript for ${url}: ${r.reason}`);
    }
    if (asJson) process.stdout.write(jsonLine({ ...r, title: r.meta.title, via: r.meta.via, duration: r.meta.duration }));
    else if (isNoWrite()) process.stdout.write(r.markdown ?? readFileSync7(r.transcript, "utf8"));
    else {
      const m = r.meta;
      const facts = [m.channel, m.duration !== void 0 ? formatStamp(m.duration) : void 0, m.via, plural2(r.segments, "segment")].filter(Boolean).join(" \xB7 ");
      process.stdout.write(`${r.transcript}
  ${m.title} \u2014 ${facts}${r.reused ? " (already on disk)" : ""}
`);
    }
    return;
  }
  if (cmd === "search") {
    const query = args.positional.join(" ").trim();
    if (!query) usage("usage: ultrawatch search <query> [--out <dir>] [--limit <n>] [--json]");
    const hits = searchVideoRuns(root, query, { limit: argInt(args, "limit", { min: 1 }) ?? 10, labels: citeLabels(root, videoList(args)) });
    if (asJson) process.stdout.write(jsonLine({ dir: root, query, hits }));
    else for (const h of hits) process.stdout.write(`[${h.label} ${h.stamp}] ${h.title}${h.chapter ? ` \u2014 ${h.chapter}` : ""}
  ${h.url}
  ${h.text}

`);
    if (!hits.length) fail(`nothing under ${root} matches "${query}" \u2014 \`ultrawatch fetch <url>\` reads a video first`);
    return;
  }
  if (cmd === "frames") {
    const target = args.positional[0];
    if (!target) usage("usage: ultrawatch frames <url|id|dir> [--effort low|med|high] [--out <dir>] [--json]");
    const effort = argValue(args, "effort") ?? "med";
    if (!(effort in FRAME_EFFORT)) usage(`--effort must be low, med or high, not "${effort}"`);
    let runDir;
    if (youtubeVideoId(target)) {
      const r2 = await fetchVideoRun(target, root, { lang: argValue(args, "lang") });
      if (!r2.ok) fail(`no transcript for ${target}: ${r2.reason}`);
      runDir = r2.dir;
    } else runDir = existsSync5(join7(root, target, "meta.json")) ? join7(root, target) : resolve2(target);
    const r = await extractFrames(runDir, { effort });
    if (!r.ok) {
      if (asJson) process.stdout.write(jsonLine(r));
      fail(r.reason);
    }
    if (asJson) process.stdout.write(jsonLine(r));
    else
      process.stdout.write(
        `${r.markdown}
  ${plural2(r.frames.length, "frame")} in ${r.dir} (${plural2(r.candidates, "candidate")}, ${plural2(r.duplicates, "near-duplicate")} dropped, effort ${r.effort})
`
      );
    return;
  }
  if (cmd === "list") {
    const url = args.positional[0];
    if (!url) usage("usage: ultrawatch list <playlist|channel> [--limit <n>] [--out <dir>] [--refresh] [--json]");
    const r = await fetchVideoCorpus(url, root, {
      limit: argInt(args, "limit", { min: 1 }) ?? 10,
      refresh: argBool(args, "refresh"),
      lang: argValue(args, "lang"),
      onVideo: (done, total, title) => process.stderr.write(`  [${done}/${total}] ${title}
`)
    });
    if (!r.ok) {
      if (asJson) process.stdout.write(jsonLine(r));
      fail(r.reason);
    }
    if (asJson) process.stdout.write(jsonLine(r));
    else
      process.stdout.write(
        `${r.corpus}
${r.videos.map((v) => `  ${v.label.padEnd(4)}${v.dir ? `${(v.via ?? "").padEnd(12)}${v.title}` : `not read \u2014 ${v.reason}`}`).join("\n")}
`
      );
    if (!r.videos.some((v) => v.dir)) fail("none of the listed videos had a transcript");
    return;
  }
  if (cmd === "check") {
    const [dir, file] = args.positional;
    if (!dir || !file) usage("usage: ultrawatch check <run> <answer.md> [--videos <id,id,\u2026>] [--json]");
    const videos = videoList(args);
    let answer;
    try {
      answer = readFileSync7(file, "utf8");
    } catch {
      return fail(`cannot read ${file}`);
    }
    const r = checkAnswer(resolve2(dir), answer, { videos });
    if ("error" in r) fail(r.error);
    const failing = r.problems.filter((p) => !NOTE_KINDS.has(p.kind));
    if (asJson) process.stdout.write(jsonLine({ ok: failing.length === 0, ...r }));
    else {
      const head = `${plural2(r.claims, "claim")}, ${plural2(r.citations, "citation")}, ${plural2(r.videos, "video")}`;
      if (!failing.length) process.stdout.write(`ultrawatch check: OK \u2014 ${head}
`);
      else process.stdout.write(`ultrawatch check: ${plural2(failing.length, "problem")} in ${file} (${head})
`);
      for (const p of r.problems) process.stdout.write(`  ${p.line ? `line ${p.line}` : "note"}: ${p.message}
`);
    }
    if (failing.length) process.exit(EXIT_FAILURE);
    return;
  }
  if (cmd === "doctor") {
    const report = await doctorReport();
    if (asJson) process.stdout.write(jsonLine(report));
    else {
      const { ytdlp } = report;
      const found = "version" in ytdlp ? ytdlp : void 0;
      const age = found?.ageDays !== void 0 ? ` (${found.ageDays} days old${found.stale ? " \u2014 update it: `yt-dlp -U`, or your package manager" : ""})` : "";
      process.stdout.write(
        [
          `ultrawatch ${VERSION} (webindex ${ENGINE_VERSION})`,
          `  yt-dlp      ${found ? `${found.version}${age}` : "not installed \u2014 required: https://github.com/yt-dlp/yt-dlp"}`,
          `  ffmpeg      ${report.ffmpeg ? "installed" : "not installed \u2014 frames and whisper need it"}`,
          `  uvx         ${report.uvx ? "installed" : "not installed \u2014 whisper needs it (https://docs.astral.sh/uv/)"}`,
          `  whisper     model ${report.whisperModel}${report.ffmpeg && report.uvx ? "" : " (unavailable)"}`,
          `  rungs       ${report.rungs.map((r) => r.enabled ? r.id : `${r.id} (off: ${envName("VIDEO_ENGINES")})`).join(" \u2192 ")}`,
          `  videos      ${report.videoDir}`,
          ""
        ].join("\n")
      );
    }
    if (!("version" in report.ytdlp)) process.exit(EXIT_FAILURE);
    return;
  }
}
async function doctorReport(tools = {}) {
  const has = tools.has ?? have;
  const ytdlp = await ytdlpVersionAge(tools.run);
  const rungs = enabledTranscribers();
  return {
    version: VERSION,
    engine: ENGINE_VERSION,
    ytdlp: ytdlp ? { ...ytdlp, stale: (ytdlp.ageDays ?? 0) > YTDLP_STALE_DAYS } : { state: "not installed" },
    ffmpeg: has("ffmpeg"),
    uvx: has("uvx"),
    whisperModel: whisperModel(),
    rungs: VIDEO_TRANSCRIBERS.map((id) => ({ id, enabled: rungs.includes(id) })),
    videoDir: videoRoot()
  };
}
async function main(argv) {
  let parsed;
  try {
    parsed = parseArgs(argv, SPEC);
  } catch (e) {
    return usage(e.message);
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${HELP}
`);
    return;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`${VERSION}
`);
    return;
  }
  const args = parsed;
  if (args.positional.length > arity(args)) usage(`unexpected argument "${args.positional[arity(args)]}" \u2014 run \`ultrawatch --help\``);
  try {
    await run(args);
  } catch (e) {
    if (e instanceof UsageError) usage(e.message);
    throw e;
  }
}
function isStartedFile() {
  try {
    return !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}
if (isInvokedDirectly() || isStartedFile()) {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (e) => {
      if (e.code === "EPIPE") process.exit(EXIT_OK);
      throw e;
    });
  }
  main(process.argv.slice(2)).catch((e) => fail(e.message));
}
export {
  BOOL_FLAGS,
  COMMANDS,
  HELP,
  VALUE_FLAGS,
  doctorReport,
  main
};
