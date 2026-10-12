/**
 * The library, down the editor's left side: the game's recordings, the
 * edit's takes, and the cards (a new text card or b-roll slot, the
 * script's sketches, the cards already in the edit). Click one and it
 * lands at the playhead on the track you last clicked in; drag it onto any
 * track to put it exactly where you want.
 */
import { useMemo, useState } from "react";
import type * as React from "react";
import { type Card, type Sequence, cardLabel, cardOf } from "@heroic/voiceover";
import { type Clip as LibraryClip, type GameApi, fmtDate, fmtSeconds, thumbOf } from "../api";
import { type Focus } from "./Timeline";
import { dragPayload, remember, stem } from "./widgets";

/** A script picture off the shelf: a glyph build with its look seed (an old sketch stays a flat picture). */
const shelfCard = (sk: Sketch): Card => (sk.look !== undefined ? cardOf("build", { src: sk.src, beat: sk.beat, seed: sk.look }) : cardOf("image", { src: sk.src, beat: sk.beat }));

type Tab = "footage" | "takes" | "cards";

/** A picture the script made (stage 3), offered as an image card. */
export type Sketch = { src: string; label: string; beat?: string; look?: number };

export const Library: React.FC<{
  api: GameApi;
  clips: LibraryClip[];
  seq: Sequence;
  focus: Focus;
  t: number;
  locked: boolean;
  onAddFootage: (file: string) => void;
  onAddTake: (take: number) => void;
  /** A new card at the playhead. */
  onAddCard: (card: Card) => void;
  /** Seek to a card already in the edit. */
  onGoCard: (card: Card) => void;
  sketches: Sketch[];
}> = ({ api, clips, seq, focus, t, locked, onAddFootage, onAddTake, onAddCard, onGoCard, sketches }) => {
  const [tab, setTab] = useState<Tab>(() => (remember("library") === "takes" ? "takes" : remember("library") === "cards" ? "cards" : "footage"));
  const [q, setQ] = useState("");
  const pick = (next: Tab) => {
    setTab(next);
    remember("library", next);
  };

  // Recordings only (an edit can't hold another edit), newest first.
  const footage = useMemo(() => clips.filter((c) => !c.path && !c.file.startsWith("seq:")).sort((a, b) => (a.facts.recordedAt < b.facts.recordedAt ? 1 : -1)), [clips]);
  const needle = q.trim().toLowerCase();
  const shown = footage.filter((c) => !needle || `${c.title} ${c.file} ${c.note ?? ""}`.toLowerCase().includes(needle));
  const used = useMemo(() => new Set(seq.video.flatMap((tr) => tr.clips.map((c) => c.src.split("/").pop() ?? ""))), [seq.video]);
  const takeUses = useMemo(() => {
    const n = new Map<number, number>();
    for (const tr of seq.audio) for (const c of tr.clips) n.set(c.take, (n.get(c.take) ?? 0) + 1);
    return n;
  }, [seq.audio]);
  const videoTrack = focus.kind === "video" ? focus.track : 0;
  const audioTrack = focus.kind === "audio" ? focus.track : 0;

  const startDrag = (payload: NonNullable<typeof dragPayload.current>, label: string) => (e: React.DragEvent) => {
    if (locked) return e.preventDefault();
    dragPayload.current = payload;
    e.dataTransfer.effectAllowed = "copy";
    e.dataTransfer.setData("text/plain", label);
  };
  const endDrag = () => {
    dragPayload.current = null;
  };

  return (
    <aside className="lib">
      <div className="lib-tabs">
        <button className={tab === "footage" ? "on" : ""} onClick={() => pick("footage")}>
          Footage <span className="muted">{footage.length}</span>
        </button>
        <button className={tab === "takes" ? "on" : ""} onClick={() => pick("takes")}>
          Takes <span className="muted">{seq.takes.length}</span>
        </button>
        <button className={tab === "cards" ? "on" : ""} onClick={() => pick("cards")}>
          Cards <span className="muted">{seq.overlay?.cards.length ?? 0}</span>
        </button>
      </div>
      {tab === "footage" ? (
        <>
          <input type="text" className="lib-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="search the recordings…" />
          <div className="lib-hint">
            Click: at the playhead ({fmtSeconds(t)}) on V{videoTrack + 1}. Drag onto a track to place it.
          </div>
          <div className="lib-list">
            {shown.length === 0 ? <div className="small muted" style={{ padding: 12 }}>{footage.length ? "Nothing matching that." : "No recordings yet. Sync from Drive or drop files on the Clips tab."}</div> : null}
            {shown.map((c) => (
              <div
                key={c.file}
                className={`lib-row${used.has(c.file) ? " used" : ""}${locked ? " locked" : ""}`}
                draggable={!locked}
                onDragStart={startDrag({ kind: "footage", file: c.file, seconds: c.facts.seconds }, c.file)}
                onDragEnd={endDrag}
                onClick={() => !locked && onAddFootage(c.file)}
                title={`${c.file}\n${fmtSeconds(c.facts.seconds)} · ${fmtDate(c.facts.recordedAt)}${c.note ? `\n${c.note}` : ""}\n\nClick to add it at the playhead on V${videoTrack + 1}; drag it onto a track.`}
              >
                <img src={thumbOf(api, c)} alt="" loading="lazy" className={c.facts.width > c.facts.height ? "wide" : ""} />
                <div className="what">
                  <div className="name">{c.title || stem(c.file)}</div>
                  <div className="small muted">
                    {fmtSeconds(c.facts.seconds)} · {fmtDate(c.facts.recordedAt)}
                    {c.source ? " · cut" : ""}
                    {used.has(c.file) ? " · in this edit" : ""}
                  </div>
                </div>
              </div>
            ))}
          </div>
        </>
      ) : tab === "cards" ? (
        <>
          <div className="lib-hint">
            Text, sketches and b-roll slots, on the cards row above the footage. Click: at the playhead ({fmtSeconds(t)}). Drag onto the cards row to place one.
          </div>
          <div className="lib-cards">
            <div className="row" style={{ gap: 6 }}>
              <button className="small ghost" disabled={locked} draggable={!locked} onDragStart={startDrag({ kind: "card", card: cardOf("text", { text: "A few words" }), seconds: 4 }, "text card")} onDragEnd={endDrag} onClick={() => !locked && onAddCard(cardOf("text", { text: "A few words" }))} title="A few words on the backdrop (or over the footage: set it on the card). Drag it onto the cards row.">
                + Text
              </button>
              <button className="small ghost" disabled={locked} draggable={!locked} onDragStart={startDrag({ kind: "card", card: cardOf("broll", { note: "what to film" }), seconds: 4 }, "b-roll slot")} onDragEnd={endDrag} onClick={() => !locked && onAddCard(cardOf("broll", { note: "what to film" }))} title="A note of footage to film and drop here. Never drawn in the video.">
                + B-roll slot
              </button>
            </div>
          </div>
          <div className="lib-list">
            {sketches.length ? <div className="lib-hint">The script's sketches</div> : null}
            {sketches.map((sk) => (
              <div key={sk.src} className={`lib-row card${locked ? " locked" : ""}`} draggable={!locked} onDragStart={startDrag({ kind: "card", card: shelfCard(sk), seconds: 4 }, sk.label)} onDragEnd={endDrag} onClick={() => !locked && onAddCard(shelfCard(sk))} title={`${sk.label}\n\nClick to add it at the playhead; drag it onto the cards row.`}>
                <img src={api.publicUrl(sk.src)} alt="" loading="lazy" />
                <div className="what">
                  <div className="name">{sk.label}</div>
                </div>
              </div>
            ))}
            {seq.overlay?.cards.length ? <div className="lib-hint">In this edit</div> : null}
            {[...(seq.overlay?.cards ?? [])]
              .sort((a, b) => a.at - b.at)
              .map((c) => (
                <div key={c.id} className="lib-row card" onClick={() => onGoCard(c)} title={`${cardLabel(c)} at ${fmtSeconds(c.at)}. Click to go there.`}>
                  {(c.kind === "image" || c.kind === "build") && c.src ? <img src={api.publicUrl(c.src)} alt="" loading="lazy" /> : <div className="sym">{c.kind === "text" ? "Aa" : "🎬"}</div>}
                  <div className="what">
                    <div className="name">{cardLabel(c)}</div>
                    <div className="small muted">
                      {fmtSeconds(c.at)} · {c.seconds.toFixed(1)}s{c.place === "over" ? " · over" : ""}
                    </div>
                  </div>
                </div>
              ))}
            {!sketches.length && !seq.overlay?.cards.length ? <div className="small muted" style={{ padding: 12 }}>No cards yet. Add a text card above; a script's sketches show here once it has some.</div> : null}
          </div>
        </>
      ) : (
        <>
          <div className="lib-hint">
            Everything recorded into this edit. Click: at the playhead ({fmtSeconds(t)}) on A{audioTrack + 1}. Drag onto an audio track to place it.
          </div>
          <div className="lib-list">
            {seq.takes.length === 0 ? <div className="small muted" style={{ padding: 12 }}>No takes yet. Press Record, or add an audio file on the Voice tab.</div> : null}
            {seq.takes.map((tk, i) => {
              const uses = takeUses.get(i) ?? 0;
              const words = tk.words
                .filter((w) => !w.hidden)
                .map((w) => w.text)
                .join(" ");
              return (
                <div
                  key={tk.file}
                  className={`lib-row take${uses ? " used" : ""}${locked ? " locked" : ""}`}
                  draggable={!locked}
                  onDragStart={startDrag({ kind: "take", take: i, seconds: tk.seconds }, `take ${i + 1}`)}
                  onDragEnd={endDrag}
                  onClick={() => !locked && onAddTake(i)}
                  title={`Take ${i + 1} · ${fmtSeconds(tk.seconds)} · ${tk.recordedAt.slice(0, 16).replace("T", " ")}${words ? `\n“${words}”` : ""}\n\nClick to add the whole take at the playhead on A${audioTrack + 1}; drag it onto an audio track.`}
                >
                  <div className="num">{i + 1}</div>
                  <div className="what">
                    <div className="name">
                      {fmtSeconds(tk.seconds)} <span className="muted small">{uses ? `· used ${uses === 1 ? "once" : `${uses} times`}` : "· not on the timeline"}</span>
                    </div>
                    <div className="small muted words">{words || (tk.transcribed ? "no words heard" : "listening…")}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </aside>
  );
};
