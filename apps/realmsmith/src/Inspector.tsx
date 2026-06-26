import { useRef } from "react";
import {
  CREATURE_IDS,
  creatureLabel,
  parseSpawnerConfig,
  type BreakEffect,
  type ZoneFile,
  type ZoneObjectKind,
} from "@heroic/core";
import type { Selection } from "./edit/types";
import { BREAKABLE_KINDS, OBJECT_KINDS } from "./edit/defaults";

interface Props {
  zoneFile: ZoneFile;
  selection: Selection;
  /** Snapshot for undo — called once per field-editing session (arm-on-focus). */
  beginEdit: () => void;
  /** Mark dirty + re-derive after a mutation. */
  commit: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
}

type ExplodeEffect = Extract<BreakEffect, { type: "explode" }>;

const toNum = (v: string, fallback: number): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const Inspector = ({
  zoneFile,
  selection,
  beginEdit,
  commit,
  onDuplicate,
  onDelete,
}: Props) => {
  // Arm on focus, snapshot on the first change of that focus session → one undo
  // step per field interaction (not per keystroke).
  const armed = useRef(false);
  const arm = () => {
    armed.current = true;
  };
  const edit = (fn: () => void) => {
    if (armed.current) {
      beginEdit();
      armed.current = false;
    }
    fn();
    commit();
  };

  const header = (title: string) => (
    <div className="inspector-head">
      <h3>{title}</h3>
      <div className="inspector-actions">
        <button onClick={onDuplicate} title="Duplicate (D)">
          Duplicate
        </button>
        <button onClick={onDelete} title="Delete (⌫)">
          Delete
        </button>
      </div>
    </div>
  );

  if (selection.type === "breakable") {
    const b = zoneFile.breakables.find((x) => x.id === selection.id);
    if (!b) return <div className="inspector muted">Nothing selected.</div>;
    const explode = b.onBreak?.find((e): e is ExplodeEffect => e.type === "explode");
    return (
      <div className="inspector">
        {header(b.id)}
        <label>
          Kind
          <select value={b.kind} onFocus={arm} onChange={(e) => edit(() => (b.kind = e.target.value))}>
            {BREAKABLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        <label>
          Max HP
          <input
            type="number"
            min={1}
            value={b.maxHp}
            onFocus={arm}
            onChange={(e) => edit(() => (b.maxHp = Math.max(1, toNum(e.target.value, b.maxHp))))}
          />
        </label>
        <div className="pair">
          <label>
            Width
            <input
              type="number"
              min={4}
              value={b.box.w}
              onFocus={arm}
              onChange={(e) => edit(() => (b.box.w = Math.max(4, toNum(e.target.value, b.box.w))))}
            />
          </label>
          <label>
            Height
            <input
              type="number"
              min={4}
              value={b.box.h}
              onFocus={arm}
              onChange={(e) => edit(() => (b.box.h = Math.max(4, toNum(e.target.value, b.box.h))))}
            />
          </label>
        </div>
        <label className="row">
          <input
            type="checkbox"
            checked={!!b.occludes}
            onFocus={arm}
            onChange={(e) => edit(() => (b.occludes = e.target.checked))}
          />
          Occludes (blocks sight)
        </label>
        <label className="row">
          <input
            type="checkbox"
            checked={!!explode}
            onFocus={arm}
            onChange={(e) =>
              edit(() => {
                b.onBreak = e.target.checked
                  ? [...(b.onBreak ?? []), { type: "explode", radius: 120, damage: 25 }]
                  : (b.onBreak ?? []).filter((x) => x.type !== "explode");
              })
            }
          />
          Explodes
        </label>
        {explode && (
          <>
            <label>
              Blast radius
              <input
                type="number"
                min={0}
                value={explode.radius}
                onFocus={arm}
                onChange={(e) =>
                  edit(() => (explode.radius = Math.max(0, toNum(e.target.value, explode.radius))))
                }
              />
            </label>
            <label>
              Blast damage
              <input
                type="number"
                min={0}
                value={explode.damage}
                onFocus={arm}
                onChange={(e) =>
                  edit(() => (explode.damage = Math.max(0, toNum(e.target.value, explode.damage))))
                }
              />
            </label>
          </>
        )}
        <div className="muted pos">
          at {Math.round(b.box.x)}, {Math.round(b.box.y)}
        </div>
      </div>
    );
  }

  const o = zoneFile.objects.find((x) => x.id === selection.id);
  if (!o) return <div className="inspector muted">Nothing selected.</div>;
  // For a spawner, surface a purpose-built config form (the format also stores it
  // in the generic `props` bag). parseSpawnerConfig fills any unset prop from the
  // defaults, so the inputs always show a concrete value to edit.
  const spawner = o.kind === "spawner" ? parseSpawnerConfig(o.props) : null;
  const setProp = (key: string, value: string | number) => edit(() => (o.props[key] = value));
  const numProp = (key: string, current: number, min: number) => (
    <input
      type="number"
      min={min}
      value={current}
      onFocus={arm}
      onChange={(e) => setProp(key, Math.max(min, toNum(e.target.value, current)))}
    />
  );
  return (
    <div className="inspector">
      {header(o.id)}
      <label>
        Kind
        <select
          value={o.kind}
          onFocus={arm}
          onChange={(e) => edit(() => (o.kind = e.target.value as ZoneObjectKind))}
        >
          {OBJECT_KINDS.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </select>
      </label>
      <div className="pair">
        <label>
          X
          <input
            type="number"
            value={o.x}
            onFocus={arm}
            onChange={(e) => edit(() => (o.x = toNum(e.target.value, o.x)))}
          />
        </label>
        <label>
          Y
          <input
            type="number"
            value={o.y}
            onFocus={arm}
            onChange={(e) => edit(() => (o.y = toNum(e.target.value, o.y)))}
          />
        </label>
      </div>
      {o.kind === "creature" && (
        <label>
          Creature
          <select
            value={String(o.props.creature ?? CREATURE_IDS[0])}
            onFocus={arm}
            onChange={(e) => setProp("creature", e.target.value)}
          >
            {CREATURE_IDS.map((id) => (
              <option key={id} value={id}>
                {creatureLabel(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {spawner && (
        <>
          <label>
            Spawns
            <select
              value={spawner.creature}
              onFocus={arm}
              onChange={(e) => setProp("creature", e.target.value)}
            >
              {CREATURE_IDS.map((id) => (
                <option key={id} value={id}>
                  {creatureLabel(id)}
                </option>
              ))}
            </select>
          </label>
          <label>
            Nest HP
            {numProp("maxHp", spawner.maxHp, 1)}
          </label>
          <label>
            Activation radius
            {numProp("activationRadius", spawner.activationRadius, 0)}
          </label>
          <div className="pair">
            <label>
              Cadence (s)
              {numProp("cadence", spawner.cadence, 0)}
            </label>
            <label>
              Max alive
              {numProp("maxAlive", spawner.maxAlive, 1)}
            </label>
          </div>
        </>
      )}
    </div>
  );
};
