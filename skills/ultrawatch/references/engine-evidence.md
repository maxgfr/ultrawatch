# Engine evidence

ultrawatch vendors the [webindex](https://github.com/maxgfr/webindex) engine
(pinned by tag and sha256 in `src/vendor/webindex.meta.json`); everything below
is that engine's video layer, configured under the `ULTRAWATCH_` prefix.

## Which sites

Anything yt-dlp reads: YouTube, Vimeo (through its player, which needs no
login), Dailymotion, Twitch, TED, Loom, TikTok, Instagram reels, Facebook
videos, X posts and [hundreds more](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md).
A run is kept under the YouTube id, or `<site>-<id>` elsewhere
(`vimeo-76979871`) — the key `--videos` takes. Subtitles are read in WebVTT or
SRT; a site without them goes to whisper. A video served only under DRM keeps
its subtitles but gives no frames and no whisper, and the note says so.

## How a video is read

| Rung | Source | Trust |
|---|---|---|
| `manual-subs` | subtitles a person typed | exact, punctuated — quote freely |
| `auto-subs` | the site's own speech recognition (YouTube's), in the video's language | good; names, numbers and jargon can be misheard |
| `whisper` | local transcription (`uvx whisper-ctranslate2`, model `small`) | good; slower, same caveats |

The transcript header says which (`- Transcript: … (auto-subs, track en-orig)`).
A rung is accepted only if its transcript holds at least 5 words a minute, so a
music video's three captioned lines do not pass for a transcript. Rolling
auto-captions are de-duplicated; a machine translation is never used, and a
manual track in another language than the video's is marked as a translation.

## Failure notes, and what to do

| Note | Meaning / action |
|---|---|
| `install yt-dlp` | nothing works without it: `brew install yt-dlp` or `pipx install yt-dlp` |
| `YouTube refused yt-dlp …` | a 403, "Sign in to confirm you're not a bot" or a PO-token error: update yt-dlp (`yt-dlp -U`; `doctor` flags a release older than 60 days), or set `ULTRAWATCH_YTDLP_ARGS="--cookies-from-browser firefox"` |
| `age-restricted video` | needs a signed-in session: the same cookies variable |
| `private video`, `members-only video`, `video removed`, `video unavailable` | not readable — tell the user |
| `the site asks yt-dlp to log in` | a signed-in session: `ULTRAWATCH_YTDLP_ARGS="--cookies-from-browser firefox"` |
| `the site serves this video under DRM` | subtitles still read; no frames, no whisper |
| `no video at this URL` | the page holds no video yt-dlp can read |
| `live stream in progress` / `not started yet` | read it once it has ended |
| `no subtitles, and whisper needs uvx and ffmpeg` | install [uv](https://docs.astral.sh/uv/) and ffmpeg, or tell the user there is no transcript |
| `transcript too sparse …` | music or a silent video: nothing is said to cite — tell the user |
| `this run's whisper budget is spent` | raise `ULTRAWATCH_WHISPER_MAX`, or read fewer videos |

## Variables

| Variable | Sets |
|---|---|
| `ULTRAWATCH_VIDEO_DIR` | where runs are kept (default `<tmp>/ultrawatch/video`) |
| `ULTRAWATCH_VIDEO_ENGINES` | the rungs, in order: `manual-subs,auto-subs,whisper`, or `none` |
| `ULTRAWATCH_WHISPER_MODEL` | whisper's model (default `small`, ~500 MB the first time) |
| `ULTRAWATCH_WHISPER_MAX` | videos one process may transcribe locally (default 3) |
| `ULTRAWATCH_WHISPER_TIMEOUT_MS` | one video's whisper budget, download included (default 1800000) |
| `ULTRAWATCH_YTDLP_ARGS` | extra yt-dlp flags on every call, split on whitespace |
| `ULTRAWATCH_NO_WRITE` | write nothing: `fetch` prints the transcript; `frames` and `list` refuse |

## Limits

- Frames are sampled, not exhaustive: a slide shown for two seconds between
  two scene cuts can be missed; `--effort high` narrows the gap.
- `search` is lexical (BM25F): search in the video's own language and words.
- A stamp is the start of a segment of one to three sentences (30 s at most);
  the claim is somewhere in that segment.
