/** The stamps: diagram glyphs drawn by the same pen, and the game's own art. */
import { useEffect, useMemo, useRef, useState } from "react";
import { GLYPHS } from "../lib/glyphs";
import type { Element } from "../lib/scene";
import type { Stamp } from "../lib/stamps";
import type { PendingStamp } from "./Board";
import type { Brand } from "./api";
import { drawElement } from "./render";

const GlyphThumb = ({ id, aspect, stroke }: { id: string; aspect: number; stroke: string }) => {
  const ref = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const c = ref.current!;
    const ctx = c.getContext("2d")!;
    ctx.setTransform(2, 0, 0, 2, 0, 0);
    ctx.clearRect(0, 0, 56, 56);
    const h = aspect >= 1 ? 40 / aspect : 40, w = h * aspect;
    const el: Element = { id: `thumb-${id}`, type: "glyph", glyph: id, x: 28 - w / 2, y: 28 - h / 2, w, h, stroke, strokeWidth: 1.2, fill: "transparent", fillStyle: "hachure", roughness: 0.8, opacity: 1, font: "hand", fontSize: 20, startHead: "none", endHead: "none", seed: 7, t: 0, dur: 0 };
    drawElement(ctx, el, 1);
  }, [id, aspect, stroke]);
  return <canvas ref={ref} width={112} height={112} style={{ width: 56, height: 56 }} />;
};

export const StampDrawer = ({ brand, stamps, pending, pick, stroke }: { brand: Brand; stamps: Stamp[]; pending?: PendingStamp; pick: (s: PendingStamp) => void; stroke: string }) => {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<string>("glyphs");
  const needle = q.trim().toLowerCase();
  const shown = useMemo(() => stamps.filter((s) => (needle ? s.name.toLowerCase().includes(needle) : s.group === group)), [stamps, needle, group]);
  const glyphs = GLYPHS.filter((g) => !needle || g.label.toLowerCase().includes(needle));
  return (
    <div className="drawer">
      <input type="text" placeholder="Find a stamp…" value={q} onChange={(e) => setQ(e.target.value)} />
      {!needle && (
        <div className="tabs">
          <button className={group === "glyphs" ? "on" : ""} onClick={() => setGroup("glyphs")}>Pictures</button>
          {brand.stampGroups.map((g) => <button key={g.id} className={group === g.id ? "on" : ""} onClick={() => setGroup(g.id)}>{g.label}</button>)}
        </div>
      )}
      <div className="stamps">
        {(needle || group === "glyphs") && glyphs.map((g) => (
          <button key={g.id} className={`stamp ${pending?.kind === "glyph" && pending.id === g.id ? "on" : ""}`} title={g.label} onClick={() => pick({ kind: "glyph", id: g.id })}>
            <GlyphThumb id={g.id} aspect={g.aspect ?? 1} stroke={stroke} />
            <span>{g.label}</span>
          </button>
        ))}
        {(needle || group !== "glyphs") && shown.map((s) => (
          <button key={s.src} className={`stamp ${pending?.kind === "image" && pending.src === s.src ? "on" : ""}`} title={s.name} onClick={() => pick({ kind: "image", src: s.src, w: s.w, h: s.h })}>
            <img src={s.src} alt="" loading="lazy" />
            <span>{s.name}</span>
          </button>
        ))}
      </div>
      <p className="muted small">Pick one, then click on the board to place it. Pictures take the stroke colour.</p>
    </div>
  );
};
