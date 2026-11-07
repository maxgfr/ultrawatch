// `ultrawatch serve [dir]`: the pages over http://127.0.0.1, so the YouTube
// embed plays (it refuses a page opened from disk) and the local video seeks.
// Read-only, this machine only, nothing outside <dir>; byte ranges for video.
import { createReadStream, readdirSync, type Stats, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import { extname, join, relative, resolve, sep } from "node:path";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webm": "video/webm",
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
  ".vtt": "text/vtt; charset=utf-8",
};

/** The file under `root` a request path names, or undefined when it would leave `root`. */
export function servedPath(root: string, urlPath: string): string | undefined {
  let path: string;
  try {
    path = decodeURIComponent(urlPath.split("?")[0]!.split("#")[0]!);
  } catch {
    return undefined;
  }
  if (path.includes("\0")) return undefined;
  const target = resolve(root, `.${path.startsWith("/") ? path : `/${path}`}`);
  const rel = relative(root, target);
  return rel.startsWith("..") || rel.split(sep).includes("..") ? undefined : target;
}

export function serve(dir: string, port = 0): Promise<{ server: Server; url: string }> {
  const root = resolve(dir);
  const server = createServer((req, res) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.writeHead(405, { Allow: "GET, HEAD" }).end();
      return;
    }
    let path = servedPath(root, req.url ?? "/");
    let st: Stats | undefined;
    try {
      if (path) st = statSync(path);
      if (path && st?.isDirectory()) {
        const index = join(path, "index.html");
        st = statSync(index);
        path = index;
      }
    } catch {
      st = undefined;
    }
    if (!path || !st?.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("not found");
      return;
    }
    const type = TYPES[extname(path).toLowerCase()] ?? "application/octet-stream";
    const size = st.size;
    const head = { "Content-Type": type, "Accept-Ranges": "bytes", "Cache-Control": "no-cache" };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
      let end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
      if (!range[1]) end = size - 1;
      if (start > end || start >= size) {
        res.writeHead(416, { "Content-Range": `bytes */${size}` }).end();
        return;
      }
      start = Math.max(0, start);
      end = Math.min(end, size - 1);
      res.writeHead(206, { ...head, "Content-Range": `bytes ${start}-${end}/${size}`, "Content-Length": end - start + 1 });
      if (req.method === "HEAD") res.end();
      else createReadStream(path, { start, end }).pipe(res);
      return;
    }
    res.writeHead(200, { ...head, "Content-Length": size });
    if (req.method === "HEAD") res.end();
    else createReadStream(path).pipe(res);
  });
  return new Promise((done, fail) => {
    server.once("error", fail);
    server.listen(port, "127.0.0.1", () => {
      const addr = server.address();
      const p = typeof addr === "object" && addr ? addr.port : port;
      done({ server, url: `http://127.0.0.1:${p}/` });
    });
  });
}

/** The pages `serve` will list: every .html directly in `dir` and one level down. */
export function pagesIn(dir: string): string[] {
  const root = resolve(dir);
  const out: string[] = [];
  const scan = (d: string, depth: number) => {
    let names: string[];
    try {
      names = readdirSync(d);
    } catch {
      return;
    }
    for (const n of names.sort()) {
      if (n.startsWith(".")) continue;
      const p = join(d, n);
      if (n.endsWith(".html")) out.push(relative(root, p).split(sep).map(encodeURIComponent).join("/"));
      else if (depth < 1) {
        try {
          if (statSync(p).isDirectory()) scan(p, depth + 1);
        } catch {}
      }
    }
  };
  scan(root, 0);
  return out;
}
