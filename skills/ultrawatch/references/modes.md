# Modes

Three ways to use one video. All start from the same run: `ultrawatch fetch
<url> --out <dir>` writes `<dir>/<id>/TRANSCRIPT.md`, and nothing after that
touches the site again.

## Summary

1. `fetch`, then read `TRANSCRIPT.md` **whole**, through its last stamp — a
   summary built from search hits misses what the video spends most of its
   time on. When the output comes back truncated or compressed, read the file
   again in line ranges until every paragraph has been seen.
2. Follow the chapters when there are any: they are the author's own outline.
   Weight them by length; a two-minute sponsor segment is not a third of the
   video.
3. Write 3–7 points, each citing the stamp where the point is made (or best
   made). Open with one sentence on what the video is and who made it `[M]`.
4. For a long video (over ~40 minutes), read chapter by chapter and summarise
   each before the whole; cite the stamps inside, never only the chapter start.

## Question

1. `fetch`, then `ultrawatch search "<question in the video's words>" --out <dir>`.
2. Read the top passages, then the paragraphs around them in `TRANSCRIPT.md`: a
   45-second passage can start mid-argument.
3. Answer from what is said. If the video never answers the question, say so —
   and say what it does say nearest to it.
4. Search in the video's language: a French video searched in English finds
   only the words the two share.

## Follow-up

The video is already on disk: **do not fetch it again**. `search` the same
`--out` directory, or reread the transcript. `--refresh` is for the user asking
for a fresh read (a video re-uploaded with new subtitles).

## When there is no transcript

The note says why (see [engine-evidence](engine-evidence.md)). Tell the user,
and do not guess the content from the title. Without a transcript there is no
run, so `frames` and `check` have nothing to work from either: install what the
note asks for (uvx and ffmpeg unlock whisper), or say the video cannot be read.
