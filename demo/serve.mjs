// Zero-dependency static file server for the demo page. Web MIDI + native
// ESM imports need to be served over http(s), not file://, so this exists
// purely to avoid pulling in a bundler/dev-server dependency for one page.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const port = Number(process.env.PORT ?? 4173);

const CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".map": "application/json; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? "/", "http://localhost");
    let path = decodeURIComponent(url.pathname);
    if (path === "/") path = "/demo/index.html";

    const filePath = normalize(join(root, path));
    if (!filePath.startsWith(root)) {
      res.writeHead(403).end("Forbidden");
      return;
    }

    const info = await stat(filePath);
    if (!info.isFile()) {
      res.writeHead(404).end("Not found");
      return;
    }

    const body = await readFile(filePath);
    const contentType = CONTENT_TYPES[extname(filePath)] ?? "application/octet-stream";
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
  } catch (err) {
    if (err && err.code === "ENOENT") {
      res.writeHead(404).end("Not found");
    } else {
      res.writeHead(500).end("Internal error");
    }
  }
});

server.listen(port, () => {
  console.log(`Demo running at http://localhost:${port}/demo/index.html`);
  console.log("Web MIDI requires a secure context -- localhost is fine, no HTTPS needed.");
});
