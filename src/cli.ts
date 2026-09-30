import { existsSync, readFileSync, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { checkAnswer, NOTE_KINDS } from "./check.js";
import {
  argBool,
  argInt,
  argValue,
  type CliSpec,
  type CommandArgs,
  ENGINE_VERSION,
  EXIT_FAILURE,
  EXIT_OK,
  EXIT_USAGE,
  enabledTranscribers,
  envName,
  extractFrames,
  FRAME_EFFORT,
  type FrameEffort,
  fetchVideoCorpus,
  fetchVideoRun,
  formatStamp,
  have,
  isInvokedDirectly,
  isNoWrite,
  listVideoRuns,
  jsonLine,
  parseArgs,
  searchVideoRuns,
  VIDEO_TRANSCRIBERS,
  videoRoot,
  whisperModel,
  youtubeVideoId,
  UsageError,
  type VideoRunner,
  ytdlpVersionAge,
} from "./engine.js";
import { VERSION } from "./version.js";

export const HELP = `ultrawatch v${VERSION} (webindex ${ENGINE_VERSION})
Watch YouTube for an agent: a video, a playlist or a channel turned into
timestamped transcripts and on-screen frames, kept on disk, searchable, and
checked — every claim cites a [V# mm:ss] stamp that exists. Local and keyless.

USAGE
  ultrawatch fetch <url> [--out <dir>] [--lang <tag>] [--refresh] [--json]
  ultrawatch search <query> [--out <dir>] [--limit <n>] [--videos <id,id,…>] [--json]
  ultrawatch frames <url|id|dir> [--effort low|med|high] [--out <dir>] [--lang <tag>] [--json]
  ultrawatch list <playlist|channel> [--limit <n>] [--out <dir>] [--lang <tag>] [--refresh] [--json]
  ultrawatch check <run> <answer.md> [--videos <id,id,…>] [--json]
  ultrawatch doctor [--json]
  ultrawatch version

COMMANDS
  fetch    Read one video into <dir>/<id>/: TRANSCRIPT.md (header, a heading
           per chapter, a [mm:ss] stamp per paragraph), segments.json and
           meta.json. Manual subtitles, else the video's own auto-captions
           (never a machine translation), else a local whisper transcription.
           A video already on disk is reused without touching YouTube;
           --refresh reads it again, --lang picks the subtitle language.
  search   Rank ~45 s passages of every video under the directory — or of a
           corpus, labelled V1…Vn — against a question: each with its stamp,
           chapter and a link that opens the video there. For follow-up
           questions, without reading the video again. Hits are labelled as
           an answer cites them: V1 for a single video, V1…Vn in a corpus or
           in the order --videos gives.
  frames   What is on screen: a frame at every scene change and chapter start,
           near-duplicates dropped, at most 20/50/100 by --effort (med), in
           <id>/frames/, with FRAMES.md pairing each with what was said from
           5 s before to 10 s after. Needs ffmpeg.
  list     Read the first --limit videos (default 10) of a playlist or channel,
           two at a time, and write CORPUS.md naming them V1…Vn.
  check    Check an answer against its run: every claim of six words or more
           cites [V# mm:ss] (or [M] for the header's facts), every V# exists
           and was read, every stamp falls inside the video and on something
           said or shown (±5 s of a segment or a kept frame). <run> is a
           video's directory, a corpus, or a directory of videos fetched one
           by one with --videos naming V1, V2… in order. Exits 1 with a
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

export const VALUE_FLAGS = ["out", "lang", "limit", "effort", "videos"];
export const BOOL_FLAGS = ["json", "refresh"];
export const COMMANDS = ["fetch", "search", "frames", "list", "check", "doctor"];

const SPEC: CliSpec = { commands: COMMANDS, valueFlags: VALUE_FLAGS, boolFlags: BOOL_FLAGS };
const YTDLP_STALE_DAYS = 60;

function fail(msg: string, code = EXIT_FAILURE): never {
  process.stderr.write(`ultrawatch: ${msg}\n`);
  process.exit(code);
}
/** `--videos a,b,c`: the ids a directory of separately fetched videos is cited by, V1 first. */
function videoList(args: CommandArgs): string[] | undefined {
  const raw = argValue(args, "videos");
  if (raw === undefined) return undefined;
  const ids = raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (!ids.length || ids.some((id) => !/^[\w-]{11}$/.test(id))) usage(`--videos takes YouTube video ids separated by commas, not "${raw}"`);
  return ids;
}

/**
 * The labels search should print, so a hit can be cited as shown: a corpus
 * labels itself (corpus.json); a single video is V1; `--videos` orders the rest.
 */
function citeLabels(root: string, videos?: string[]): Map<string, string> | undefined {
  if (videos) return new Map(videos.map((id, i) => [id, `V${i + 1}`]));
  if (existsSync(join(root, "corpus.json"))) return undefined;
  const runs = listVideoRuns(root);
  return runs.length === 1 ? new Map([[runs[0]!.meta.id, "V1"]]) : undefined;
}

function usage(msg: string): never {
  return fail(msg, EXIT_USAGE);
}
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** How many bare words each command takes. */
function arity(args: CommandArgs): number {
  if (args.command === "search") return Number.POSITIVE_INFINITY;
  if (args.command === "check") return 2;
  if (args.command === "doctor") return 0;
  return 1;
}

async function run(args: CommandArgs): Promise<void> {
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
    // ULTRAWATCH_NO_WRITE: nothing was written, so the transcript is the answer.
    else if (isNoWrite()) process.stdout.write(r.markdown ?? readFileSync(r.transcript, "utf8"));
    else {
      const m = r.meta;
      const facts = [m.channel, m.duration !== undefined ? formatStamp(m.duration) : undefined, m.via, plural(r.segments, "segment")]
        .filter(Boolean)
        .join(" · ");
      process.stdout.write(`${r.transcript}\n  ${m.title} — ${facts}${r.reused ? " (already on disk)" : ""}\n`);
    }
    return;
  }

  if (cmd === "search") {
    const query = args.positional.join(" ").trim();
    if (!query) usage("usage: ultrawatch search <query> [--out <dir>] [--limit <n>] [--json]");
    const hits = searchVideoRuns(root, query, { limit: argInt(args, "limit", { min: 1 }) ?? 10, labels: citeLabels(root, videoList(args)) });
    if (asJson) process.stdout.write(jsonLine({ dir: root, query, hits }));
    else for (const h of hits) process.stdout.write(`[${h.label} ${h.stamp}] ${h.title}${h.chapter ? ` — ${h.chapter}` : ""}\n  ${h.url}\n  ${h.text}\n\n`);
    if (!hits.length) fail(`nothing under ${root} matches "${query}" — \`ultrawatch fetch <url>\` reads a video first`);
    return;
  }

  if (cmd === "frames") {
    const target = args.positional[0];
    if (!target) usage("usage: ultrawatch frames <url|id|dir> [--effort low|med|high] [--out <dir>] [--json]");
    const effort = argValue(args, "effort") ?? "med";
    if (!(effort in FRAME_EFFORT)) usage(`--effort must be low, med or high, not "${effort}"`);
    let runDir: string;
    if (youtubeVideoId(target)) {
      const r = await fetchVideoRun(target, root, { lang: argValue(args, "lang") });
      if (!r.ok) fail(`no transcript for ${target}: ${r.reason}`);
      runDir = r.dir;
    } else runDir = existsSync(join(root, target, "meta.json")) ? join(root, target) : resolve(target);
    const r = await extractFrames(runDir, { effort: effort as FrameEffort });
    if (!r.ok) {
      if (asJson) process.stdout.write(jsonLine(r));
      fail(r.reason);
    }
    if (asJson) process.stdout.write(jsonLine(r));
    else
      process.stdout.write(
        `${r.markdown}\n  ${plural(r.frames.length, "frame")} in ${r.dir} (${plural(r.candidates, "candidate")}, ${plural(r.duplicates, "near-duplicate")} dropped, effort ${r.effort})\n`,
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
      onVideo: (done, total, title) => process.stderr.write(`  [${done}/${total}] ${title}\n`),
    });
    if (!r.ok) {
      if (asJson) process.stdout.write(jsonLine(r));
      fail(r.reason);
    }
    if (asJson) process.stdout.write(jsonLine(r));
    else
      process.stdout.write(
        `${r.corpus}\n${r.videos.map((v) => `  ${v.label.padEnd(4)}${v.dir ? `${(v.via ?? "").padEnd(12)}${v.title}` : `not read — ${v.reason}`}`).join("\n")}\n`,
      );
    if (!r.videos.some((v) => v.dir)) fail("none of the listed videos had a transcript");
    return;
  }

  if (cmd === "check") {
    const [dir, file] = args.positional;
    if (!dir || !file) usage("usage: ultrawatch check <run> <answer.md> [--videos <id,id,…>] [--json]");
    const videos = videoList(args);
    let answer: string;
    try {
      answer = readFileSync(file, "utf8");
    } catch {
      return fail(`cannot read ${file}`);
    }
    const r = checkAnswer(resolve(dir), answer, { videos });
    if ("error" in r) fail(r.error);
    const failing = r.problems.filter((p) => !NOTE_KINDS.has(p.kind));
    if (asJson) process.stdout.write(jsonLine({ ok: failing.length === 0, ...r }));
    else {
      const head = `${plural(r.claims, "claim")}, ${plural(r.citations, "citation")}, ${plural(r.videos, "video")}`;
      if (!failing.length) process.stdout.write(`ultrawatch check: OK — ${head}\n`);
      else process.stdout.write(`ultrawatch check: ${plural(failing.length, "problem")} in ${file} (${head})\n`);
      for (const p of r.problems) process.stdout.write(`  ${p.line ? `line ${p.line}` : "note"}: ${p.message}\n`);
    }
    if (failing.length) process.exit(EXIT_FAILURE);
    return;
  }

  if (cmd === "doctor") {
    const report = await doctorReport();
    if (asJson) process.stdout.write(jsonLine(report));
    else {
      const { ytdlp } = report;
      const found = "version" in ytdlp ? ytdlp : undefined;
      const age = found?.ageDays !== undefined ? ` (${found.ageDays} days old${found.stale ? " — update it: `yt-dlp -U`, or your package manager" : ""})` : "";
      process.stdout.write(
        [
          `ultrawatch ${VERSION} (webindex ${ENGINE_VERSION})`,
          `  yt-dlp      ${found ? `${found.version}${age}` : "not installed — required: https://github.com/yt-dlp/yt-dlp"}`,
          `  ffmpeg      ${report.ffmpeg ? "installed" : "not installed — frames and whisper need it"}`,
          `  uvx         ${report.uvx ? "installed" : "not installed — whisper needs it (https://docs.astral.sh/uv/)"}`,
          `  whisper     model ${report.whisperModel}${report.ffmpeg && report.uvx ? "" : " (unavailable)"}`,
          `  rungs       ${report.rungs.map((r) => (r.enabled ? r.id : `${r.id} (off: ${envName("VIDEO_ENGINES")})`)).join(" → ")}`,
          `  videos      ${report.videoDir}`,
          "",
        ].join("\n"),
      );
    }
    if (!("version" in report.ytdlp)) process.exit(EXIT_FAILURE);
    return;
  }
}

/**
 * What this machine can do: yt-dlp and how old it is (YouTube breaks old
 * releases), ffmpeg and uvx, the whisper model, the rungs, the run directory.
 * `run` and `has` default to the real tools; tests pass their own.
 */
export async function doctorReport(tools: { run?: VideoRunner; has?: (cmd: string) => boolean } = {}) {
  const has = tools.has ?? have;
  const ytdlp = await ytdlpVersionAge(tools.run);
  const rungs = enabledTranscribers();
  return {
    version: VERSION,
    engine: ENGINE_VERSION,
    ytdlp: ytdlp ? { ...ytdlp, stale: (ytdlp.ageDays ?? 0) > YTDLP_STALE_DAYS } : { state: "not installed" as const },
    ffmpeg: has("ffmpeg"),
    uvx: has("uvx"),
    whisperModel: whisperModel(),
    rungs: VIDEO_TRANSCRIBERS.map((id) => ({ id, enabled: rungs.includes(id) })),
    videoDir: videoRoot(),
  };
}

/** The CLI, as a function: tests drive it; the bundle calls it with process.argv. */
export async function main(argv: string[]): Promise<void> {
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs(argv, SPEC);
  } catch (e) {
    return usage((e as Error).message);
  }
  if (parsed.kind === "help") {
    process.stdout.write(`${HELP}\n`);
    return;
  }
  if (parsed.kind === "version") {
    process.stdout.write(`${VERSION}\n`);
    return;
  }
  const args: CommandArgs = parsed;
  if (args.positional.length > arity(args)) usage(`unexpected argument "${args.positional[arity(args)]}" — run \`ultrawatch --help\``);
  try {
    await run(args);
  } catch (e) {
    // A value that parsed as a flag but not as a number (`--limit 0`) is the
    // invocation's fault: exit 2, as any other usage error.
    if (e instanceof UsageError) usage(e.message);
    throw e;
  }
}

function isStartedFile(): boolean {
  try {
    return !!process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url;
  } catch {
    return false;
  }
}

// Only when run as a program: `webindex skill bundle` imports the built file to
// read HELP and the flag tables, and importing must not start anything.
if (isInvokedDirectly() || isStartedFile()) {
  for (const stream of [process.stdout, process.stderr]) {
    stream.on("error", (e: NodeJS.ErrnoException) => {
      if (e.code === "EPIPE") process.exit(EXIT_OK);
      throw e;
    });
  }
  main(process.argv.slice(2)).catch((e) => fail((e as Error).message));
}
