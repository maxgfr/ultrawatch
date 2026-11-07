import { describe, expect, it } from "vitest";
import { citedSeconds, overviewHtml, speechRate, summarySections, videoParts } from "../src/overview.js";

const L = {
  overview: "Overview",
  duration: "duration",
  parts: "parts",
  cited: "cited",
  words: "words",
  rate: "rate",
  perMin: "w/min",
  outline: "Outline",
  outlineNote: "",
  partLength: "Length",
  speech: "Speech",
  speechNote: "",
  table: "Table",
  part: "Part",
  start: "Start",
  length: "Length",
  min: "min",
  locale: "en-US",
};

const summary = `# Title

> **In short**
> - early [V1 00:10] and late [V1 55:00]

## Opening
- a [V1 00:30]
- b [V1 02:00; 03:00]

## Middle
- c [V1 20:00]
- d [V1 25:00, 26:00] and another video [V2 40:00]

## End
- e [V1 40:00]
- f [V1 50:00]

## Takeaways
- g [V1 01:00]
- h [V1 58:00]
`;

describe("the overview", () => {
  it("reads the V1 stamps a summary cites, not another video's", () => {
    expect(citedSeconds("x [V1 01:00; 1:00:00] y [V2 02:00] z [V1 03:00, 04:00] [M]")).toEqual([60, 3600, 180, 240]);
    expect(summarySections(summary).map((s) => s.title)).toEqual(["Opening", "Middle", "End", "Takeaways"]);
  });

  it("takes the video's parts from the summary's sections in order, leaving out a recap that spans it all", () => {
    expect(videoParts(3600, [], summary)).toEqual([
      { title: "Opening", start: 0, end: 1200 },
      { title: "Middle", start: 1200, end: 2400 },
      { title: "End", start: 2400, end: 3600 },
    ]);
  });

  it("prefers the video's own chapters", () => {
    const chapters = [
      { start: 600, end: 3600, title: "Two" },
      { start: 0, end: 600, title: "One" },
    ];
    expect(videoParts(3600, chapters, summary)).toEqual([
      { title: "One", start: 0, end: 600 },
      { title: "Two", start: 600, end: 3600 },
    ]);
  });

  it("spreads each segment's words over the minutes it spans", () => {
    const { width, rate } = speechRate([{ start: 0, end: 120, text: Array(240).fill("w").join(" ") }], 240, 4);
    expect(width).toBe(60);
    expect(rate.map(Math.round)).toEqual([120, 120, 0, 0]);
  });

  it("renders figures, the outline, the part lengths and the speech rate, each part seeking the player", () => {
    const html = overviewHtml({ duration: 3600, segments: [{ start: 0, end: 60, text: "a b c" }], chapters: [], summary }, L);
    expect(html).toContain('class="tiles"');
    expect(html.match(/class="seg-part stamp-like" data-t="\d+"/g)).toHaveLength(3);
    expect(html.match(/class="bar-row/g)).toHaveLength(3);
    expect(html).toContain('<path class="line"');
    expect(html).toContain("<table>");
  });

  it("is empty without a duration or a transcript", () => {
    expect(overviewHtml({ duration: 0, segments: [], chapters: [] }, L)).toBe("");
  });
});
