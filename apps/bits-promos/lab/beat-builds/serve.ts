/**
 * `bun lab/beat-builds/serve.ts` → http://localhost:7791 (canvas needs http
 * to read the images' pixels). main.js is bundled on each request so it can
 * import the engine (@heroic/ascii-build): edit either and just refresh.
 */
import { join, normalize } from "node:path";

const root = import.meta.dir;
const port = Number(process.env.PORT ?? 7791);
Bun.serve({
  port,
  async fetch(req) {
    const path = normalize(new URL(req.url).pathname).replace(/^\/+/, "") || "index.html";
    if (path.includes("..")) return new Response("no", { status: 400 });
    if (path === "main.js") {
      const out = await Bun.build({ entrypoints: [join(root, "main.js")], target: "browser", format: "esm" });
      if (!out.success) return new Response(out.logs.map(String).join("\n"), { status: 500 });
      return new Response(await out.outputs[0]!.text(), { headers: { "content-type": "text/javascript" } });
    }
    const file = Bun.file(join(root, path));
    return (await file.exists()) ? new Response(file) : new Response("not found", { status: 404 });
  },
});
console.log(`beat builds → http://localhost:${port}`);
