import * as React from "react";
import { useEffect, useMemo, useState } from "react";
import type { GameTab, GameTabProps } from "../game";
import { GAMES } from "../games";
import { type GameInfo, gameApi, games } from "./api";
import { Clips } from "./Clips";
import { Make } from "./Make";
import { Queue } from "./Queue";
import { Renders } from "./Renders";
import { Editor, OpenEdit } from "./edit/Editor";
import { Scripts } from "./Scripts";

/** Hash routes: #<game>/clips · #<game>/edit/<id> · #<game>/clean/<file>[?from=<cut>][&fresh=1] · #<game>/make[/<file> | /batch:<id>] · #<game>/renders · #<game>/queue · #<game>/scripts[/<id>[/<stage>]] (#<game>/ideas still opens it)
 * `edit` is the sequence editor (tracks of clips, the voice, the music,
 * captions). `clean` opens the edit for a recording, starting one if there
 * isn't one (`fresh`: always a new one); `from` = a cut the old editor
 * made, whose pieces it starts from. #<game>/voice/<file> is an address
 * from before the editor. */
export type Route =
  | { name: "clips" }
  | { name: "edit"; id: string }
  | { name: "clean"; file: string; from?: string; fresh?: boolean }
  | { name: "make"; file?: string; batch?: string }
  | { name: "renders" }
  | { name: "queue" }
  /** `stage`: the script page's stage tab (docs/design/desk-scripts-ux.md). */
  | { name: "scripts"; id?: string; stage?: string }
  /** A game's own tab (desk.config `tabs`): #<game>/x/<tab>[/<arg>]. */
  | { name: "x"; tab: string; arg?: string };

/** Where a clip is edited: a cut opens on the recording it came from, with its own edit loaded, so the footage it left out is still there to take. */
export const editOf = (clip: { file: string; source?: string }, clips: { file: string }[]): Route =>
  clip.source && clips.some((c) => c.file === clip.source) ? { name: "clean", file: clip.source, from: clip.file } : { name: "clean", file: clip.file };

const parse = (hash: string): { game?: string; route: Route } => {
  const [game, name, ...rest] = hash.replace(/^#\/?/, "").split("/");
  const [rawArg, query] = rest.length ? rest.join("/").split("?") : [undefined, undefined];
  const arg = rawArg ? decodeURIComponent(rawArg) : undefined;
  const from = query ? new URLSearchParams(query).get("from") ?? undefined : undefined;
  const fresh = query ? new URLSearchParams(query).get("fresh") === "1" : false;
  let route: Route = { name: "clips" };
  if (name === "edit" && arg) route = { name: "edit", id: arg };
  else if ((name === "clean" || name === "voice") && arg) route = { name: "clean", file: arg, from, fresh };
  else if (name === "make") route = { name: "make", file: arg?.startsWith("batch:") ? undefined : arg, batch: arg?.startsWith("batch:") ? arg.slice(6) : undefined };
  else if (name === "renders") route = { name: "renders" };
  else if (name === "queue") route = { name: "queue" };
  else if (name === "scripts" || name === "ideas") {
    const [sid, stage] = (rawArg ?? "").split("/");
    route = { name: "scripts", id: sid ? decodeURIComponent(sid) : undefined, stage: stage || undefined };
  }
  else if (name === "x" && arg) {
    const [tab, ...more] = arg.split("/");
    route = { name: "x", tab: tab!, arg: more.length ? more.join("/") : undefined };
  }
  return { game: game || undefined, route };
};
const query = (q: Record<string, string | undefined>) => {
  const s = Object.entries(q)
    .filter(([, v]) => v)
    .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`)
    .join("&");
  return s ? `?${s}` : "";
};
const hashFor = (game: string, r: Route) =>
  `#${game}/` +
  (r.name === "edit"
    ? `edit/${encodeURIComponent(r.id)}`
    : r.name === "clean"
    ? `clean/${encodeURIComponent(r.file)}${query({ from: r.from, fresh: r.fresh ? "1" : undefined })}`
    : r.name === "make"
      ? `make${r.batch ? `/batch:${encodeURIComponent(r.batch)}` : r.file ? `/${encodeURIComponent(r.file)}` : ""}`
      : r.name === "scripts"
        ? `scripts${r.id ? `/${encodeURIComponent(r.id)}${r.stage ? `/${r.stage}` : ""}` : ""}`
        : r.name === "x"
          ? `x/${encodeURIComponent(r.tab)}${r.arg ? `/${encodeURIComponent(r.arg)}` : ""}`
          : r.name);

/** A game's own tab, loaded on first open. */
const GameTabView: React.FC<{ tab: GameTab } & GameTabProps> = ({ tab, ...props }) => {
  const [Tab, setTab] = useState<React.FC<GameTabProps> | null>(null);
  useEffect(() => {
    let live = true;
    void tab.load().then((m) => live && setTab(() => m.Tab));
    return () => {
      live = false;
    };
  }, [tab]);
  return Tab ? <Tab {...props} /> : <div className="muted">loading…</div>;
};

let currentGame = "";
/** `replace`: this address takes the place of the current one in the history (a redirect). */
export const go = (r: Route, replace = false) => {
  if (replace) location.replace(hashFor(currentGame, r));
  else location.hash = hashFor(currentGame, r);
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
  const config = GAMES.find((g) => g.id === game.id);
  const hidden = config?.hideTabs ?? [];
  // A tab this game hides (the default is Clips) opens Make instead.
  const route: Route = hidden.includes(state.route.name) || ((state.route.name === "clean" || state.route.name === "edit") && hidden.includes("clips")) ? { name: "make" } : state.route;
  const tab = (name: Route["name"], label: string) =>
    hidden.includes(name) ? null : (
      <a href={hashFor(game.id, { name } as Route)} className={route.name === name || (name === "clips" && (route.name === "clean" || route.name === "edit")) ? "on" : ""}>
        {label}
      </a>
    );
  const ownTab = route.name === "x" ? config?.tabs?.find((t) => t.id === route.tab) : undefined;
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
          {tab("scripts", "Scripts")}
          {config?.tabs?.map((t) => (
            <a key={t.id} href={hashFor(game.id, { name: "x", tab: t.id })} className={route.name === "x" && route.tab === t.id ? "on" : ""}>
              {t.label}
            </a>
          ))}
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
      <main className={route.name === "edit" ? "page edit-page" : "page"} key={game.id}>
        {route.name === "clips" ? <Clips game={game} api={api} /> : null}
        {route.name === "clean" ? <OpenEdit api={api} file={route.file} from={route.from} fresh={route.fresh} key={`${route.file}|${route.from ?? ""}|${route.fresh ? 1 : 0}`} /> : null}
        {route.name === "edit" ? <Editor game={game} api={api} id={route.id} key={route.id} /> : null}
        {route.name === "make" ? <Make game={game} api={api} file={route.file} batch={route.batch} /> : null}
        {route.name === "renders" ? <Renders game={game} api={api} /> : null}
        {route.name === "queue" ? <Queue game={game} api={api} /> : null}
        {route.name === "scripts" ? <Scripts game={game} api={api} id={route.id} stage={route.stage} /> : null}
        {ownTab && route.name === "x" ? <GameTabView tab={ownTab} game={game.id} arg={route.arg} key={ownTab.id} /> : null}
      </main>
    </>
  );
};
