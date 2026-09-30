import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  citationTokensIn,
  collectCitations,
  extractClaimUnits,
  formatStamp,
  listVideoRuns,
  readVideoRun,
  unitTexts,
  type VideoRunMeta,
  type VideoSegment,
} from "./engine.js";

// Does an answer about a video say only what the video says, and say where?
//
// Every claim of six words or more must cite a stamp — `[V1 12:34]`, several at
// once as `[V1 12:34; V2 03:10]` — or the metadata, `[M]` / `[V2 M]`, for what
// the header says (title, channel, date, duration). A stamp must name a video
// the run holds, fall inside that video, and land on something said (a
// transcript segment) or shown (a frame from `frames`), 5 s of slack either
// way. The engine reads the citations; the verdict is this file's.

const CLAIM_MIN_WORDS = 6;
const SLACK_S = 5;

const STAMP = /^V(\d+) ((?:\d+:)?\d{1,2}:\d{2})$/;
const META = /^(?:V(\d+) )?M$/;
const BARE_STAMP = /^(?:\d+:)?\d{1,2}:\d{2}$/;

/** Is this bracketed token one of ours? */
export function isVideoCitation(token: string): boolean {
  return STAMP.test(token) || META.test(token);
}

/** `12:34` or `1:02:03` in seconds. */
export function stampSeconds(stamp: string): number {
  return stamp.split(":").reduce((acc, p) => acc * 60 + Number(p), 0);
}

/**
 * The two forms a writer reaches for that the bracket reader would not see:
 * a stamp made a link, `[V1 00:30](https://…&t=30s)`, and a video named once
 * for several stamps, `[V1 09:06, 09:15]`. Both are rewritten to the plain
 * form before anything is read; nothing else is touched.
 */
export function normalizeCitations(answer: string): string {
  return answer.replace(/\[([^\]\n]+)\](\([^)\s]*\))?/g, (whole, inner: string, link: string | undefined) => {
    const parts = inner.split(/[;,]/).map((p) => p.trim());
    let video: string | undefined;
    const out: string[] = [];
    for (const p of parts) {
      const m = STAMP.exec(p) ?? META.exec(p);
      if (m) {
        video = m[1] !== undefined ? `V${m[1]}` : video;
        out.push(p);
      } else if (video && BARE_STAMP.test(p)) out.push(`${video} ${p}`);
      else return whole; // not a citation bracket: leave it exactly as written
    }
    return link !== undefined || out.join("; ") !== inner ? `[${out.join("; ")}]` : whole;
  });
}

/** One video a run directory holds, under the label an answer cites it by. */
export interface CheckedVideo {
  label: string;
  meta?: VideoRunMeta;
  segments?: VideoSegment[];
  /** Times of the frames `frames` kept: what was on screen is evidence too. */
  frames?: number[];
  /** Listed in the corpus but never read: citing it grounds nothing. */
  unread?: string;
}

const readJson = <T>(path: string): T | undefined => {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as T;
  } catch {
    return undefined;
  }
};

function checked(label: string, dir: string): CheckedVideo {
  const run = readVideoRun(dir);
  if (!run) return { label, unread: `no run in ${dir}` };
  const frames = readJson<{ time?: unknown }[]>(join(dir, "frames.json"));
  return {
    label,
    meta: run.meta,
    segments: run.segments,
    ...(Array.isArray(frames) ? { frames: frames.map((f) => Number(f.time)).filter(Number.isFinite) } : {}),
  };
}

/**
 * The videos a directory holds, by label: a single video's run as V1; a
 * corpus's V1…Vn (corpus.json); or, for videos fetched one by one into one
 * directory, the order `videos` gives (ids). An error says which is missing.
 */
export function videosOf(dir: string, videos?: string[]): Map<string, CheckedVideo> | { error: string } {
  const out = new Map<string, CheckedVideo>();
  if (videos?.length) {
    videos.forEach((id, i) => out.set(`V${i + 1}`, checked(`V${i + 1}`, join(dir, id))));
    return out;
  }
  if (readVideoRun(dir)) return new Map([["V1", checked("V1", dir)]]);
  if (existsSync(join(dir, "corpus.json"))) {
    const corpus = readJson<{ videos?: { label?: unknown; id?: unknown; reason?: unknown }[] }>(join(dir, "corpus.json"));
    if (!Array.isArray(corpus?.videos)) return { error: `${join(dir, "corpus.json")} is not a readable corpus — run \`ultrawatch list\` again` };
    for (const v of corpus.videos) {
      if (typeof v.label !== "string" || typeof v.id !== "string") continue;
      const c = checked(v.label, join(dir, v.id));
      out.set(v.label, c.unread ? { label: v.label, unread: typeof v.reason === "string" ? v.reason : "not read" } : c);
    }
    return out;
  }
  const runs = listVideoRuns(dir);
  if (runs.length === 1) return new Map([["V1", checked("V1", runs[0]!.dir)]]);
  if (runs.length > 1) {
    return {
      error: `${dir} holds ${runs.length} videos and no corpus — pass --videos <id,id,…> to say which is V1, V2… (${runs.map((r) => r.meta.id).join(", ")})`,
    };
  }
  return { error: `${dir} is neither a video run (meta.json, segments.json) nor a corpus (corpus.json)` };
}

export interface CheckProblem {
  line?: number;
  /** `inert` and `meta-only` are notes: they do not fail the check. */
  kind: "empty" | "uncited" | "unknown-video" | "unread-video" | "past-end" | "no-segment" | "inert" | "meta-only";
  message: string;
}

export interface CheckReport {
  claims: number;
  citations: number;
  videos: number;
  problems: CheckProblem[];
}

/** Notes, not failures. */
export const NOTE_KINDS: ReadonlySet<CheckProblem["kind"]> = new Set(["inert", "meta-only"]);

const words = (t: string) => t.split(/\s+/).filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
const SOURCES_HEADING = /^#{1,6}\s+(?:sources?|references?|citations?|liens?|références?|bibliograph\w*)\b/i;

/**
 * A closing sources list: from its heading to the end of the answer, and only
 * when no heading follows it. A "Sources" heading anywhere else sets nothing
 * aside — otherwise one at the top would exempt the whole answer.
 */
function closingSourcesMask(lines: readonly string[]): boolean[] {
  const mask = lines.map(() => false);
  const headings = lines.map((l, i) => (/^#{1,6}\s/.test(l.trim()) ? i : -1)).filter((i) => i >= 0);
  const last = headings[headings.length - 1];
  if (last !== undefined && SOURCES_HEADING.test(lines[last]!.trim())) for (let i = last; i < lines.length; i++) mask[i] = true;
  return mask;
}

/** Finds the line each claim starts on, moving forward through the answer. */
function lineFinder(lines: string[]) {
  const flat = lines.map((l) =>
    l
      .replace(/`/g, "")
      .replace(/^\s*(?:[-*+]|\d+\.|>)\s+/, "")
      .replace(/\|/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
  let cursor = 0;
  return (text: string): number | undefined => {
    const probe = text.replace(/`/g, "").replace(/\s+/g, " ").trim().slice(0, 30);
    if (!probe) return undefined;
    for (const from of [cursor, 0]) {
      for (let i = from; i < flat.length; i++) {
        const l = flat[i]!;
        if (l && (l.includes(probe) || (l.length >= 10 && probe.startsWith(l.slice(0, 30))))) {
          cursor = i + 1;
          return i + 1;
        }
      }
    }
    return undefined;
  };
}

/** Check an answer against the videos it claims to cite. */
export function checkAnswer(dir: string, rawAnswer: string, opts: { videos?: string[] } = {}): CheckReport | { error: string } {
  const videos = videosOf(dir, opts.videos);
  if ("error" in videos) return videos;
  const answer = normalizeCitations(rawAnswer);
  const lines = answer.split(/\r?\n/);
  const lineOf = lineFinder(lines);
  const problems: CheckProblem[] = [];
  const unitOpts = { exclude: closingSourcesMask };
  const units = extractClaimUnits(answer, unitOpts);
  let claims = 0;
  const cited = new Set<string>();

  for (const unit of units) {
    for (const text of unitTexts(unit)) {
      const tokens = citationTokensIn(text, isVideoCitation);
      const line = lineOf(text);
      for (const t of tokens) cited.add(t);
      if (words(text.replace(/\[[^\]]*\]/g, " ")) >= CLAIM_MIN_WORDS) {
        claims++;
        const quote = text.length > 70 ? `${text.slice(0, 67)}…` : text;
        if (!tokens.length) problems.push({ line, kind: "uncited", message: `uncited claim — "${quote}"` });
        else if (tokens.every((t) => META.test(t)))
          problems.push({
            line,
            kind: "meta-only",
            message: `grounded only by the header [M] — fine for a title, a date or a duration, not for what the video says: "${quote}"`,
          });
      }
      for (const tok of tokens) problems.push(...judge(tok, videos, line));
    }
  }
  if (!claims) problems.push({ kind: "empty", message: "the answer makes no claim to check — nothing outside headings, code and a closing sources list" });

  // Stamps that appear only where they ground nothing: in code, or the sources list.
  const { inertOnly } = collectCitations(answer, isVideoCitation, unitOpts);
  for (const tok of inertOnly) problems.push({ kind: "inert", message: `[${tok}] appears only in code or in a sources list, where it grounds no claim` });

  problems.sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER));
  return { claims, citations: cited.size, videos: videos.size, problems };
}

/** What is wrong with one citation, if anything. */
function judge(tok: string, videos: Map<string, CheckedVideo>, line: number | undefined): CheckProblem[] {
  const stamp = STAMP.exec(tok);
  const metaVideo = META.exec(tok)?.[1];
  const label = stamp ? `V${stamp[1]}` : metaVideo ? `V${metaVideo}` : "V1";
  // A bare [M] across several videos is the corpus's own header: nothing to resolve.
  if (!stamp && !metaVideo && videos.size > 1) return [];
  const v = videos.get(label);
  if (!v) return [{ line, kind: "unknown-video", message: `[${tok}] — ${label} is not in this run (it holds ${[...videos.keys()].join(", ")})` }];
  if (v.unread) return [{ line, kind: "unread-video", message: `[${tok}] — ${label} was never read (${v.unread}), so it grounds nothing` }];
  if (!stamp) return [];
  const t = stampSeconds(stamp[2]!);
  const duration = v.meta?.duration;
  if (duration !== undefined && t > duration + 1) return [{ line, kind: "past-end", message: `[${tok}] — ${label} is only ${formatStamp(duration)} long` }];
  // Slack from the stamp a reader sees: a segment starting at 27.1 s shows 00:27.
  const said = (v.segments ?? []).some((s) => t >= Math.floor(s.start) - SLACK_S && t <= s.end + SLACK_S);
  const shown = (v.frames ?? []).some((f) => Math.abs(Math.floor(f) - t) <= SLACK_S);
  if (said || shown) return [];
  return [{ line, kind: "no-segment", message: `[${tok}] — nothing is said or shown in ${label} around ${stamp[2]} (±${SLACK_S} s)` }];
}
