# Frames — what is on screen

The transcript says what was said. Slides, code, diagrams, charts and demos
are shown, and often never read aloud. `frames` gets them:

```bash
ultrawatch frames "<url>" --effort low --out <dir>   # at most 20 frames; med 50, high 100
```

It downloads the video at 720p at most into a temporary directory (deleted
afterwards), takes a frame at every scene change and just after every chapter
start — evenly spaced ones for a video with neither — drops near-duplicates,
and keeps the most widely spaced. It needs ffmpeg.

## Reading them

`<dir>/<id>/FRAMES.md` lists every frame with its stamp, chapter, image path
(`frames/0005_00-42.jpg`) and what was said from 5 s before to 10 s after.

1. Read `FRAMES.md` to see which frames matter to the question.
2. **Open the images** — a frame's text is only what was said near it, never
   what it shows. Read code, slide titles and numbers off the image itself.
3. Cite a frame by its stamp, like speech: "the slide at 04:12 lists three
   causes [V1 04:12]". Say it comes from the screen when that matters. `check`
   accepts a stamp within 5 s of a kept frame even where nothing is said —
   but only once `frames` has run for that video.

## Choosing the effort

- `low` (20) for a summary, or a talk with a few slides.
- `med` (50, the default) for a tutorial followed step by step.
- `high` (100) only when the user wants every screen of a long demo — it is
  many images to read.

A second `frames` on the same video replaces the earlier set.
