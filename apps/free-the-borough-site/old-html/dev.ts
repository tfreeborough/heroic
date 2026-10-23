// Local preview of the static site with live reload: `bun run site` from the repo root.
// Serves public/ exactly as Render does (folder URLs → index.html) and reloads the
// browser whenever a file under public/ changes. Dev only; Render never runs this.
import { statSync, watch } from "node:fs";
import { join, normalize } from "node:path";

const ROOT = join(import.meta.dir, "public");
const PORT = Number(process.env.PORT ?? 7790);

const RELOAD_SNIPPET = `<script>
new EventSource("/__reload").onmessage = () => location.reload();
</script>`;

const clients = new Set<ReadableStreamDefaultController>();
const encoder = new TextEncoder();

let debounce: Timer | undefined;
watch(ROOT, { recursive: true }, (_event, file) => {
  clearTimeout(debounce);
  debounce = setTimeout(() => {
    console.log(`changed: ${file} → reloading ${clients.size} tab(s)`);
    for (const c of clients) c.enqueue(encoder.encode("data: reload\n\n"));
  }, 80);
});

function resolve(pathname: string): Bun.BunFile | null {
  const path = normalize(join(ROOT, decodeURIComponent(pathname)));
  if (!path.startsWith(ROOT)) return null;
  for (const candidate of [path, join(path, "index.html")]) {
    if (statSync(candidate, { throwIfNoEntry: false })?.isFile()) return Bun.file(candidate);
  }
  return null;
}

Bun.serve({
  port: PORT,
  idleTimeout: 0, // keep the reload stream open
  async fetch(req) {
    const { pathname } = new URL(req.url);

    if (pathname === "/__reload") {
      let self: ReadableStreamDefaultController;
      const stream = new ReadableStream({
        start(c) { self = c; clients.add(c); },
        cancel() { clients.delete(self); },
      });
      return new Response(stream, {
        headers: { "content-type": "text/event-stream", "cache-control": "no-cache" },
      });
    }

    // Folder URLs without a trailing slash redirect, like Render does.
    const file = resolve(pathname);
    if (!file) return new Response("Not found", { status: 404 });
    if (file.name?.endsWith("index.html") && !pathname.endsWith("/") && !pathname.endsWith(".html")) {
      return Response.redirect(pathname + "/", 301);
    }

    if (file.type.startsWith("text/html")) {
      const html = (await file.text()).replace("</body>", `${RELOAD_SNIPPET}\n</body>`);
      return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
    }
    return new Response(file, { headers: { "cache-control": "no-store" } });
  },
});

console.log(`free-the-borough-site → http://localhost:${PORT} (live reload on)`);
