# Citation format

A citation is a bracket holding a video label and a stamp.

| Form | Means |
|---|---|
| `[V1 12:34]` | video V1, 12 min 34 s in |
| `[V2 1:02:03]` | past an hour: `h:mm:ss` |
| `[V1 12:34; V2 03:10]` | several at once — `;` or `,` between them |
| `[V1 09:06, 09:15]` | one video, several stamps |
| `[V1 12:34](https://…&t=754s)` | a stamp made a link — read as `[V1 12:34]` |
| `[M]` | the run's header: title, channel, publication date, duration |
| `[V2 M]` | V2's header, in a corpus |

- **One video is `V1`.** A run fetched on its own is cited as `V1`; a corpus
  numbers its videos in `CORPUS.md`; videos fetched one by one are numbered by
  `--videos <id,id,…>`, the same list for `search` and `check`.
- **Use the segment's stamp.** Every paragraph of `TRANSCRIPT.md` and every
  search hit starts with its own stamp; cite that one. `check` allows 5 s of
  slack either way, not more.
- **A stamp is where the words are**, not where the topic starts. A claim that
  spans two passages cites both.
- `[M]` grounds only what the header says. "The video is from 2007" is `[M]`;
  "the speaker is a professor" is not, unless the video says it — then cite
  where.

## What counts as a claim

A paragraph, a list item, a table row and a blockquote are each one claim —
Markdown's own blocks, so consecutive lines with no blank line between them are
one paragraph. A citation anywhere in it covers the whole of it. Give each point
its own paragraph or bullet, and cite each one: a paragraph that strings three
points on one stamp is grounded on paper only.

## What `check` refuses

`ultrawatch check <run> <answer.md>` exits 1 and names the line when:

- a claim of six words or more carries no citation (`uncited claim`);
- a `V#` is not in the run (`V2 is not in this run`), or was listed but never
  read (`V3 was never read (private video)`);
- a stamp is past the end of its video (`V1 is only 20:03 long`);
- a stamp lands where nothing is said or shown (`nothing is said or shown in
  V1 around 00:05`) — a kept frame counts, once `frames` has run;
- the answer makes no claim at all.

Headings, code blocks and a `## Sources` or `## References` list **at the end**
are not claims (a sources heading anywhere else sets nothing aside). A stamp
that appears only there is noted — it grounds nothing — but does not fail the
check; nor does a claim grounded only by `[M]`, which is noted so you can see
it is not about what the video says.

## Quotes

Quote only what the transcript says, word for word, and only from manual
subtitles or when you say the transcript is automatic. Never quote a track the
header marks as a translation.
