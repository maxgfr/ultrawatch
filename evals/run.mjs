#!/usr/bin/env node
// ultrawatch evals, run against the BUILT bundle (scripts/ultrawatch.mjs) — the
// thing users install — never against the source.
//
// Four real videos, chosen for the rung each one exercises:
//   ted         manual subtitles           (Sir Ken Robinson, TED)
//   carbonara   auto-captions only, French (Les Food'Cuisine)
//   arraymap    no subtitles at all → whisper (Fireship, 100 Seconds of Code)
//   typescript  a code tutorial, for frames (Fireship)
//
// offline  replays the frozen runs in evals/cases/<name>/ (meta.json,
//          segments.json, TRANSCRIPT.md, captured once from the real videos):
//          every question must find its passage in the top 3, the good answer
//          must pass `check`, the bad one must fail with the expected count.
//          Deterministic, no network — this is what CI runs.
// network  reads each video again through yt-dlp and asserts the rung that
//          read it and the same questions against the fresh run. Needs
//          yt-dlp (and uvx + ffmpeg for arraymap); never run in CI.
import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const bundle = join(here, "..", "scripts", "ultrawatch.mjs");
const suite = process.argv.includes("--suite") ? process.argv[process.argv.indexOf("--suite") + 1] : "offline";
if (suite !== "offline" && suite !== "network") {
  console.error(`evals: --suite must be offline or network, not "${suite}"`);
  process.exit(2);
}

/** Run the bundle; returns exit status and parsed JSON stdout. */
function cli(args) {
  try {
    const out = execFileSync(process.execPath, [bundle, ...args, "--json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 30 * 60_000 });
    return { status: 0, json: JSON.parse(out) };
  } catch (e) {
    let json;
    try {
      json = JSON.parse(e.stdout ?? "");
    } catch {
      /* not JSON: a usage error */
    }
    return { status: e.status ?? 1, json, stderr: String(e.stderr ?? "") };
  }
}

// `check` notes that do not fail it: a stamp only in a sources list, a claim grounded by [M].
const NOTES = new Set(["inert", "meta-only"]);

let failed = 0;
let passed = 0;
const ok = (cond, what) => {
  if (cond) passed++;
  else failed++;
  console.log(`  ${cond ? "ok  " : "FAIL"} ${what}`);
};

const cases = readdirSync(join(here, "cases")).sort();
for (const name of cases) {
  const dir = join(here, "cases", name);
  const spec = JSON.parse(readFileSync(join(dir, "case.json"), "utf8"));
  console.log(`${name} — ${spec.kind}`);
  let runDir = dir;

  if (suite === "network") {
    const out = mkdtempSync(join(tmpdir(), `ultrawatch-eval-${name}-`));
    const r = cli(["fetch", spec.url, "--out", out]);
    ok(r.status === 0, `fetch ${spec.url} (${r.status === 0 ? r.json.via : (r.json?.reason ?? r.stderr.trim())})`);
    if (r.status !== 0) continue;
    ok(r.json.via === spec.via, `read through ${spec.via} (got ${r.json.via})`);
    runDir = r.json.dir;
  }

  for (const { q, window } of spec.questions) {
    const r = cli(["search", ...q.split(" "), "--out", runDir, "--limit", "3"]);
    const hits = r.json?.hits ?? [];
    // A passage covers [start, start + ~45 s]: it answers when it overlaps the window.
    const hit = hits.find((h) => h.start <= window[1] && h.start + 45 >= window[0]);
    ok(!!hit, `"${q}" → ${hit ? `[${hit.stamp}]` : `nothing in ${window.join("–")} s (top: ${hits.map((h) => h.stamp).join(", ") || "none"})`}`);
  }

  if (suite === "offline") {
    const good = cli(["check", dir, join(dir, "answer.good.md")]);
    const goodFails = (good.json?.problems ?? []).filter((p) => !NOTES.has(p.kind));
    ok(good.status === 0 && goodFails.length === spec.answers.good, `good answer passes check (${goodFails.map((p) => p.message).join("; ") || "clean"})`);
    const bad = cli(["check", dir, join(dir, "answer.bad.md")]);
    const badFails = (bad.json?.problems ?? []).filter((p) => !NOTES.has(p.kind));
    ok(bad.status === 1 && badFails.length === spec.answers.bad, `bad answer fails check with ${spec.answers.bad} problems (got ${badFails.length})`);
  }
}

console.log(`\nevals (${suite}): ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
