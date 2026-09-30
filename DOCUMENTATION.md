# ultrawatch — how it works

A companion to the [README](./README.md). ultrawatch is a thin CLI over the vendored
[webindex](https://github.com/maxgfr/webindex) video engine plus a markdown playbook: the engine
watches, keeps and finds; the AI (via the SKILL) reads and writes; `check` holds it to what the
video says.

## The pipeline

```
fetch ─┬─> <dir>/<key>/TRANSCRIPT.md, segments.json, meta.json   (a video, kept)
list  ─┘   <dir>/CORPUS.md, corpus.json                          (V1…Vn)
search ──> ~45 s passages, each stamped at the segment that answers
frames ──> <key>/frames/*.jpg + FRAMES.md (what was said around each)
answer.md (written by the agent, citing [V# mm:ss]) ──> check ──> OK | line-by-line problems
```

## Reading a video

The engine resolves the URL (YouTube, Vimeo through its player, Dailymotion, Twitch, TED, Loom,
TikTok, X… or any page yt-dlp reads), probes it once with `yt-dlp -J`, and tries three rungs:
manual subtitles (WebVTT or SRT), the video's own auto-captions (never a machine translation;
rolling captions de-duplicated), then local whisper (`uvx whisper-ctranslate2`, budgeted). A rung
passes only at 5 words a minute or more. Chapters become headings; segments never straddle one.

A run is kept under the YouTube id, or `<site>-<id>`; a known host's run is reused with no yt-dlp
call. Frames come from a temporary download at 720p at most: scene changes above 0.3 and chapter
starts, deduplicated by a 64-bit dHash, capped at 20/50/100.

## The citation gate

`check <run> <answer.md>` parses the answer into claim units with the engine's claim parser
(paragraphs, list items, table rows, blockquotes; code and a closing sources list set aside). It
fails when:

1. a claim of six words or more carries no `[V# mm:ss]` or `[M]`;
2. a `V#` is not in the run (a single video is `V1`; a corpus names its own; `--videos` orders
   videos fetched one by one), or was listed but never read;
3. a stamp is past the end of its video;
4. a stamp lands on nothing said or shown — no transcript segment and no kept frame within 5 s of
   the stamp as a reader sees it.

Linked stamps (`[V1 00:30](…)`) and shorthand (`[V1 09:06, 09:15]`) are read as plain ones. A claim
grounded only by `[M]` is noted; an answer with no claim fails.

## Build & release

`tsup` bundles `src/cli.ts` and the engine into `scripts/ultrawatch.mjs` (Node 18, zero
dependencies); `webindex skill copy` mirrors it into the skill package. `check:build` proves the
committed bundle is the one the source builds, and runs the packaging gates. semantic-release cuts
a GitHub Release on every `feat`/`fix` push to `main`, and the daily `engine-repin` workflow moves
the engine pin forward when — and only when — the whole gate stays green
([ENGINE-MAINTENANCE.md](ENGINE-MAINTENANCE.md)).

## Evals

`pnpm eval` replays four frozen real videos (manual subtitles, French auto-captions, whisper, a
code tutorial): each question must find its passage in the top 3, each gold answer must pass
`check` and each bad one fail with the expected problems. `pnpm eval:network` reads the same videos
again through yt-dlp; it runs weekly in CI, report-only.
