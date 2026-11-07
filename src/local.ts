// A video already on disk: `ultrawatch fetch ./talk.webm`.
//
// The engine only reads http(s) URLs through yt-dlp, so a local file takes its
// own short path here: ffprobe for the duration and chapters, a sidecar .vtt
// when one sits next to the file, else ffmpeg + local whisper. The run it
// writes is the same as a URL's (TRANSCRIPT.md, segments.json, meta.json), so
// search, frames and check work on it unchanged. Nothing leaves the machine.
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  assessTranscript,
  ensureDir,
  envName,
  extractFrames,
  type FrameEffort,
  type FramesResult,
  have,
  isNoWrite,
  mergeSegments,
  parseVtt,
  readVideoRun,
  shAsync,
  transcriptMarkdown,
  type VideoChapter,
  type VideoMeta,
  type VideoRunner,
  type VideoRunResult,
  type VideoSegment,
  whisperModel,
  writeArtifact,
} from "./engine.js";

/** A path that names a file on this machine, not a URL. */
export function isLocalVideo(target: string): boolean {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(target)) return false;
  try {
    return statSync(target).isFile();
  } catch {
    return false;
  }
}

/**
 * The run key and title a file is read under. yt-dlp's default name ends in
 * ` [<id>]`: a YouTube id there keys the run as the URL would, and its links
 * open the video at the stamp. Any other file gets `local-<slug>-<hash>`.
 */
export function localIdentity(path: string): { key: string; title: string; youtubeId?: string } {
  const stem = basename(path, extname(path));
  const m = /^(.*?)\s*\[([A-Za-z0-9_-]{11})\]$/.exec(stem);
  if (m) return { key: m[2]!, title: m[1]!.trim() || m[2]!, youtubeId: m[2]! };
  const slug =
    stem
      .normalize("NFKD")
      .replace(/[^\w-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .slice(0, 80) || "video";
  const hash = createHash("sha256").update(resolve(path)).digest("hex").slice(0, 8);
  return { key: `local-${slug}-${hash}`, title: stem };
}

interface Probed {
  duration?: number;
  chapters: VideoChapter[];
  title?: string;
}

async function ffprobe(path: string, run: VideoRunner): Promise<Probed | { error: string }> {
  const r = await run("ffprobe", ["-v", "error", "-print_format", "json", "-show_format", "-show_chapters", "--", path], { timeoutMs: 60_000 });
  if (r.missing) return { error: "a local file needs ffmpeg (ffprobe)" };
  if (!r.ok) return { error: `ffprobe cannot read ${path}: ${r.stderr.trim().split("\n").pop() ?? ""}` };
  try {
    const j = JSON.parse(r.stdout) as {
      format?: { duration?: string; tags?: Record<string, string> };
      chapters?: { start_time?: string; end_time?: string; tags?: { title?: string } }[];
    };
    const duration = Number(j.format?.duration);
    const chapters = (j.chapters ?? [])
      .map((c, i) => ({ start: Number(c.start_time) || 0, end: Number(c.end_time) || 0, title: c.tags?.title?.trim() || `Chapter ${i + 1}` }))
      .filter((c) => Number.isFinite(c.start));
    const tags = j.format?.tags ?? {};
    return { duration: Number.isFinite(duration) ? duration : undefined, chapters, title: tags.title ?? tags.TITLE };
  } catch {
    return { error: "ffprobe returned unreadable metadata" };
  }
}

/** `<stem>.<lang>.vtt` next to the file, as yt-dlp's --write-subs leaves it. */
function sidecarVtt(path: string, lang?: string): string | undefined {
  const stem = basename(path, extname(path));
  let names: string[];
  try {
    names = readdirSync(dirname(path));
  } catch {
    return undefined;
  }
  const subs = names.filter((n) => n.startsWith(`${stem}.`) && n.endsWith(".vtt"));
  const want = lang?.toLowerCase().split(/[-_]/)[0];
  const pick =
    (want &&
      subs.find(
        (n) =>
          n
            .slice(stem.length + 1, -4)
            .toLowerCase()
            .split(/[-_]/)[0] === want,
      )) ||
    (want ? undefined : subs[0]);
  return pick ? join(dirname(path), pick) : undefined;
}

function whisperSegments(json: string): VideoSegment[] {
  try {
    const parsed = JSON.parse(json) as { segments?: { start: unknown; end: unknown; text?: unknown }[] };
    return (parsed.segments ?? [])
      .map((s) => ({
        start: Number(s.start),
        end: Number(s.end),
        text: String(s.text ?? "")
          .replace(/\s+/g, " ")
          .trim(),
      }))
      .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.text);
  } catch {
    return [];
  }
}

/**
 * Whisper on the file itself. No download, so the budget scales with the
 * video: ULTRAWATCH_WHISPER_TIMEOUT_MS when set, else the video's own length
 * (at least 30 min) — a 2-hour file is not cut off at the URL path's 30 min.
 * Batched inference: a long file is the usual case here, and it runs ~5× faster.
 */
async function whisperLocal(path: string, duration: number | undefined, lang: string | undefined, run: VideoRunner) {
  const fromEnv = Number(process.env[envName("WHISPER_TIMEOUT_MS")]);
  const budget = Number.isFinite(fromEnv) && fromEnv >= 1000 ? fromEnv : Math.max(30 * 60_000, (duration ?? 0) * 1000);
  const deadline = Date.now() + budget;
  const left = () => Math.max(1000, deadline - Date.now());
  const dir = mkdtempSync(join(tmpdir(), "ultrawatch-local-"));
  try {
    const wav = join(dir, "speech.wav");
    const ff = await run("ffmpeg", ["-nostdin", "-hide_banner", "-loglevel", "error", "-y", "-i", path, "-vn", "-ar", "16000", "-ac", "1", wav], {
      timeoutMs: left(),
    });
    if (ff.missing) return { failed: "whisper needs ffmpeg" };
    if (!ff.ok || !existsSync(wav)) return { failed: `ffmpeg could not extract the audio: ${ff.stderr.trim().split("\n").pop() ?? ""}` };
    const args = [
      "--with",
      "av<18",
      "whisper-ctranslate2",
      wav,
      "--model",
      whisperModel(),
      "--output_format",
      "json",
      "--output_dir",
      dir,
      "--batched",
      "True",
    ];
    const base = lang?.toLowerCase().split(/[-_]/)[0];
    if (base && /^[a-z]{2,3}$/.test(base)) args.push("--language", base);
    const w = await run("uvx", args, { timeoutMs: left(), cwd: dir });
    if (w.missing) return { failed: "whisper needs uvx (https://docs.astral.sh/uv/)" };
    if (w.status === 124) return { failed: `whisper timed out after ${Math.round(budget / 60_000)} min (${envName("WHISPER_TIMEOUT_MS")})` };
    const out = join(dir, "speech.json");
    if (!w.ok || !existsSync(out)) return { failed: `whisper: ${w.stderr.trim().split("\n").pop() || "failed"}` };
    return { segments: whisperSegments(readFileSync(out, "utf8")) };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** `ultrawatch fetch <file>`: the same run a URL gives, read from disk. */
export async function fetchLocalRun(file: string, root: string, opts: { refresh?: boolean; lang?: string; run?: VideoRunner } = {}): Promise<VideoRunResult> {
  const path = resolve(file);
  const run = opts.run ?? shAsync;
  const { key, title, youtubeId } = localIdentity(path);
  const dir = join(root, key);
  const transcriptPath = join(dir, "TRANSCRIPT.md");
  if (!opts.refresh) {
    const kept = readVideoRun(dir);
    if (kept && existsSync(transcriptPath) && (!opts.lang || (kept.meta as { lang?: string }).lang === opts.lang))
      return { ok: true, id: key, dir, transcript: transcriptPath, reused: true, meta: kept.meta, segments: kept.segments.length };
  }
  const probed = await ffprobe(path, run);
  if ("error" in probed) return { ok: false, id: key, reason: probed.error };
  const meta: VideoMeta = {
    id: youtubeId ?? key,
    site: youtubeId ? "youtube" : "local",
    key,
    title: probed.title ?? title,
    duration: probed.duration,
    ...(opts.lang ? { language: opts.lang } : {}),
    chapters: probed.chapters,
    subtitles: [],
    autoCaptions: [],
    webpageUrl: youtubeId ? `https://www.youtube.com/watch?v=${youtubeId}` : pathToFileURL(path).href,
  };
  const starts = meta.chapters.map((c) => c.start);
  let segments: VideoSegment[] | undefined;
  let via: "manual-subs" | "whisper";
  let track: string | undefined;
  const vtt = sidecarVtt(path, opts.lang);
  if (vtt) {
    segments = mergeSegments(parseVtt(readFileSync(vtt, "utf8")), starts);
    via = "manual-subs";
    track = basename(vtt).slice(basename(path, extname(path)).length + 1, -4);
  } else {
    const w = await whisperLocal(path, meta.duration, opts.lang, run);
    if ("failed" in w) return { ok: false, id: key, reason: w.failed ?? "whisper failed" };
    segments = mergeSegments(w.segments, starts);
    via = "whisper";
  }
  const verdict = assessTranscript(segments, meta.duration);
  if (!verdict.ok) return { ok: false, id: key, reason: verdict.reason ?? "no transcript" };
  const t = { text: segments.map((s) => s.text).join("\n"), segments, chapters: meta.chapters, meta, via, ...(track ? { track } : {}) };
  const runMeta = {
    ...meta,
    via,
    ...(track ? { track } : {}),
    ...(opts.lang ? { lang: opts.lang } : {}),
    file: path,
    fetchedAt: new Date().toISOString(),
  };
  const markdown = transcriptMarkdown(t);
  const done = { ok: true as const, id: key, dir, transcript: transcriptPath, reused: false, meta: runMeta, segments: segments.length };
  if (isNoWrite()) return { ...done, markdown };
  try {
    ensureDir(dir);
    writeArtifact(join(dir, "segments.json"), `${JSON.stringify(segments, null, 1)}\n`);
    writeArtifact(transcriptPath, markdown);
    writeArtifact(join(dir, "meta.json"), `${JSON.stringify(runMeta, null, 2)}\n`);
  } catch (e) {
    return { ok: false, id: key, reason: `cannot write the run in ${dir}: ${(e as Error).message}` };
  }
  return done;
}

/** The file a run was read from, when it was read from disk and the file is still there. */
export function localFileOf(runDir: string): string | undefined {
  const file = (readVideoRun(runDir)?.meta as { file?: unknown } | undefined)?.file;
  return typeof file === "string" && isLocalVideo(file) ? file : undefined;
}

/**
 * Frames from the file on disk. The engine fetches the video through yt-dlp;
 * here that one call is answered by linking the local file where yt-dlp would
 * have written it, so scene detection, dedup and FRAMES.md stay the engine's.
 */
export async function extractLocalFrames(
  runDir: string,
  file: string,
  opts: { effort?: FrameEffort; run?: VideoRunner; have?: (cmd: string) => boolean } = {},
): Promise<FramesResult> {
  const path = resolve(file);
  const base = opts.run ?? shAsync;
  const run: VideoRunner = async (cmd, args, o) => {
    if (cmd !== "yt-dlp") return base(cmd, args, o);
    const template = args[args.indexOf("-o") + 1];
    if (!args.includes("-o") || !template) return { ok: false, status: 1, stdout: "", stderr: "a local file is only ever downloaded" };
    symlinkSync(path, template.replace("%(ext)s", extname(path).slice(1) || "mp4"));
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };
  // Any http(s) page will do: the only call it reaches is the one answered above.
  const meta = readVideoRun(runDir)?.meta;
  const url = meta && /^https?:\/\//i.test(meta.webpageUrl) ? meta.webpageUrl : "https://localhost/";
  return extractFrames(runDir, { effort: opts.effort, url, deps: { run, have: opts.have ?? have } });
}
