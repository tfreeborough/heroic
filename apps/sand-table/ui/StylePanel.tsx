/** What the selected things (or the next thing drawn) look like. */
import type { Arrowhead, Element, FillStyle, FontFamily, Style } from "../lib/scene";
import type { Brand } from "./api";

type Props = {
  brand: Brand;
  style: Style;
  apply: (patch: Partial<Style>) => void;
  selected: Element[];
  onDelete: () => void;
  onDuplicate: () => void;
  onLayer: (dir: "up" | "down" | "top" | "bottom") => void;
  onRestamp: () => void;
};

const Swatches = ({ value, onPick, palette, allowNone }: { value: string; onPick: (hex: string) => void; palette: Brand["palette"]; allowNone?: boolean }) => (
  <div className="swatches">
    {allowNone && <button className={`swatch none ${value === "transparent" ? "on" : ""}`} title="None" onClick={() => onPick("transparent")} />}
    {palette.map((c) => (
      <button key={c.hex} className={`swatch ${value === c.hex ? "on" : ""}`} title={c.name} style={{ background: c.hex }} onClick={() => onPick(c.hex)} />
    ))}
  </div>
);

const Seg = <T extends string | number>({ value, options, onPick }: { value: T; options: { v: T; label: string; title?: string }[]; onPick: (v: T) => void }) => (
  <div className="seg">
    {options.map((o) => (
      <button key={String(o.v)} className={value === o.v ? "on" : ""} title={o.title} onClick={() => onPick(o.v)}>{o.label}</button>
    ))}
  </div>
);

export const StylePanel = ({ brand, style, apply, selected, onDelete, onDuplicate, onLayer, onRestamp }: Props) => {
  const types = new Set(selected.map((e) => e.type));
  const any = (...t: Element["type"][]) => selected.length === 0 || t.some((x) => types.has(x));
  const showFill = any("rect", "ellipse", "diamond", "glyph");
  const showStroke = any("rect", "ellipse", "diamond", "glyph", "line", "arrow", "pen");
  const showText = any("text");
  const showHeads = any("line", "arrow");
  const showRough = any("rect", "ellipse", "diamond", "glyph", "line", "arrow");
  return (
    <div className="style">
      <div className="field"><label>Stroke</label><Swatches value={style.stroke} palette={brand.palette} onPick={(stroke) => apply({ stroke })} /></div>
      {showFill && <div className="field"><label>Fill</label><Swatches allowNone value={style.fill} palette={brand.palette} onPick={(fill) => apply({ fill, fillStyle: style.fillStyle === "none" ? "hachure" : style.fillStyle })} /></div>}
      {showFill && style.fill !== "transparent" && (
        <div className="field"><label>Fill style</label>
          <Seg<FillStyle> value={style.fillStyle} onPick={(fillStyle) => apply({ fillStyle })} options={[{ v: "hachure", label: "Hatch" }, { v: "cross-hatch", label: "Cross" }, { v: "solid", label: "Solid" }]} />
        </div>
      )}
      {showStroke && <div className="field"><label>Stroke width</label><Seg value={style.strokeWidth} onPick={(strokeWidth) => apply({ strokeWidth })} options={[{ v: 1, label: "Thin" }, { v: 2, label: "Bold" }, { v: 4, label: "Heavy" }]} /></div>}
      {showRough && <div className="field"><label>Sloppiness</label><Seg value={style.roughness} onPick={(roughness) => apply({ roughness })} options={[{ v: 0, label: "Ruler" }, { v: 1, label: "Hand" }, { v: 2, label: "Scrawl" }]} /></div>}
      {showHeads && (
        <div className="field"><label>Arrowheads</label>
          <div className="row">
            <Seg<Arrowhead> value={style.startHead} onPick={(startHead) => apply({ startHead })} options={[{ v: "none", label: "—" }, { v: "arrow", label: "◁" }, { v: "dot", label: "●" }]} />
            <Seg<Arrowhead> value={style.endHead} onPick={(endHead) => apply({ endHead })} options={[{ v: "none", label: "—" }, { v: "arrow", label: "▷" }, { v: "dot", label: "●" }]} />
          </div>
        </div>
      )}
      {showText && <div className="field"><label>Font</label><Seg<FontFamily> value={style.font} onPick={(font) => apply({ font })} options={[{ v: "hand", label: "Hand" }, { v: "cinzel", label: "Title" }, { v: "sans", label: "Plain" }]} /></div>}
      {showText && <div className="field"><label>Size</label><Seg value={style.fontSize} onPick={(fontSize) => apply({ fontSize })} options={[{ v: 20, label: "S" }, { v: 28, label: "M" }, { v: 40, label: "L" }, { v: 64, label: "XL" }]} /></div>}
      <div className="field"><label>Opacity</label><input type="range" min={0.1} max={1} step={0.05} value={style.opacity} onChange={(e) => apply({ opacity: Number(e.target.value) })} /></div>
      {selected.length > 0 && (
        <>
          <div className="field"><label>Layer</label>
            <div className="seg">
              <button title="Send to back" onClick={() => onLayer("bottom")}>⇊</button>
              <button title="Send backward ([)" onClick={() => onLayer("down")}>↓</button>
              <button title="Bring forward (])" onClick={() => onLayer("up")}>↑</button>
              <button title="Bring to front" onClick={() => onLayer("top")}>⇈</button>
            </div>
          </div>
          <div className="field"><label>Actions</label>
            <div className="seg">
              <button title="Duplicate (⌘D)" onClick={onDuplicate}>Duplicate</button>
              <button title="Make this the last thing drawn in the replay" onClick={onRestamp}>Replay last</button>
              <button title="Delete (⌫)" className="danger" onClick={onDelete}>Delete</button>
            </div>
          </div>
        </>
      )}
    </div>
  );
};
