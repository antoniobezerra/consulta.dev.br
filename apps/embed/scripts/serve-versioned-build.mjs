import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { relative, resolve, sep } from "node:path";

const port = Number.parseInt(process.env.CONSULTA_VERSIONED_EMBED_PORT || "4174", 10);
const mountPath = "/embed/v0.0.0/";
const distributionDirectory = resolve(import.meta.dirname, "..", "dist");

const contentTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".js", "application/javascript; charset=utf-8"],
  [".mjs", "application/javascript; charset=utf-8"],
  [".wasm", "application/wasm"],
]);

function pathInsideDistribution(path) {
  const pathRelative = relative(distributionDirectory, path);
  return Boolean(pathRelative) && pathRelative !== ".." && !pathRelative.startsWith(`..${sep}`);
}

function contentType(path) {
  const extension = path.slice(path.lastIndexOf("."));
  return contentTypes.get(extension) || "application/octet-stream";
}

const server = createServer((request, response) => {
  try {
    const pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    if (!pathname.startsWith(mountPath)) {
      response.writeHead(404).end();
      return;
    }
    const requested = decodeURIComponent(pathname.slice(mountPath.length)) || "index.html";
    const path = resolve(distributionDirectory, requested);
    if (!pathInsideDistribution(path) || !existsSync(path) || !statSync(path).isFile()) {
      response.writeHead(404).end();
      return;
    }
    response.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Content-Type": contentType(path),
      "X-Content-Type-Options": "nosniff",
    });
    createReadStream(path).pipe(response);
  } catch {
    response.writeHead(400).end();
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`Consulta versioned embed test server listening on ${port}`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => server.close(() => process.exit(0)));
}
