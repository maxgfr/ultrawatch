import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { markdownToHtml, runHtml, stampSeconds, summaryToHtml } from "../src/html.js";

const TED = join(import.meta.dirname, "..", "evals", "cases", "ted");
let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "ultrawatch-html-"));
});
afterEach(() => {
  vi.restoreAllMocks();
  rmSync(dir, { recursive: true, force: true });
});

describe("the summary's Markdown", () => {
  it("reads stamps, past an hour too", () => {
    expect(stampSeconds("02:16")).toBe(136);
    expect(stampSeconds("1:02:03")).toBe(3723);
    expect(stampSeconds("M")).toBeUndefined();
  });

  it("turns each V1 stamp into a seek button, and leaves [M] and other videos as text", () => {
    const { html, toc } = markdownToHtml("# Title\n\n- one [V1 02:16; 03:10]\n- two [V2 01:00] and [M]\n\nA **bold** `<tag>` line.");
    expect(toc).toEqual([{ id: "s1", title: "Title", level: 1 }]);
    expect(html).toContain('data-t="136"');
    expect(html).toContain('data-t="190"');
    expect(html).not.toContain('data-t="60"');
    expect(html).toContain("V2 01:00");
    expect(html).toContain("<strong>bold</strong>");
    expect(html).toContain("<code>&lt;tag&gt;</code>");
  });

  it("drops [M] with its space, and renders the Markdown inside a quote", () => {
    expect(markdownToHtml("Two hours [M], then [V1 01:00; M].").html).toBe(
      '<p>Two hours, then <span class="cite"><button type="button" class="stamp" data-t="60">01:00</button></span>.</p>',
    );
    const { html } = markdownToHtml("> **In short**\n>\n> - one [V1 00:10]\n> - two");
    expect(html).toMatch(/^<blockquote><p><strong>In short<\/strong><\/p>\n<ul><li>one/);
  });

  it("escapes what it does not render", () => {
    expect(markdownToHtml('<script>alert("x")</script>').html).not.toContain("<script>");
  });
});

describe("the summary, section by section", () => {
  const L = { details: "Details", point: "point", points: "points" };
  const md =
    "> **In short**\n> - all [V1 00:10]\n\n## One\n\n> **In short** — the gist [V1 01:00]\n\n- a [V1 01:00]\n- b [V1 02:00]\n\n## Takeaways\n\n- c [V1 03:00]\n";

  it("shows each section's brief and folds its points beneath it", () => {
    const { html, toc } = summaryToHtml(md, L);
    expect(toc.map((t) => t.title)).toEqual(["One", "Takeaways"]);
    expect(html).toContain('<blockquote class="brief"><p><strong>In short</strong> — the gist');
    expect(html).toContain('<details class="points"><summary>Details · 2 points</summary><ul><li>a');
  });

  it("shows a section with no brief whole, unfolded", () => {
    const { html } = summaryToHtml(md, L);
    const takeaways = html.slice(html.indexOf("Takeaways"));
    expect(takeaways).not.toContain("<details");
    expect(takeaways).toContain("<li>c");
  });
});

describe("the page", () => {
  it("holds the player, the chapters, the summary and every segment", () => {
    const r = runHtml(TED, { to: join(dir, "page.html"), summary: readFileSync(join(TED, "answer.good.md"), "utf8") });
    if ("error" in r) throw new Error(r.error);
    expect(r.html).toContain('data-yt="iG9CE55wbtY"');
    expect(r.html).toContain("Introduction");
    expect(r.html).toContain('class="summary"');
    expect(r.html.match(/Do schools kill creativity\? — summary/g)).toBeNull();
    const segments = JSON.parse(readFileSync(join(TED, "segments.json"), "utf8")) as unknown[];
    expect(r.html.match(/class="seg"/g)).toHaveLength(segments.length);
    expect(r.html).not.toMatch(/<(?:script|link)[^>]+src=|<link[^>]+href=/);
  });

  it("is written by `ultrawatch html`, next to the run unless --to says otherwise", async () => {
    vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    const to = join(dir, "ted.html");
    await main(["html", TED, "--to", to]);
    expect(readFileSync(to, "utf8")).toContain("<title>Do schools kill creativity?");
  });

  it("never scrolls on its own unless asked: follow playback is off by default, and a click only seeks", () => {
    const off = runHtml(TED, { to: join(dir, "a.html") });
    const on = runHtml(TED, { to: join(dir, "b.html"), follow: true });
    if ("error" in off || "error" in on) throw new Error("no page");
    expect(off.html).toContain('<input id="follow" type="checkbox">');
    expect(on.html).toContain('<input id="follow" type="checkbox" checked>');
    expect(off.html).toContain("mark(t, false);");
    expect(off.html).toContain("mark(e.detail, follow.checked)");
  });

  it("offers the speeds, YouTube when the video is on it, and frames only on request", () => {
    const r = runHtml(TED, { to: join(dir, "c.html") });
    if ("error" in r) throw new Error(r.error);
    for (const rate of ["1", "1.25", "1.5", "2", "2.5", "3"]) expect(r.html).toContain(`data-rate="${rate}"`);
    expect(r.html).toContain('data-yt="iG9CE55wbtY"');
    expect(r.html).not.toContain('class="shots"');
    // A hidden source must not keep its box: [hidden] has to beat the player's display rules.
    expect(r.html).toContain(".uwp [hidden]{display:none!important}");
  });

  it("names a directory that holds no run", () => {
    expect(runHtml(dir, { to: join(dir, "x.html") })).toEqual({ error: expect.stringContaining("no video run") });
  });
});
