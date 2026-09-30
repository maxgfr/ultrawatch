import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { BOOL_FLAGS, COMMANDS, doctorReport, HELP, main, VALUE_FLAGS } from "../src/cli.js";
import { brand, documentedFlags, missingFromHelp, resetVideoLadderCache, setVideoDeps, type VideoRunner } from "../src/engine.js";
import { VERSION } from "../src/version.js";

// Importing the CLI runs nothing (the packaging gate imports the built file to
// read these tables), and the engine it reaches is configured as ultrawatch.

const TED = join(import.meta.dirname, "..", "evals", "cases", "ted");
let out: string[];
let err: string[];
let dir: string;

beforeEach(() => {
  out = [];
  err = [];
  vi.spyOn(process.stdout, "write").mockImplementation((c: unknown) => {
    out.push(String(c));
    return true;
  });
  vi.spyOn(process.stderr, "write").mockImplementation((c: unknown) => {
    err.push(String(c));
    return true;
  });
  dir = mkdtempSync(join(tmpdir(), "ultrawatch-cli-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  setVideoDeps();
  resetVideoLadderCache();
  rmSync(dir, { recursive: true, force: true });
});

const stdout = () => out.join("");
const stderr = () => err.join("");

async function run(argv: string[]): Promise<number> {
  const exit = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
    throw new Error(`__exit__${code ?? 0}`);
  }) as never);
  try {
    await main(argv);
    return 0;
  } catch (e) {
    const m = /^__exit__(\d+)$/.exec((e as Error).message);
    if (m) return Number(m[1]);
    throw e;
  } finally {
    exit.mockRestore();
  }
}

// yt-dlp replaced: a probe answers with "Me at the zoo", a subtitle call drops its VTT.
const zoo = {
  id: "jNQXAC9IVRw",
  title: "Me at the zoo",
  channel: "jawed",
  duration: 19,
  webpage_url: "https://www.youtube.com/watch?v=jNQXAC9IVRw",
  subtitles: { en: [] },
  automatic_captions: {},
};
const ytdlp: VideoRunner = async (_cmd, args) => {
  if (args.includes("-J")) return { ok: true, status: 0, stdout: JSON.stringify(zoo), stderr: "" };
  writeFileSync(
    join(dirname(args[args.indexOf("-o") + 1]!), "sub.en.vtt"),
    "WEBVTT\n\n00:01.200 --> 00:05.000\nAll right, so here we are, in front of the elephants\n",
  );
  return { ok: true, status: 0, stdout: "", stderr: "" };
};

describe("the surface", () => {
  it("is configured as ultrawatch", () => {
    expect(brand()).toMatchObject({ name: "ultrawatch", envPrefix: "ULTRAWATCH", cli: "ultrawatch" });
  });

  it("names every flag and command in --help, and documents none it would reject", () => {
    expect(missingFromHelp(HELP, [...VALUE_FLAGS, ...BOOL_FLAGS])).toEqual([]);
    const universe = new Set([...VALUE_FLAGS, ...BOOL_FLAGS, "help", "version"]);
    expect(documentedFlags(HELP).filter((f) => !universe.has(f))).toEqual([]);
    for (const c of COMMANDS) expect(HELP).toContain(`ultrawatch ${c}`);
  });

  it("documents every flag it accepts in SKILL.md and nothing more", () => {
    const skill = readFileSync(join(import.meta.dirname, "..", "skills", "ultrawatch", "SKILL.md"), "utf8");
    const universe = new Set([...VALUE_FLAGS, ...BOOL_FLAGS, "help", "version"]);
    expect(documentedFlags(skill).filter((f) => !universe.has(f))).toEqual([]);
  });

  it("prints its help and version", async () => {
    expect(await run(["--help"])).toBe(0);
    expect(stdout()).toContain("ultrawatch check <run> <answer.md>");
    out.length = 0;
    expect(await run(["--version"])).toBe(0);
    expect(stdout()).toBe(`${VERSION}\n`);
  });

  it("refuses a bad invocation with exit 2", async () => {
    expect(await run(["watch"])).toBe(2);
    expect(await run(["fetch"])).toBe(2);
    expect(await run(["fetch", "a", "b"])).toBe(2);
    expect(await run(["check", TED])).toBe(2);
    expect(await run(["frames", "x", "--effort", "max"])).toBe(2);
    expect(await run(["fetch", "u", "--limt", "3"])).toBe(2);
    expect(await run(["search", "q", "--limit", "0"])).toBe(2);
    expect(await run(["check", TED, "a.md", "--videos", "not-an-id"])).toBe(2);
  });
});

describe("fetch and search", () => {
  it("keeps the video, reuses it, and searches it", async () => {
    setVideoDeps({ run: ytdlp, have: () => true });
    expect(await run(["fetch", "https://youtu.be/jNQXAC9IVRw", "--out", dir])).toBe(0);
    expect(stdout()).toContain(join(dir, "jNQXAC9IVRw", "TRANSCRIPT.md"));
    out.length = 0;
    expect(await run(["fetch", "https://youtu.be/jNQXAC9IVRw", "--out", dir, "--json"])).toBe(0);
    expect(JSON.parse(stdout())).toMatchObject({ ok: true, reused: true, via: "manual-subs" });
    out.length = 0;
    expect(await run(["search", "elephants", "--out", dir, "--json"])).toBe(0);
    // One video in the directory: hits are labelled V1, as an answer cites them.
    expect(JSON.parse(stdout()).hits[0]).toMatchObject({ label: "V1", stamp: "00:01", url: "https://www.youtube.com/watch?v=jNQXAC9IVRw&t=1s" });
    expect(await run(["search", "giraffes", "--out", dir])).toBe(1);
  });

  it("uses <tmp>/ultrawatch/video when neither --out nor the variable says otherwise", async () => {
    delete process.env.ULTRAWATCH_VIDEO_DIR;
    setVideoDeps({ run: async () => ({ ok: false, status: 1, stdout: "", stderr: "ERROR: [youtube] x: Private video" }), have: () => true });
    expect(await run(["fetch", "https://youtu.be/jNQXAC9IVRw"])).toBe(1);
    expect(stderr()).toContain("no transcript for https://youtu.be/jNQXAC9IVRw: private video");
    expect(await run(["doctor", "--json"])).toBeLessThanOrEqual(1);
    expect(JSON.parse(stdout()).videoDir).toBe(join(tmpdir(), "ultrawatch", "video"));
  });
});

describe("list and frames", () => {
  const listing = {
    title: "Animals",
    entries: [
      { _type: "url", ie_key: "Youtube", id: "jNQXAC9IVRw", title: "Me at the zoo", duration: 19 },
      { _type: "url", ie_key: "Youtube", id: "aaaaaaaaaaa", title: "Gone", duration: 60 },
    ],
  };
  const corpusRunner: VideoRunner = async (cmd, args, opts) => {
    if (args.includes("--flat-playlist")) return { ok: true, status: 0, stdout: JSON.stringify(listing), stderr: "" };
    if (args.includes("-J") && args.at(-1)?.includes("aaaaaaaaaaa"))
      return { ok: false, status: 1, stdout: "", stderr: "ERROR: [youtube] x: Video unavailable" };
    return ytdlp(cmd, args, opts);
  };

  it("reads a playlist as a corpus, and checks an answer against it", async () => {
    setVideoDeps({ run: corpusRunner, have: () => true });
    expect(await run(["list", "https://www.youtube.com/playlist?list=PLx", "--limit", "2", "--out", dir])).toBe(0);
    expect(stdout()).toContain(join(dir, "CORPUS.md"));
    expect(stdout()).toMatch(/V1 {2}manual-subs +Me at the zoo/);
    expect(stdout()).toContain("V2  not read — video unavailable");
    writeFileSync(
      join(dir, "answer.md"),
      "He stands in front of the elephants at the zoo [V1 00:01].\n\nThe second video explains giraffes in great detail [V2 00:10].\n",
    );
    out.length = 0;
    expect(await run(["check", dir, join(dir, "answer.md")])).toBe(1);
    expect(stdout()).toContain("[V2 00:10] — V2 was never read (video unavailable)");
  });

  it("fails a listing that names no playlist, or reads nothing", async () => {
    setVideoDeps({ run: corpusRunner, have: () => true });
    expect(await run(["list", "https://youtu.be/jNQXAC9IVRw", "--out", dir])).toBe(1);
    expect(stderr()).toContain("not a YouTube playlist or channel URL");
    expect(await run(["list"])).toBe(2);
  });

  it("frames: fetches first, and says what it lacks", async () => {
    setVideoDeps({ run: ytdlp, have: (c) => c !== "ffmpeg" });
    expect(await run(["frames", "https://youtu.be/jNQXAC9IVRw", "--out", dir, "--json"])).toBe(1);
    expect(JSON.parse(stdout())).toEqual({ ok: false, reason: "frames need ffmpeg" });
    out.length = 0;
    expect(await run(["frames", "jNQXAC9IVRw", "--out", dir])).toBe(1);
    expect(stderr()).toContain("frames need ffmpeg");
    expect(await run(["frames"])).toBe(2);
  });

  it("prints the transcript instead of writing it under ULTRAWATCH_NO_WRITE", async () => {
    setVideoDeps({ run: ytdlp, have: () => true });
    process.env.ULTRAWATCH_NO_WRITE = "1";
    try {
      expect(await run(["fetch", "https://youtu.be/jNQXAC9IVRw", "--out", dir])).toBe(0);
    } finally {
      delete process.env.ULTRAWATCH_NO_WRITE;
    }
    expect(stdout()).toMatch(/^# Me at the zoo\n/);
  });
});

describe("check", () => {
  it("passes a grounded answer, and fails an ungrounded one line by line", async () => {
    expect(await run(["check", TED, join(TED, "answer.good.md")])).toBe(0);
    expect(stdout()).toMatch(/^ultrawatch check: OK — 7 claims/);
    out.length = 0;
    expect(await run(["check", TED, join(TED, "answer.bad.md")])).toBe(1);
    expect(stdout()).toContain("ultrawatch check: 4 problems");
    expect(stdout()).toMatch(/line 3: uncited claim/);
    expect(stdout()).toContain("[V2 09:00] — V2 is not in this run");
  });

  it("answers as JSON", async () => {
    expect(await run(["check", TED, join(TED, "answer.bad.md"), "--json"])).toBe(1);
    const j = JSON.parse(stdout());
    expect(j.ok).toBe(false);
    expect(j.problems.map((p: { kind: string }) => p.kind)).toEqual(["uncited", "unknown-video", "past-end", "no-segment"]);
  });

  it("fails plainly on a missing answer or a directory that is no run", async () => {
    expect(await run(["check", TED, join(dir, "nope.md")])).toBe(1);
    expect(stderr()).toContain("cannot read");
    writeFileSync(join(dir, "a.md"), "x");
    expect(await run(["check", dir, join(dir, "a.md")])).toBe(1);
    expect(stderr()).toContain("neither a video run");
  });
});

describe("doctor", () => {
  it("reports yt-dlp's age, flags an old one, and names the tools and rungs", async () => {
    const r = await doctorReport({ run: async () => ({ ok: true, status: 0, stdout: "2020.01.01\n", stderr: "" }), has: (c) => c === "ffmpeg" });
    expect(r.ytdlp).toMatchObject({ version: "2020.01.01", stale: true });
    expect(r).toMatchObject({ ffmpeg: true, uvx: false, whisperModel: "small" });
    expect(r.rungs.map((x) => x.id)).toEqual(["manual-subs", "auto-subs", "whisper"]);
    const none = await doctorReport({ run: async () => ({ ok: false, status: 127, stdout: "", stderr: "", missing: true }), has: () => false });
    expect(none.ytdlp).toEqual({ state: "not installed" });
  });

  it("prints the report, and fails only when yt-dlp is missing", async () => {
    const code = await run(["doctor"]);
    expect(stdout()).toContain("  rungs       manual-subs → auto-subs → whisper");
    expect(code).toBe(stdout().includes("yt-dlp      not installed") ? 1 : 0);
  });
});
