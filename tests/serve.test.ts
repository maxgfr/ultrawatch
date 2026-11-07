import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { pagesIn, serve, servedPath } from "../src/serve.js";

let dir: string;
let server: Server;
let url: string;
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "ultrawatch-serve-"));
  writeFileSync(join(dir, "page.html"), "<!DOCTYPE html><p>hi</p>");
  writeFileSync(join(dir, "clip.webm"), Buffer.from("0123456789"));
  ({ server, url } = await serve(dir, 0));
});
afterAll(() => {
  server.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("serve", () => {
  it("never reaches outside its folder", () => {
    expect(servedPath("/srv/x", "/a/b.html")).toBe("/srv/x/a/b.html");
    expect(servedPath("/srv/x", "/../etc/passwd")).toBeUndefined();
    expect(servedPath("/srv/x", "/%2e%2e/%2e%2e/etc/passwd")).toBeUndefined();
    expect(servedPath("/srv/x", "/a/../../x2/secret")).toBeUndefined();
    expect(servedPath("/srv/x", "/%E0%A4%A")).toBeUndefined();
  });

  it("serves pages on 127.0.0.1, and byte ranges so a video seeks", async () => {
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/$/);
    const page = await fetch(`${url}page.html`);
    expect(page.headers.get("content-type")).toContain("text/html");
    const part = await fetch(`${url}clip.webm`, { headers: { Range: "bytes=2-5" } });
    expect(part.status).toBe(206);
    expect(part.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(await part.text()).toBe("2345");
    expect((await fetch(`${url}missing.html`)).status).toBe(404);
    expect((await fetch(url, { method: "POST" })).status).toBe(405);
  });

  it("lists the pages it serves", () => {
    expect(pagesIn(dir)).toEqual(["page.html"]);
  });
});
