import { useEffect, useMemo, useState } from "react";
import { type GameInfo, gameApi, games } from "./api";
import { Clips } from "./Clips";
import { Make } from "./Make";
import { Queue } from "./Queue";
import { Renders } from "./Renders";
import { Edit } from "./Edit";

/** Hash routes: #<game>/clips · #<game>/clean/<file>[?from=<cut>][&vo=<id>] · #<game>/make[/<file> | /batch:<id>] · #<game>/renders · #<game>/queue
 * `clean` is the editor (footage, voice, captions). `from` = the cut whose
 * edit it starts from; `vo` = which of the clip's voice-overs (default: the
 * one named after the clip). #<game>/voice/<file> is the address the
 * voice screen had before it moved into the editor. */
export type Route = { name: "clips" } | { name: "clean"; file: string; from?: string; vo?: string } | { name: "make"; file?: string; batch?: string } | { name: "renders" } | { name: "queue" };

/** Where a clip is edited: a cut opens on the recording it came from, with its own edit loaded, so the footage it left out is still there to take. */
export const editOf = (clip: { file: string; source?: string }, clips: { file: string }[]): Route =>
  clip.source && clips.some((c) => c.file === clip.source) ? { name: "clean", file: clip.source, from: clip.file } : { name: "clean", file: clip.file };

const parse = (hash: string): { game?: string; route: Route } => {
  const [game, name, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const [rawArg, query] = rest.length ? rest.join("/").split("?") : [undefined, undefined];
  const arg = rawArg ? decodeURIComponent(rawArg) : undefined;
  const from = query ? new URLSearchParams(query).get("from") ?? undefined : undefined;
  const vo = query ? new URLSearchParams(query).get("vo") ?? undefined : undefined;
  let route: Route = { name: "clips" };
  if ((name === "clean" || name === "voice") && arg) route = { name: "clean", file: arg, from, vo };
  else if (name === "make") route = { name: "make", file: arg?.startsWith("batch:") ? undefined : arg, batch: arg?.startsWith("batch:") ? arg.slice(6) : undefined };
  else if (name === "renders") route = { name: "renders" };
  else if (name === "queue") route = { name: "queue" };
  return { game: game || undefined, route };
};
const hashFor = (game: string, r: Route) =>
  `#${game}/` +
  (r.name === "clean"
    ? `clean/${encodeURIComponent(r.file)}${r.from || r.vo ? `?${[r.from ? `from=${encodeURIComponent(r.from)}` : "", r.vo ? `vo=${encodeURIComponent(r.vo)}` : ""].filter(Boolean).join("&")}` : ""}`
    : r.name === "make"
      ? `make${r.batch ? `/batch:${encodeURIComponent(r.batch)}` : r.file ? `/${encodeURIComponent(r.file)}` : ""}`
      : r.name);

let currentGame = "";
export const go = (r: Route) => {
  location.hash = hashFor(currentGame, r);
};

export const App = () => {
  const [list, setList] = useState<GameInfo[] | null>(null);
  const [state, setState] = useState(() => parse(location.hash));
  useEffect(() => {
    void games().then(setList);
    const on = () => setState(parse(location.hash));
    addEventListener("hashchange", on);
    return () => removeEventListener("hashchange", on);
  }, []);

  const game = list?.find((g) => g.id === state.game) ?? list?.[0];
  currentGame = game?.id ?? "";
  // The server serves this game's public dir at the root for the live preview (templates use absolute staticFile paths).
  useEffect(() => {
    if (game) document.cookie = `desk_game=${game.id}; path=/; max-age=31536000`;
    if (game && state.game !== game.id) location.hash = hashFor(game.id, state.route);
  }, [game, state.game, state.route]);
  const api = useMemo(() => (game ? gameApi(game.id) : null), [game]);

  if (!list) return <div className="page muted">loading…</div>;
  if (!game || !api) return <div className="page muted">No games registered — add one to apps/desk/games.ts.</div>;
  const route = state.route;
  const tab = (name: Route["name"], label: string) => (
    <a href={hashFor(game.id, { name } as Route)} className={route.name === name || (name === "clips" && route.name === "clean") ? "on" : ""}>
      {label}
    </a>
  );
  return (
    <>
      <header className="top">
        <div className="brand">
          <img src={game.icon} alt="" />
          The Desk
        </div>
        <nav>
          {tab("clips", "Clips")}
          {tab("make", "Make a video")}
          {tab("renders", "Renders")}
          {tab("queue", "Queue")}
        </nav>
        <div className="right">
          {list.length > 1 ? (
            <select value={game.id} onChange={(e) => (location.hash = hashFor(e.target.value, { name: "clips" }))} style={{ width: "auto" }}>
              {list.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          ) : (
            <span className="small muted">{game.name}</span>
          )}
        </div>
      </header>
      <main className="page" key={game.id}>
        {route.name === "clips" ? <Clips game={game} api={api} /> : null}
        {route.name === "clean" ? <Edit game={game} api={api} file={route.file} from={route.from} vo={route.vo} key={`${route.file}|${route.from ?? ""}|${route.vo ?? ""}`} /> : null}
        {route.name === "make" ? <Make game={game} api={api} file={route.file} batch={route.batch} /> : null}
        {route.name === "renders" ? <Renders game={game} api={api} /> : null}
        {route.name === "queue" ? <Queue game={game} api={api} /> : null}
      </main>
    </>
  );
};
