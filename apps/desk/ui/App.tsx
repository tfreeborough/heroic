import { useEffect, useMemo, useState } from "react";
import { type GameInfo, gameApi, games } from "./api";
import { Cleanup } from "./Cleanup";
import { Clips } from "./Clips";
import { Make } from "./Make";
import { Renders } from "./Renders";

/** Hash routes: #<game>/clips · #<game>/clean/<file>[?from=<cut>] · #<game>/make[/<file> | /batch:<id>] · #<game>/renders
 * `from` = the cut whose edit the Cleanup screen should start from (re-cutting). */
export type Route = { name: "clips" } | { name: "clean"; file: string; from?: string } | { name: "make"; file?: string; batch?: string } | { name: "renders" };

const parse = (hash: string): { game?: string; route: Route } => {
  const [game, name, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const [rawArg, query] = rest.length ? rest.join("/").split("?") : [undefined, undefined];
  const arg = rawArg ? decodeURIComponent(rawArg) : undefined;
  const from = query ? new URLSearchParams(query).get("from") ?? undefined : undefined;
  let route: Route = { name: "clips" };
  if (name === "clean" && arg) route = { name: "clean", file: arg, from };
  else if (name === "make") route = { name: "make", file: arg?.startsWith("batch:") ? undefined : arg, batch: arg?.startsWith("batch:") ? arg.slice(6) : undefined };
  else if (name === "renders") route = { name: "renders" };
  return { game: game || undefined, route };
};
const hashFor = (game: string, r: Route) =>
  `#${game}/` +
  (r.name === "clean"
    ? `clean/${encodeURIComponent(r.file)}${r.from ? `?from=${encodeURIComponent(r.from)}` : ""}`
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
        {route.name === "clean" ? <Cleanup game={game} api={api} file={route.file} from={route.from} key={`${route.file}|${route.from ?? ""}`} /> : null}
        {route.name === "make" ? <Make game={game} api={api} file={route.file} batch={route.batch} /> : null}
        {route.name === "renders" ? <Renders game={game} api={api} /> : null}
      </main>
    </>
  );
};
