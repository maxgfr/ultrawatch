import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { VideoRunner } from "../src/engine.js";
import { extractLocalFrames, fetchLocalRun, isLocalVideo, localFileOf, localIdentity } from "../src/local.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ultrawatch-local-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const probe = { format: { duration: "60.0" }, chapters: [{ start_time: "30.0", end_time: "60.0", tags: { title: "Second half" } }] };
const words = (n: number) => Array.from({ length: n }, (_, i) => `mot${i}`).join(" ");

/** ffprobe answers `probe`; ffmpeg drops a wav; whisper writes its JSON next to it. */
function fakeTools(calls: string[]): VideoRunner {
  return async (cmd, args) => {
    calls.push(cmd);
    if (cmd === "ffprobe") return { ok: true, status: 0, stdout: JSON.stringify(probe), stderr: "" };
    if (cmd === "ffmpeg") writeFileSync(args[args.length - 1]!, "");
    if (cmd === "uvx") {
      const out = args[args.indexOf("--output_dir") + 1]!;
      const segments = [
        { start: 0, end: 20, text: ` ${words(20)}` },
        { start: 31, end: 50, text: ` ${words(20)}` },
      ];
      writeFileSync(join(out, "speech.json"), JSON.stringify({ segments }));
    }
    return { ok: true, status: 0, stdout: "", stderr: "" };
  };
}

describe("a local video file", () => {
  it("is told apart from a URL", () => {
    const f = join(dir, "a.webm");
    writeFileSync(f, "");
    expect(isLocalVideo(f)).toBe(true);
    expect(isLocalVideo(join(dir, "missing.webm"))).toBe(false);
    expect(isLocalVideo("https://www.youtube.com/watch?v=jNQXAC9IVRw")).toBe(false);
  });

  it("keys a yt-dlp file name by its YouTube id, any other by a slug and hash", () => {
    expect(localIdentity("/x/Iran： le monde [rA2Dw0SYMHI].webm")).toEqual({
      key: "rA2Dw0SYMHI",
      title: "Iran： le monde",
      youtubeId: "rA2Dw0SYMHI",
    });
    const other = localIdentity("/x/My Talk.mp4");
    expect(other.key).toMatch(/^local-my-talk-[0-9a-f]{8}$/);
    expect(other.title).toBe("My Talk");
  });

  it("is transcribed by local whisper into a run, then reused without any tool", async () => {
    const f = join(dir, "Talk [jNQXAC9IVRw].webm");
    writeFileSync(f, "");
    const calls: string[] = [];
    const r = await fetchLocalRun(f, join(dir, "runs"), { lang: "fr", run: fakeTools(calls) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(calls).toEqual(["ffprobe", "ffmpeg", "uvx"]);
    expect(r.id).toBe("jNQXAC9IVRw");
    const md = readFileSync(r.transcript, "utf8");
    expect(md).toContain("# Talk");
    expect(md).toContain("https://www.youtube.com/watch?v=jNQXAC9IVRw");
    expect(md).toContain("## Second half");
    expect(md).toContain("[00:31]");
    expect(existsSync(join(r.dir, "segments.json"))).toBe(true);

    const again = await fetchLocalRun(f, join(dir, "runs"), { lang: "fr", run: fakeTools(calls) });
    expect(again.ok && again.reused).toBe(true);
    expect(calls).toHaveLength(3);
  });

  it("prefers a sidecar .vtt over whisper", async () => {
    const f = join(dir, "clip.mp4");
    writeFileSync(f, "");
    writeFileSync(join(dir, "clip.fr.vtt"), `WEBVTT\n\n00:01.000 --> 00:20.000\n${words(30)}\n\n00:31.000 --> 00:50.000\n${words(30)}\n`);
    const calls: string[] = [];
    const r = await fetchLocalRun(f, join(dir, "runs"), { lang: "fr", run: fakeTools(calls) });
    expect(r.ok && r.meta.via).toBe("manual-subs");
    expect(calls).toEqual(["ffprobe"]);
  });

  it("takes its frames from the file itself: yt-dlp is never run", async () => {
    const f = join(dir, "Talk [jNQXAC9IVRw].webm");
    writeFileSync(f, "");
    const r = await fetchLocalRun(f, join(dir, "runs"), { run: fakeTools([]) });
    if (!r.ok) throw new Error(r.reason);
    expect(localFileOf(r.dir)).toBe(f);
    const seen: { cmd: string; input?: string }[] = [];
    const seenArgs: string[][] = [];
    const tools: VideoRunner = async (cmd, args) => {
      const input = args[args.indexOf("-i") + 1];
      seen.push({ cmd, input });
      if (cmd === "ffmpeg") seenArgs.push(args);
      return { ok: true, status: 0, stdout: "", stderr: "" };
    };
    await extractLocalFrames(r.dir, f, { effort: "low", run: tools, have: () => true });
    expect(seen.some((c) => c.cmd === "yt-dlp")).toBe(false);
    const ffmpeg = seen.find((c) => c.cmd === "ffmpeg");
    expect(ffmpeg?.input).toMatch(/video\.webm$/);
    const scene = seenArgs.find((a) => a.some((x) => x.startsWith("select='gt(scene")));
    expect(scene?.slice(0, 2)).toEqual(["-skip_frame", "nokey"]);
  });
});
