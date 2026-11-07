import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { main } from "../src/cli.js";
import { markdownToHtml, runHtml, stampSeconds } from "../src/html.js";

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

  it("escapes what it does not render", () => {
    expect(markdownToHtml('<script>alert("x")</script>').html).not.toContain("<script>");
  });
});

describe("the page", () => {
  it("holds the player, the chapters, the summary and every segment", () => {
    const r = runHtml(TED, { to: join(dir, "page.html"), summary: readFileSync(join(TED, "answer.good.md"), "utf8") });
    if ("error" in r) throw new Error(r.error);
    expect(r.html).toContain("youtube-nocookie.com/embed/iG9CE55wbtY");
    expect(r.html).toContain("Introduction");
    expect(r.html).toContain('class="summary"');
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

  it("names a directory that holds no run", () => {
    expect(runHtml(dir, { to: join(dir, "x.html") })).toEqual({ error: expect.stringContaining("no video run") });
  });
});
