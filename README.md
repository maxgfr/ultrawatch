# ultrawatch

Watch videos for your agent — YouTube, Vimeo, Dailymotion and anything
[yt-dlp](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) reads. A video, a playlist or a channel becomes a
timestamped, chaptered transcript and the frames that show what was on screen,
kept on disk and searchable. The agent answers from what the video actually
says, and every claim cites the second that says it, as `[V1 12:34]`.
`ultrawatch check` proves each stamp exists.

Local and keyless: [yt-dlp](https://github.com/yt-dlp/yt-dlp), the video's own
subtitles, and whisper running on your machine. No API and no key.

```bash
npx skills add maxgfr/ultrawatch
```

## Invocation

In Claude Code, Codex or any [skills.sh](https://skills.sh) agent, the skill runs
on request: `/ultrawatch` followed by a link and what you want, or simply asking
the agent to watch or summarize a video. It never starts on its own — see
[On request or explicit-only](#on-request-or-explicit-only).

```
/ultrawatch summarize https://www.youtube.com/watch?v=iG9CE55wbtY
/ultrawatch what does he say about mistakes? (same video, no re-download)
/ultrawatch what code is on screen in https://youtu.be/zQnBQ4tB3ZA
/ultrawatch compare the first 5 videos of https://www.youtube.com/playlist?list=…
/ultrawatch résume cette vidéo en français : https://youtu.be/…
```

## Why

An agent handed a video link sees a title and a description, and usually
answers from those plus memory. The video itself, what it says and what it
shows, never reaches the model. When it does, it arrives as a transcript
pasted without timestamps: it cannot be cited, cannot be checked, and has to
be fetched again for every follow-up question.

ultrawatch reads the video once and keeps it on disk. After that the agent
works from text that carries a stamp on every paragraph.

## What you get

| | |
|---|---|
| **A citable transcript** | Manual subtitles, else the video's own auto-captions (never one of YouTube's machine translations; rolling captions de-duplicated), else a local whisper transcription. A `##` heading per chapter and a `[mm:ss]` stamp per paragraph. A translated track is labelled as one. |
| **Read once, ask many times** | `<dir>/<id>/` holds `TRANSCRIPT.md`, `segments.json` and `meta.json`. A second question searches what is already there, with no YouTube call. |
| **What is on screen** | A frame at every scene change and chapter start, near-duplicates dropped by dHash, capped by `--effort`, each paired with what was said around it (`FRAMES.md`). |
| **Several videos** | A playlist or channel read as a corpus, `V1`…`Vn`, and searched as one. |
| **A citation check** | `check` fails any claim without a stamp, any `V#` that is not there, and any stamp that is past the end of its video or lands where nothing is said. It reports line by line. |
| **Errors that say what to do** | Private, members-only, age-restricted, DRM-protected, removed, live, or refused by the site: each one comes back as a note, and `doctor` shows how old your yt-dlp is. |

## How it's used

1. `ultrawatch fetch <url>`: the transcript lands in `<dir>/<id>/TRANSCRIPT.md`.
2. The agent reads it, or runs `ultrawatch search "<question>"` for a precise answer.
3. For the visuals: `ultrawatch frames <url> --effort low`, then the agent reads the images.
4. The agent writes the answer, citing `[V1 mm:ss]`, and runs `ultrawatch check <run> answer.md` until it passes.

## Commands

| Command | What it does |
|---|---|
| `ultrawatch fetch <url>` | One video into `<dir>/<id>/`, reused on the next call (`--refresh` reads it again, `--lang` picks the subtitle language). |
| `ultrawatch search <query>` | The ~45 s passages that answer, each with its stamp, chapter and a link that opens the video there, labelled as you cite them (`--limit`, `--videos`). |
| `ultrawatch frames <url\|id\|dir>` | The frames that matter, at most 20/50/100 (`--effort low\|med\|high`), aligned with the transcript. Needs ffmpeg. |
| `ultrawatch list <playlist\|channel>` | The first `--limit` videos (default 10) read as a corpus, `CORPUS.md` naming them `V1`…`Vn`. |
| `ultrawatch check <run> <answer.md>` | Every claim cited, every stamp on something said or shown. Exits 1 with a report otherwise. `--videos <id,id,…>` numbers videos fetched one by one. |
| `ultrawatch doctor` | yt-dlp and its age, ffmpeg, uvx, the whisper model, the rungs, the run directory. |

`fetch`, `search`, `frames` and `list` take `--out <dir>` (the default is
`ULTRAWATCH_VIDEO_DIR`, else `<tmp>/ultrawatch/video`); every command takes
`--json`. Requirements:

- Node ≥ 18 and yt-dlp, which is required.
- ffmpeg, for frames and whisper.
- [uv](https://docs.astral.sh/uv/), for whisper. The `small` model, about 500 MB, is downloaded on first use.

| Variable | Sets |
|---|---|
| `ULTRAWATCH_VIDEO_DIR` | where runs are kept |
| `ULTRAWATCH_VIDEO_ENGINES` | the transcript rungs, in order: `manual-subs,auto-subs,whisper`, or `none` |
| `ULTRAWATCH_WHISPER_MODEL`, `ULTRAWATCH_WHISPER_MAX`, `ULTRAWATCH_WHISPER_TIMEOUT_MS` | whisper's model (`small`), videos per process (3), one video's budget (30 min) |
| `ULTRAWATCH_YTDLP_ARGS` | extra yt-dlp flags on every call, such as browser cookies when a site asks you to sign in, or a proxy |
| `ULTRAWATCH_NO_WRITE` | write nothing: `fetch` prints the transcript |

## Security

- No API and no key. Nothing leaves the machine except yt-dlp's requests to the video's site.
- A URL is only ever handed to yt-dlp after `--`, and only if it is http(s), so a string can never be read as an option. A known host's URL is rebuilt from its id first (a YouTube watch URL, Vimeo's player).
- Videos are downloaded only for frames and whisper, into a temporary directory that is deleted afterwards. Only the JPEGs you asked for stay.
- The engine is [webindex](https://github.com/maxgfr/webindex), vendored by tag and sha256 (`src/vendor/webindex.meta.json`) and checked in CI (`webindex skill vendor --check`).

## Maintenance

How it works, in depth: [DOCUMENTATION.md](DOCUMENTATION.md). Contributing: [CONTRIBUTING.md](CONTRIBUTING.md). See [shared engine maintenance](ENGINE-MAINTENANCE.md) for the engine pin, source adoption checks and the daily repin workflow.

## License

MIT.

## On request or explicit-only

The skill ships **model-invocable, on request**: the agent may call it through
its skill tool, but the skill's description restricts it to explicit requests,
so the agent calls it when you ask, not on its own. Install it with `npx skills
add maxgfr/ultrawatch`, or use the bundle directly: `node
skills/ultrawatch/scripts/ultrawatch.mjs --help`.

Making it explicit-only is one setting per host, applied to the **installed**
copy of the skill:

| Host | Shipped, on request | Explicit-only |
| --- | --- | --- |
| Claude Code | no `disable-model-invocation` in `SKILL.md` | add `disable-model-invocation: true` |
| Codex | `allow_implicit_invocation: true` under `policy:` in `agents/openai.yaml` | set it to `false` |
| OpenCode | `metadata.opencode/autoinvoke: 'true'` in `SKILL.md` | set it to `'false'` |

Claude Code can do it without touching the file:
`"skillOverrides": { "ultrawatch": "user-invocable-only" }` in `settings.json`
leaves `/ultrawatch` working while hiding the skill from the model. Plugin installs
ignore `skillOverrides`, so edit the frontmatter there. Updating or reinstalling
the skill restores the shipped default, so reapply the change afterwards.
