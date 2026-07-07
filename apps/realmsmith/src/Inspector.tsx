import { useRef } from "react";
import {
  CREATURE_IDS,
  KEY_COLORS,
  parseSpawnerConfig,
  parseTriggerConfig,
  type BreakEffect,
  type KeyColor,
  type ZoneFile,
  type ZoneObjectKind,
} from "@heroic/core";
import type { Selection } from "./edit/types";
import { BREAKABLE_KINDS, OBJECT_KINDS, creaturePickerLabel } from "./edit/defaults";

interface Props {
  zoneFile: ZoneFile;
  /** null = nothing selected → the inspector shows the zone's own settings. */
  selection: Selection | null;
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

  // The zone's own settings — shown when nothing is selected (click empty
  // space to get here). Name and the level range (band–bandMax: the content
  // gate every spawn's roll is clamped to — creature-levels.md). Size lives
  // in the toolbar's resize control; id is the file's identity, read-only.
  const zonePanel = (
    <div className="inspector">
      <div className="inspector-head">
        <h3>Zone</h3>
      </div>
      <label>
        Name
        <input
          value={zoneFile.name}
          onFocus={arm}
          onChange={(e) => edit(() => (zoneFile.name = e.target.value))}
        />
      </label>
      <div className="pair">
        <label>
          Level min
          <input
            type="number"
            min={1}
            value={zoneFile.band}
            onFocus={arm}
            onChange={(e) => edit(() => (zoneFile.band = Math.max(1, toNum(e.target.value, zoneFile.band))))}
          />
        </label>
        <label>
          Level max
          <input
            type="number"
            min={1}
            value={zoneFile.bandMax ?? zoneFile.band}
            onFocus={arm}
            onChange={(e) =>
              edit(
                () =>
                  (zoneFile.bandMax = Math.max(
                    1,
                    toNum(e.target.value, zoneFile.bandMax ?? zoneFile.band),
                  )),
              )
            }
          />
        </label>
      </div>
      <div className="muted pos">
        {zoneFile.id} · {zoneFile.size.cols}×{zoneFile.size.rows} tiles
      </div>
    </div>
  );

  if (!selection) return zonePanel;

  if (selection.type === "breakable") {
    const b = zoneFile.breakables.find((x) => x.id === selection.id);
    if (!b) return zonePanel;
    const explode = b.onBreak?.find((e): e is ExplodeEffect => e.type === "explode");
    return (
      <div className="inspector">
        {header(b.id)}
        <label>
          Kind
          <select
            value={b.kind}
            onFocus={arm}
            onChange={(e) =>
              edit(() => {
                const k = e.target.value;
                b.kind = k;
                // "door" is defined by carrying a lock (the game keys off `lock`, not
                // the kind string): pick one up when becoming a door, drop it otherwise.
                // A door blocks movement but not sight, so default it to non-occluding
                // (see-through, like a gate); the Occludes box can still override.
                if (k === "door") {
                  if (!b.lock) b.lock = { color: KEY_COLORS[0]!.id };
                  b.occludes = false;
                } else {
                  delete b.lock;
                }
              })
            }
          >
            {BREAKABLE_KINDS.map((k) => (
              <option key={k} value={k}>
                {k}
              </option>
            ))}
          </select>
        </label>
        {b.kind === "door" && (
          <label>
            Lock color
            <select
              value={b.lock?.color ?? KEY_COLORS[0]!.id}
              onFocus={arm}
              onChange={(e) => edit(() => (b.lock = { color: e.target.value as KeyColor }))}
            >
              {KEY_COLORS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        )}
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
        {/* Doors are see-through by design (the game ignores `occludes` for a
            locked door), so the toggle would be a no-op — hide it for doors. */}
        {b.kind !== "door" && (
          <label className="row">
            <input
              type="checkbox"
              checked={!!b.occludes}
              onFocus={arm}
              onChange={(e) => edit(() => (b.occludes = e.target.checked))}
            />
            Occludes (blocks sight)
          </label>
        )}
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
  if (!o) return zonePanel;
  // For a spawner, surface a purpose-built config form (the format also stores it
  // in the generic `props` bag). parseSpawnerConfig fills any unset prop from the
  // defaults, so the inputs always show a concrete value to edit.
  const spawner = o.kind === "spawner" ? parseSpawnerConfig(o.props) : null;
  // A trigger surfaces its text/duration/repeat + region size (docs/design/triggers.md).
  // parseTriggerConfig fills any unset prop, so the fields always show a concrete value.
  const trigger = o.kind === "trigger" ? parseTriggerConfig(o.props) : null;
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
  // Optional level-bounds props (docs/design/creature-levels.md): empty = the
  // zone's range applies; a value replaces it for this placement (the game's
  // parseLevelRange reads levelMin/levelMax; the creature's own bounds still
  // clamp the roll, so a wizard never drops below its floor).
  const levelProp = (key: string) => (
    <input
      type="number"
      min={1}
      placeholder="zone"
      value={o.props[key] === undefined ? "" : String(o.props[key])}
      onFocus={arm}
      onChange={(e) =>
        e.target.value === ""
          ? edit(() => delete o.props[key])
          : setProp(key, Math.max(1, toNum(e.target.value, 1)))
      }
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
                {creaturePickerLabel(id)}
              </option>
            ))}
          </select>
        </label>
      )}
      {o.kind === "key" && (
        <label>
          Color
          <select
            value={String(o.props.color ?? KEY_COLORS[0]!.id)}
            onFocus={arm}
            onChange={(e) => setProp("color", e.target.value)}
          >
            {KEY_COLORS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      )}
      {trigger && (
        <>
          <label>
            Text
            <textarea
              rows={3}
              placeholder="Shown on screen when the player enters…"
              value={String(o.props.text ?? "")}
              onFocus={arm}
              onChange={(e) => setProp("text", e.target.value)}
              style={{ resize: "vertical", fontFamily: "inherit" }}
            />
          </label>
          <div className="pair">
            <label>
              Width
              <input
                type="number"
                min={8}
                value={Math.round(o.w ?? 0)}
                onFocus={arm}
                onChange={(e) => edit(() => (o.w = Math.max(8, toNum(e.target.value, o.w ?? 8))))}
              />
            </label>
            <label>
              Height
              <input
                type="number"
                min={8}
                value={Math.round(o.h ?? 0)}
                onFocus={arm}
                onChange={(e) => edit(() => (o.h = Math.max(8, toNum(e.target.value, o.h ?? 8))))}
              />
            </label>
          </div>
          <label>
            Duration (s)
            <input
              type="number"
              min={0}
              step={0.5}
              value={trigger.action.durationMs / 1000}
              onFocus={arm}
              onChange={(e) => setProp("durationMs", Math.max(0, toNum(e.target.value, 3)) * 1000)}
            />
          </label>
          <label className="row">
            <input
              type="checkbox"
              checked={trigger.repeat}
              onFocus={arm}
              onChange={(e) => edit(() => (o.props.repeat = e.target.checked))}
            />
            Repeat (re-fire on re-entry)
          </label>
        </>
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
                  {creaturePickerLabel(id)}
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
          <label>
            Capacity (total spawns)
            {numProp("capacity", spawner.capacity, 0)}
          </label>
        </>
      )}
      {(o.kind === "creature" || o.kind === "spawner") && (
        <div className="pair">
          <label>
            Level min
            {levelProp("levelMin")}
          </label>
          <label>
            Level max
            {levelProp("levelMax")}
          </label>
        </div>
      )}
    </div>
  );
};
