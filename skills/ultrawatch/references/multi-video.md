# Several videos

```bash
ultrawatch list "<playlist-or-channel-url>" --limit 5 --out <dir>
ultrawatch search "<question>" --out <dir>          # hits labelled V1…Vn
ultrawatch check <dir> answer.md                    # V# resolved through corpus.json
```

`list` reads the first `--limit` videos (default 10) in the order the site lists
them — a channel's `/videos` tab, newest first, when the URL names no tab —
two at a time, each kept as its own run. `CORPUS.md` names them `V1`…`Vn`; a
video that cannot be read keeps its label, with the reason, so the numbering
never shifts under an answer.

For videos the user names one by one, `fetch` each into the same `--out`
directory and fix their order once, with `--videos <id,id,…>` (V1 first):

```bash
ultrawatch search "<question>" --out <dir> --videos <id1>,<id2>    # hits labelled V1, V2
ultrawatch check <dir> answer.md --videos <id1>,<id2>              # the same V1, V2
```

Give the mapping (label, title, link) at the top of the answer.

## Comparing

1. Read each transcript's header and chapters first: what each video covers,
   and how long it spends on it.
2. Search the corpus for each point of comparison; a point one video never
   addresses is a finding, say so.
3. Cite each side: "V1 recommends X [V1 03:10], V3 argues against it [V3 12:02]".
4. Mind the dates `[V2 M]`: an older video may predate what a newer one reacts to.

## Budget

Reading is cheap for videos with subtitles (seconds each) and slow for those
without: whisper takes minutes per video, and one process transcribes at most
three (`ULTRAWATCH_WHISPER_MAX`). Keep `--limit` to what the question needs.
