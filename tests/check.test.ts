import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAnswer, isVideoCitation, NOTE_KINDS, normalizeCitations, stampSeconds, videosOf } from "../src/check.js";

const TED = join(import.meta.dirname, "..", "evals", "cases", "ted");

// A two-video corpus, with a third listed but never read.
function corpus(root: string) {
  const run = (id: string, duration: number, segments: { start: number; end: number; text: string }[]) => {
    mkdirSync(join(root, id), { recursive: true });
    writeFileSync(
      join(root, id, "meta.json"),
      JSON.stringify({
        id,
        title: id,
        duration,
        chapters: [],
        subtitles: [],
        autoCaptions: [],
        webpageUrl: `https://www.youtube.com/watch?v=${id}`,
        via: "manual-subs",
      }),
    );
    writeFileSync(join(root, id, "segments.json"), JSON.stringify(segments));
  };
  run("aaaaaaaaaaa", 120, [{ start: 10, end: 20, text: "elephants have long trunks" }]);
  run("bbbbbbbbbbb", 3700, [{ start: 3650, end: 3660, text: "giraffes have long necks" }]);
  writeFileSync(
    join(root, "corpus.json"),
    JSON.stringify({
      source: "s",
      createdAt: "t",
      videos: [
        { label: "V1", id: "aaaaaaaaaaa", title: "a" },
        { label: "V2", id: "bbbbbbbbbbb", title: "b" },
        { label: "V3", id: "ccccccccccc", title: "c", reason: "private video" },
      ],
    }),
  );
}

describe("citations", () => {
  it("recognises stamps and metadata, nothing else", () => {
    for (const t of ["V1 12:34", "V12 1:02:03", "V2 0:05", "M", "V3 M"]) expect(isVideoCitation(t), t).toBe(true);
    for (const t of ["12:34", "S1", "V1", "V1 12:3", "V 12:34", "v1 12:34", "V1 12:34:56:78"]) expect(isVideoCitation(t), t).toBe(false);
    expect(stampSeconds("12:34")).toBe(754);
    expect(stampSeconds("1:02:03")).toBe(3723);
  });
});

describe("checkAnswer on a single video", () => {
  it("passes an answer whose every claim cites a stamp on something said", () => {
    const r = checkAnswer(TED, "Children starting school this year will retire around 2065, nobody knows the future [V1 02:16].\n");
    expect(r).toMatchObject({ claims: 1, citations: 1, videos: 1, problems: [] });
  });

  it("reports each problem on its line", () => {
    const answer = [
      "# Title is not a claim",
      "",
      "Robinson says standardised tests should be abolished everywhere.",
      "",
      "- A claim citing a second video that is not there [V2 01:00].",
      "- A claim citing a stamp past the end of the talk [V1 45:10].",
      "- A claim citing a stamp where nothing is said at all [V1 00:05].",
      "- Short: fine.",
    ].join("\n");
    const r = checkAnswer(TED, answer);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.map((p) => [p.line, p.kind])).toEqual([
      [3, "uncited"],
      [5, "unknown-video"],
      [6, "past-end"],
      [7, "no-segment"],
    ]);
    expect(r.problems[2]!.message).toBe("[V1 45:10] — V1 is only 20:03 long");
  });

  it("lets [M] ground what the header says, and sets code and a sources list aside", () => {
    const answer = [
      "The talk was published by TED in 2007 and runs twenty minutes [M].",
      "",
      "```",
      "an example stamp [V1 99:99] inside code",
      "```",
      "",
      "## Sources",
      "",
      "- [V1 00:27] the talk",
    ].join("\n");
    const r = checkAnswer(TED, answer);
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.filter((p) => !NOTE_KINDS.has(p.kind))).toEqual([]);
    expect(r.problems.filter((p) => p.kind === "inert").map((p) => p.message)).toEqual([
      "[V1 99:99] appears only in code or in a sources list, where it grounds no claim",
      "[V1 00:27] appears only in code or in a sources list, where it grounds no claim",
    ]);
  });

  it("takes grouped stamps, and every one of them must hold", () => {
    const ok = checkAnswer(TED, "No system teaches dance every day the way it teaches mathematics [V1 09:06; V1 09:15].");
    expect(ok).toMatchObject({ problems: [] });
    const bad = checkAnswer(TED, "No system teaches dance every day the way it teaches mathematics [V1 09:06; V1 19:59].");
    if ("error" in bad) throw new Error(bad.error);
    expect(bad.problems.map((p) => p.kind)).toEqual(["no-segment"]);
  });
});

describe("what a claim, a citation and a source list are", () => {
  it("fails an answer that makes no claim, and a Sources heading exempts only a closing list", () => {
    for (const empty of ["", "# Just a title\n", "```\nall of it in code [V1 02:16]\n```\n"]) {
      const r = checkAnswer(TED, empty);
      if ("error" in r) throw new Error(r.error);
      expect(
        r.problems.map((p) => p.kind),
        JSON.stringify(empty),
      ).toContain("empty");
    }
    const r = checkAnswer(TED, "# Sources\n\n## Summary\n\nRobinson says standardised tests should be abolished everywhere.\n");
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.map((p) => p.kind)).toEqual(["uncited"]);
  });

  it("reads a linked stamp and a video named once for several stamps", () => {
    expect(normalizeCitations("x [V1 09:06, 09:15] y")).toBe("x [V1 09:06; V1 09:15] y");
    expect(normalizeCitations("x [V1 00:30](https://www.youtube.com/watch?v=a&t=30s) y")).toBe("x [V1 00:30] y");
    expect(normalizeCitations("a [link](https://x.y) and [S1, S2] stay")).toBe("a [link](https://x.y) and [S1, S2] stay");
    const r = checkAnswer(
      TED,
      "No system teaches dance every day the way it teaches mathematics [V1 09:06, 09:15].\n\nChildren starting school this year will retire around 2065 [V1 02:16](https://www.youtube.com/watch?v=iG9CE55wbtY&t=136s).",
    );
    expect(r).toMatchObject({ claims: 2, citations: 3, problems: [] });
  });

  it("measures the slack from the stamp a reader sees, and notes claims grounded only by [M]", () => {
    // The first segment starts at 27.103 s and shows as 00:27.
    expect(checkAnswer(TED, "He opens the talk by greeting the audience warmly [V1 00:22].")).toMatchObject({ problems: [] });
    const r = checkAnswer(TED, "He says schools squander the talents of every single child [M].");
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.map((p) => p.kind)).toEqual(["meta-only"]);
  });

  it("reports each claim on its own line, even when two start alike", () => {
    const r = checkAnswer(TED, "Robinson says the same thing about testing twice here.\n\nRobinson says the same thing about testing twice here.\n");
    if ("error" in r) throw new Error(r.error);
    expect(r.problems.map((p) => p.line)).toEqual([1, 3]);
  });
});

describe("checkAnswer on a corpus", () => {
  let root: string;
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), "ultrawatch-check-"));
    corpus(root);
  });
  afterEach(() => rmSync(root, { recursive: true, force: true }));

  it("resolves V# through corpus.json", () => {
    const videos = videosOf(root);
    if ("error" in videos) throw new Error(videos.error);
    expect([...videos.keys()]).toEqual(["V1", "V2", "V3"]);
    const r = checkAnswer(root, "Elephants have long trunks, the first video says so [V1 00:15].\nGiraffes have long necks to reach the leaves [V2 1:00:55].");
    expect(r).toMatchObject({ videos: 3, problems: [] });
  });

  it("refuses a video the corpus lists but never read", () => {
    const r = checkAnswer(root, "The third video explains everything about zebras in detail [V3 00:10].");
    if ("error" in r) throw new Error(r.error);
    expect(r.problems[0]!.message).toBe("[V3 00:10] — V3 was never read (private video), so it grounds nothing");
  });

  it("accepts a stamp on a frame where nothing is said", () => {
    writeFileSync(
      join(root, "aaaaaaaaaaa", "frames.json"),
      JSON.stringify([{ file: "frames/0001_01-40.jpg", time: 100.4, stamp: "01:40", kind: "scene", text: "" }]),
    );
    expect(checkAnswer(root, "The slide on screen lists three causes of the problem [V1 01:40].")).toMatchObject({ problems: [] });
    const r = checkAnswer(root, "The slide on screen lists three causes of the problem [V1 01:20].");
    if ("error" in r) throw new Error(r.error);
    expect(r.problems[0]!.message).toBe("[V1 01:20] — nothing is said or shown in V1 around 01:20 (±5 s)");
  });

  it("labels separately fetched videos in the order --videos gives, and asks for it otherwise", () => {
    rmSync(join(root, "corpus.json"));
    const r = checkAnswer(root, "Elephants have long trunks, the first video says so [V1 00:15].");
    expect(r).toEqual({
      error: `${root} holds 2 videos and no corpus — pass --videos <id,id,…> to say which is V1, V2… (aaaaaaaaaaa, bbbbbbbbbbb)`,
    });
    const ordered = checkAnswer(
      root,
      "Giraffes have long necks to reach the leaves [V1 1:00:55].\n\nElephants have long trunks, the other video says so [V2 00:15].",
      {
        videos: ["bbbbbbbbbbb", "aaaaaaaaaaa"],
      },
    );
    expect(ordered).toMatchObject({ videos: 2, problems: [] });
  });

  it("says plainly when corpus.json is unreadable", () => {
    writeFileSync(join(root, "corpus.json"), "{ not json");
    expect(checkAnswer(root, "x")).toEqual({ error: `${join(root, "corpus.json")} is not a readable corpus — run \`ultrawatch list\` again` });
  });

  it("says when a directory is neither a run nor a corpus", () => {
    const empty = mkdtempSync(join(tmpdir(), "ultrawatch-empty-"));
    expect(checkAnswer(empty, "x")).toEqual({ error: `${empty} is neither a video run (meta.json, segments.json) nor a corpus (corpus.json)` });
    rmSync(empty, { recursive: true, force: true });
  });
});
