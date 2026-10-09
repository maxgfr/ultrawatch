---
name: ultrawatch
description: Watch videos for the user — YouTube, Vimeo, Dailymotion and anything yt-dlp reads — and answer from what they actually say and show — a summary, the visuals, a follow-up question on a video already watched, or several videos at once (a playlist, a channel) — every claim citing a [V# mm:ss] stamp checked against the transcript. Use only when the user explicitly asks for ultrawatch or for a video to be watched, e.g. "summarize this video", "what does he say about…", "what's on screen", "compare these videos", "résume cette vidéo", "que dit-il sur…", "qu'est-ce qu'on voit", "compare ces vidéos", "regarde cette playlist". Local and keyless — yt-dlp, the video's own subtitles, local whisper.
license: MIT
metadata:
  version: 1.2.1
  opencode/autoinvoke: 'true'
---

# ultrawatch — watch the video, cite the second

**The tool watches; you answer.** `ultrawatch` turns a video into a timestamped,
chaptered transcript and the frames that show what was on screen, keeps them on
disk, and checks your answer. You read, reason and write — and every claim you
write points at the second of the video that says it.

## Invariants

1. **Never answer from the title, the description or memory.** Fetch, then read
   `TRANSCRIPT.md` (or search it). No transcript, no claim.
2. **Every claim cites a stamp**: `[V1 12:34]`, several as `[V1 12:34; V2 03:10]`.
   `[M]` (or `[V2 M]`) only for what the header says: title, channel, date, duration.
   See [citation-format](references/citation-format.md).
3. **A translation is not a quote.** When the transcript header says
   `— a translation: the video speaks en`, paraphrase; never put words in quotes.
4. **Say how it was read.** Auto-captions and whisper mishear names and numbers:
   when a claim hangs on one, say the transcript is automatic.
5. **Run `check` before you answer.** Fix every line it reports; do not ship a
   failing answer.
6. **Read once.** A video already fetched is on disk: search it, do not fetch it
   again (`--refresh` only when the user asks for a fresh read).

## Run it

The bundle is self-contained — Node ≥ 18, no install. Call it by absolute path:
`<skill-dir>` is the directory holding this file, and every `ultrawatch …`
below stands for `node <skill-dir>/scripts/ultrawatch.mjs …`.

```bash
node <skill-dir>/scripts/ultrawatch.mjs doctor                          # yt-dlp (required), ffmpeg, uvx
node <skill-dir>/scripts/ultrawatch.mjs fetch "<url>" --out <dir> --json  # → <dir>/<id>/TRANSCRIPT.md
```

Pick one absolute `--out <dir>` per task and pass it to every command, so
fetch, search, frames and check all see the same runs. Without it, runs land in
`<tmp>/ultrawatch/video`, which the system may clear.

## Routing

| The user wants | Do | Read |
|---|---|---|
| a summary of one video | `fetch`, read `TRANSCRIPT.md` whole, follow its chapters | [modes](references/modes.md) |
| an answer to a question about a video | `fetch`, then `search "<question>"`, read the passages | [modes](references/modes.md) |
| a follow-up about a video already fetched | `search` only — no new fetch | [modes](references/modes.md) |
| what is shown: slides, code, diagrams, a demo | `frames <url> --effort low`, read the images FRAMES.md lists | [frames](references/frames.md) |
| several videos: a playlist, a channel, a comparison | `list <url> --limit n`, then `search`, cite `V1`…`Vn` | [multi-video](references/multi-video.md) |
| to know why a video could not be read | the note, then `doctor` | [engine-evidence](references/engine-evidence.md) |

## Commands

```bash
ultrawatch fetch <url> [--out <dir>] [--lang <tag>] [--refresh] [--json]
ultrawatch search <query> [--out <dir>] [--limit <n>] [--videos <id,id,…>] [--json]
ultrawatch frames <url|id|dir> [--effort low|med|high] [--out <dir>] [--lang <tag>] [--json]
ultrawatch list <playlist|channel> [--limit <n>] [--out <dir>] [--lang <tag>] [--refresh] [--json]
ultrawatch check <run> <answer.md> [--videos <id,id,…>] [--json]
ultrawatch doctor [--json]
```

- `fetch` — one video into `<dir>/<id>/`: `TRANSCRIPT.md` (header, `##` per
  chapter, `[mm:ss]` per paragraph), `segments.json`, `meta.json`. Manual
  subtitles → the video's own auto-captions → local whisper (minutes).
- `search` — ~45 s passages ranked against the question, each with its stamp,
  chapter and a link that opens the video there, labelled the way you cite it
  (`[V1 02:16]`: V1 for one video, V1…Vn in a corpus or by `--videos`).
- `frames` — a frame per scene change and chapter start, deduplicated, at most
  20/50/100; `FRAMES.md` pairs each with what was said around it. Needs ffmpeg.
- `list` — the first `--limit` videos (default 10) of a playlist or channel as a
  corpus, `CORPUS.md` naming them `V1`…`Vn`.
- `check` — `<run>` is a video's directory (`<dir>/<id>`, cited as `V1`), a
  corpus directory, or a directory of videos fetched one by one with `--videos`
  naming V1, V2…; exits 1 with a line-by-line report on any uncited claim,
  unknown `V#`, or stamp past the end or on nothing said or shown — and on an
  answer with no claim at all.

Exit codes: 0 done, 1 the answer is a failure (no transcript, nothing found, a
check failing), 2 the invocation was wrong.

## Write the answer

1. Lead with the answer, then the evidence; one idea per paragraph or bullet.
2. Cite the segment's own stamp — the one `TRANSCRIPT.md` or `search` shows —
   not a stamp you estimate.
3. Quote sparingly and exactly; mark auto-caption or whisper transcripts.
4. Write it to `<dir>/answer.md`, beside the runs; run
   `ultrawatch check <run> <dir>/answer.md`, fix, repeat until it passes.
5. End with the video's link, and the links a claim most depends on
   (`search` gives `…&t=Ns`).
6. Give the user every file by its absolute path: the answer, and each video's
   full transcript (`<dir>/<id>/TRANSCRIPT.md`) for reading beyond the answer.
   Say when `<dir>` sits under a temporary directory, and offer to copy them
   somewhere lasting.

## Will not

- Download or keep a video: frames work from a temporary copy that is deleted.
- Read a private, members-only, DRM-protected or removed video, or get around a site's
  refusals — `doctor` and [engine-evidence](references/engine-evidence.md) say
  what to do.
- Machine-translate: a translated track is labelled as one, never passed off.
- Send anything to an API: subtitles through yt-dlp, whisper on this machine.

## References

- [modes](references/modes.md) — summary, question, follow-up: what to read, in which order.
- [citation-format](references/citation-format.md) — `[V# mm:ss]`, `[M]`, grouping, and what `check` refuses.
- [frames](references/frames.md) — reading what is on screen, and citing it.
- [multi-video](references/multi-video.md) — corpora, `V1`…`Vn`, comparisons.
- [engine-evidence](references/engine-evidence.md) — the transcript rungs, their limits, and every failure note.
