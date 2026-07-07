import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  COLLISION_CELL,
  CREATURE_IDS,
  loadZone,
  type Aabb,
  type CollisionMaterial,
  type CreatureId,
  type Zone,
  type ZoneFile,
  type ZoneObjectKind,
} from "@heroic/core";
import { Viewport } from "./viewport/Viewport";
import { Inspector } from "./Inspector";
import { ForgePanel } from "./forge/ForgePanel";
import type { EditPointer, Selection, Tool } from "./edit/types";
import {
  BREAKABLE_KINDS,
  OBJECT_KINDS,
  breakableDefaults,
  creaturePickerLabel,
  type BreakableKind,
} from "./edit/defaults";
import {
  breakableIdAt,
  deleteBreakable,
  deleteObject,
  addCollisionRect,
  deleteRect,
  duplicateBreakable,
  duplicateObject,
  moveBreakable,
  moveObject,
  objectIdAt,
  placeBreakable,
  placeObject,
  rectIndexAt,
  setCollisionCell,
  setFloor,
} from "./edit/zoneEdits";
import {
  breakableAt,
  breakableFits,
  cellFreeForCollision,
  objectAt,
  objectPlaceable,
  rectFitsCollision,
} from "./edit/validity";
import { validateZone } from "./edit/validate";
import { normalizeZoneFile, resizeZone } from "./edit/resize";
import {
  ensurePermission,
  loadPersistedHandle,
  persistHandle,
  pickZoneFile,
  readZone,
  writeZone,
} from "./fs/fileAccess";

const fsSupported = typeof window !== "undefined" && "showOpenFilePicker" in window;
const TOOLS: Tool[] = ["floor", "collision", "breakable", "object"];
const MAX_HISTORY = 100;

const clone = (z: ZoneFile): ZoneFile => JSON.parse(JSON.stringify(z)) as ZoneFile;

const rectFromPoints = (x0: number, y0: number, x1: number, y1: number): Aabb => ({
  x: (x0 + x1) / 2,
  y: (y0 + y1) / 2,
  w: Math.abs(x1 - x0),
  h: Math.abs(y1 - y0),
});

export const App = () => {
  const zoneRef = useRef<ZoneFile | null>(null);
  const handleRef = useRef<FileSystemFileHandle | null>(null);
  const dragRef = useRef<Selection | null>(null);
  const rectDragRef = useRef<{ x0: number; y0: number } | null>(null);
  // Which left-drag gesture is in progress for breakable/object tools.
  const strokeKindRef = useRef<"move" | "place" | null>(null);
  const lastCellRef = useRef<{ col: number; row: number } | null>(null);
  // World point where the current stroke went down — so we can tell a click (a
  // single placement) from a deliberate drag (stamp one per cell). Without this a
  // click that micro-drags across a tile boundary stamps a second breakable/object.
  const downWorldRef = useRef<{ x: number; y: number } | null>(null);
  // Fixed corner during a breakable resize drag (the one opposite the grabbed handle).
  const resizeAnchorRef = useRef<{ x: number; y: number } | null>(null);
  // Undo/redo: full-zone snapshots, coalesced per stroke (see onPointer).
  const undoRef = useRef<ZoneFile[]>([]);
  const redoRef = useRef<ZoneFile[]>([]);
  const strokePreRef = useRef<ZoneFile | null>(null);
  const strokeChangedRef = useRef(false);

  const [version, setVersion] = useState(0);
  const [histVer, setHistVer] = useState(0); // re-render undo/redo button state
  const [fitToken, setFitToken] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [zoneName, setZoneName] = useState("");
  const [canReopen, setCanReopen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [tool, setTool] = useState<Tool>("floor");
  const [collisionMaterial, setCollisionMaterial] = useState<CollisionMaterial>("wall");
  const [breakableKind, setBreakableKind] = useState<BreakableKind>("barrel");
  const [objectKind, setObjectKind] = useState<ZoneObjectKind>("playerSpawn");
  // Which creature the object tool stamps when placing `creature` markers (so you
  // can lay down several of one type, then switch — like the breakable-kind picker).
  const [creatureId, setCreatureId] = useState<CreatureId>(CREATURE_IDS[0]!);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [showGrid, setShowGrid] = useState(true);
  const [snapMode, setSnapMode] = useState<"half" | "off">("half");
  const [showIssues, setShowIssues] = useState(false);
  const [showForge, setShowForge] = useState(false);
  const [focus, setFocus] = useState<{ x: number; y: number } | null>(null);
  const [pending, setPending] = useState<{ box: Aabb; valid: boolean } | null>(null);

  const bump = useCallback(() => setVersion((v) => v + 1), []);
  const commitEdit = useCallback(() => {
    setDirty(true);
    bump();
  }, [bump]);

  const zone = useMemo<Zone | null>(
    () => (loaded && zoneRef.current ? loadZone(zoneRef.current) : null),
    [version, loaded],
  );
  const issues = useMemo(
    () => (loaded && zoneRef.current ? validateZone(zoneRef.current) : []),
    [version, loaded],
  );

  // Push the current state onto the undo stack (clearing redo) — for discrete edits.
  const pushUndo = useCallback(() => {
    if (!zoneRef.current) return;
    undoRef.current.push(clone(zoneRef.current));
    if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
    redoRef.current = [];
    setHistVer((h) => h + 1);
  }, []);

  /** Resize the zone to `cols × rows` tiles (one undo step; grows with void, crops excess). */
  const applySize = useCallback(
    (next: { cols?: number; rows?: number }) => {
      const z = zoneRef.current;
      if (!z) return;
      const c = next.cols ?? z.size.cols;
      const r = next.rows ?? z.size.rows;
      if (!Number.isFinite(c) || !Number.isFinite(r) || c < 1 || r < 1) return;
      if (z.size.cols === c && z.size.rows === r) return;
      pushUndo();
      resizeZone(z, Math.floor(c), Math.floor(r));
      setSelection(null);
      commitEdit();
    },
    [pushUndo, commitEdit],
  );

  const applyHistory = useCallback(
    (from: ZoneFile[], to: ZoneFile[]) => {
      const z = zoneRef.current;
      const prev = from.pop();
      if (!z || !prev) return;
      to.push(clone(z));
      zoneRef.current = prev;
      setSelection(null); // the selected entity may not exist in the restored state
      setDirty(true);
      setHistVer((h) => h + 1);
      bump();
    },
    [bump],
  );
  const undo = useCallback(() => applyHistory(undoRef.current, redoRef.current), [applyHistory]);
  const redo = useCallback(() => applyHistory(redoRef.current, undoRef.current), [applyHistory]);

  useEffect(() => {
    if (!fsSupported) return;
    loadPersistedHandle()
      .then((h) => {
        if (h) {
          handleRef.current = h;
          setCanReopen(true);
        }
      })
      .catch(() => {});
  }, []);

  const adopt = useCallback(
    async (handle: FileSystemFileHandle) => {
      // Normalize the authored grids to the declared size on open, so a hand-edited
      // (or drifted) `size` loads cleanly and is paintable instead of throwing.
      zoneRef.current = normalizeZoneFile(await readZone(handle));
      handleRef.current = handle;
      undoRef.current = [];
      redoRef.current = [];
      setZoneName(handle.name);
      setLoaded(true);
      setDirty(false);
      setCanReopen(false);
      setSelection(null);
      setFitToken((t) => t + 1);
      setHistVer((h) => h + 1);
      bump();
      persistHandle(handle).catch(() => {});
    },
    [bump],
  );

  const openZone = useCallback(async () => {
    setError(null);
    try {
      const handle = await pickZoneFile();
      if (!handle) return;
      if (!(await ensurePermission(handle, "readwrite"))) return setError("Permission denied.");
      await adopt(handle);
    } catch (e) {
      if ((e as DOMException)?.name !== "AbortError") setError(`Open failed: ${String(e)}`);
    }
  }, [adopt]);

  const reopen = useCallback(async () => {
    const handle = handleRef.current;
    if (!handle) return;
    setError(null);
    try {
      if (!(await ensurePermission(handle, "readwrite"))) return setError("Permission denied.");
      await adopt(handle);
    } catch (e) {
      setError(`Reopen failed: ${String(e)}`);
    }
  }, [adopt]);

  const save = useCallback(async () => {
    const handle = handleRef.current;
    const z = zoneRef.current;
    if (!handle || !z) return;
    setError(null);
    try {
      if (!(await ensurePermission(handle, "readwrite"))) return setError("Permission denied.");
      await writeZone(handle, z);
      setDirty(false);
    } catch (e) {
      setError(`Save failed: ${String(e)}`);
    }
  }, []);

  const onPointer = useCallback(
    (e: EditPointer) => {
      const z = zoneRef.current;
      if (!z || !zone) return;
      const t = z.tileSize;
      // Snap placement to the half-tile grid, or free when snap is off.
      const snap = (w: number): number => (snapMode === "off" ? w : Math.round(w / (t / 2)) * (t / 2));
      const sx = snap(e.wx);
      const sy = snap(e.wy);
      const left = e.button === "left";
      // True once per fresh cell — throttles stamp-placing / sweeping during a drag.
      const movedCell = (): boolean => {
        const lc = lastCellRef.current;
        if (lc && lc.col === e.col && lc.row === e.row) return false;
        lastCellRef.current = { col: e.col, row: e.row };
        return true;
      };
      // True once the pointer has moved a deliberate drag distance from where it went
      // down (half a tile). Gates stamp-on-drag so a single click that micro-drags
      // across a cell boundary places exactly one breakable/object, not two.
      const dragged = (): boolean => {
        const d = downWorldRef.current;
        return d !== null && Math.hypot(e.wx - d.x, e.wy - d.y) > t * 0.5;
      };

      // Begin a stroke: snapshot the pre-edit state once; commit it on up if changed.
      if (e.phase === "down") {
        strokePreRef.current = clone(z);
        strokeChangedRef.current = false;
        downWorldRef.current = { x: e.wx, y: e.wy };
      }

      let changed = false;
      if (tool === "floor") {
        if (e.phase !== "up") changed = setFloor(z, e.col, e.row, left ? 1 : 0);
      } else if (tool === "collision") {
        if (left && snapMode === "off") {
          // Free-rect: drag a box → a free collision rect (with live dashed preview).
          if (e.phase === "down") {
            rectDragRef.current = { x0: e.wx, y0: e.wy };
            setPending({ box: { x: e.wx, y: e.wy, w: 0, h: 0 }, valid: true });
          } else if (e.phase === "drag" && rectDragRef.current) {
            const box = rectFromPoints(rectDragRef.current.x0, rectDragRef.current.y0, e.wx, e.wy);
            setPending({ box, valid: rectFitsCollision(zone, box) });
          } else if (e.phase === "up" && rectDragRef.current) {
            const box = rectFromPoints(rectDragRef.current.x0, rectDragRef.current.y0, e.wx, e.wy);
            rectDragRef.current = null;
            setPending(null);
            if (box.w >= t / 4 && box.h >= t / 4 && rectFitsCollision(zone, box)) {
              addCollisionRect(z, box, collisionMaterial);
              changed = true;
            }
          }
        } else if (left) {
          const code = collisionMaterial === "void" ? COLLISION_CELL.void : COLLISION_CELL.wall;
          if (e.phase !== "up" && cellFreeForCollision(zone, e.col, e.row))
            changed = setCollisionCell(z, e.col, e.row, code);
        } else if (e.phase === "down") {
          const ri = rectIndexAt(z, e.wx, e.wy);
          changed = ri >= 0 ? deleteRect(z, ri) : setCollisionCell(z, e.col, e.row, 0);
        } else if (e.phase === "drag") {
          changed = setCollisionCell(z, e.col, e.row, 0);
        }
      } else if (tool === "breakable") {
        const placeFits = () => breakableFits(zone, breakableDefaults(breakableKind, sx, sy, t).box);
        if (e.handle && selection?.type === "breakable") {
          // Resize: drag a corner; the opposite corner (captured on down) stays put.
          const b = z.breakables.find((x) => x.id === selection.id);
          if (b && e.phase === "down") {
            resizeAnchorRef.current = {
              x: e.handle.includes("e") ? b.box.x - b.box.w / 2 : b.box.x + b.box.w / 2,
              y: e.handle.includes("s") ? b.box.y - b.box.h / 2 : b.box.y + b.box.h / 2,
            };
          } else if (b && e.phase === "drag" && resizeAnchorRef.current) {
            const a = resizeAnchorRef.current;
            const nb = {
              x: (a.x + sx) / 2,
              y: (a.y + sy) / 2,
              w: Math.max(8, Math.abs(sx - a.x)),
              h: Math.max(8, Math.abs(sy - a.y)),
            };
            if (breakableFits(zone, nb, b.id)) {
              b.box.x = nb.x;
              b.box.y = nb.y;
              b.box.w = nb.w;
              b.box.h = nb.h;
              changed = true;
            }
          }
        } else if (left) {
          if (e.phase === "down") {
            const hit = breakableIdAt(z, e.wx, e.wy);
            if (hit) {
              // Grab an existing one → drag to reposition it.
              strokeKindRef.current = "move";
              dragRef.current = { type: "breakable", id: hit };
              setSelection({ type: "breakable", id: hit });
            } else {
              // Empty → place, and keep stamping new ones as you drag.
              strokeKindRef.current = "place";
              lastCellRef.current = { col: e.col, row: e.row };
              if (placeFits()) {
                setSelection({ type: "breakable", id: placeBreakable(z, breakableKind, sx, sy) });
                changed = true;
              }
            }
          } else if (e.phase === "drag") {
            if (strokeKindRef.current === "move" && dragRef.current?.type === "breakable") {
              const id = dragRef.current.id;
              const b = z.breakables.find((x) => x.id === id);
              if (b && breakableFits(zone, { x: sx, y: sy, w: b.box.w, h: b.box.h }, id))
                changed = moveBreakable(z, id, sx, sy);
            } else if (strokeKindRef.current === "place" && dragged() && movedCell() && placeFits()) {
              placeBreakable(z, breakableKind, sx, sy);
              changed = true;
            }
          }
        } else if (e.phase !== "up") {
          // Right held: delete whatever the cursor sweeps over.
          const hit = breakableIdAt(z, e.wx, e.wy);
          if (hit) {
            changed = deleteBreakable(z, hit);
            setSelection((s) => (s?.id === hit ? null : s));
          }
        }
      } else if (tool === "object") {
        const radius = t * 0.5;
        // A `creature` placement carries the toolbar's chosen creature id; other
        // kinds fall back to their own defaults (defaultObjectProps).
        const objInit = objectKind === "creature" ? { creature: creatureId } : undefined;
        // A trigger is an abstract region — it may sit over walls/voids (it just
        // detects the player entering), so it bypasses the solid-avoidance gate
        // that point markers obey.
        const placeableAt = (kind: ZoneObjectKind, x: number, y: number): boolean =>
          kind === "trigger" || objectPlaceable(zone, x, y);
        const selObj =
          selection?.type === "object" ? z.objects.find((o) => o.id === selection.id) : undefined;
        if (e.handle && selObj && selObj.kind === "trigger") {
          // Resize the selected trigger's region: drag a corner; the opposite
          // corner (captured on down) stays put. Mirrors the breakable resize.
          if (e.phase === "down") {
            const w = selObj.w && selObj.w > 0 ? selObj.w : t;
            const h = selObj.h && selObj.h > 0 ? selObj.h : t;
            resizeAnchorRef.current = {
              x: e.handle.includes("e") ? selObj.x - w / 2 : selObj.x + w / 2,
              y: e.handle.includes("s") ? selObj.y - h / 2 : selObj.y + h / 2,
            };
          } else if (e.phase === "drag" && resizeAnchorRef.current) {
            const a = resizeAnchorRef.current;
            selObj.x = (a.x + sx) / 2;
            selObj.y = (a.y + sy) / 2;
            selObj.w = Math.max(8, Math.abs(sx - a.x));
            selObj.h = Math.max(8, Math.abs(sy - a.y));
            changed = true;
          }
        } else if (left) {
          if (e.phase === "down") {
            const hit = objectIdAt(z, e.wx, e.wy, radius);
            if (hit) {
              strokeKindRef.current = "move";
              dragRef.current = { type: "object", id: hit };
              setSelection({ type: "object", id: hit });
            } else {
              strokeKindRef.current = "place";
              lastCellRef.current = { col: e.col, row: e.row };
              if (placeableAt(objectKind, sx, sy)) {
                setSelection({ type: "object", id: placeObject(z, objectKind, sx, sy, objInit) });
                changed = true;
              }
            }
          } else if (e.phase === "drag") {
            if (strokeKindRef.current === "move" && dragRef.current?.type === "object") {
              const moving = z.objects.find((o) => o.id === dragRef.current!.id);
              if (moving && placeableAt(moving.kind, sx, sy))
                changed = moveObject(z, dragRef.current.id, sx, sy);
            } else if (
              strokeKindRef.current === "place" &&
              dragged() &&
              movedCell() &&
              placeableAt(objectKind, sx, sy)
            ) {
              placeObject(z, objectKind, sx, sy, objInit);
              changed = true;
            }
          }
        } else if (e.phase !== "up") {
          const hit = objectIdAt(z, e.wx, e.wy, radius);
          if (hit) {
            changed = deleteObject(z, hit);
            setSelection((s) => (s?.id === hit ? null : s));
          }
        }
      }

      if (changed) {
        strokeChangedRef.current = true;
        setDirty(true);
        bump();
      }

      // End a stroke: if anything changed, commit the pre-edit snapshot as one step.
      if (e.phase === "up") {
        dragRef.current = null;
        strokeKindRef.current = null;
        lastCellRef.current = null;
        resizeAnchorRef.current = null;
        if (strokeChangedRef.current && strokePreRef.current) {
          undoRef.current.push(strokePreRef.current);
          if (undoRef.current.length > MAX_HISTORY) undoRef.current.shift();
          redoRef.current = [];
          setHistVer((h) => h + 1);
        }
        strokePreRef.current = null;
      }
    },
    [tool, collisionMaterial, breakableKind, objectKind, creatureId, snapMode, selection, zone, bump],
  );

  // Clicking a validation issue: select the offending entity + centre the camera.
  const focusIssue = useCallback(
    (sel: Selection | undefined, at: { x: number; y: number } | undefined) => {
      if (sel) setSelection(sel);
      if (at) setFocus({ ...at }); // new object → viewport recenters
    },
    [],
  );

  const validateHover = useCallback(
    (col: number, row: number): boolean => {
      if (!zone) return true;
      if (tool === "floor") return true;
      const t = zone.tileSize;
      const cx = col * t + t / 2;
      const cy = row * t + t / 2;
      // In free-rect mode the cell tint doesn't apply (you drag a box, see its preview).
      if (tool === "collision") return snapMode === "off" ? true : cellFreeForCollision(zone, col, row);
      if (tool === "breakable")
        return (
          breakableAt(zone, cx, cy) ||
          breakableFits(zone, breakableDefaults(breakableKind, cx, cy, t).box)
        );
      return objectAt(zone, cx, cy, t * 0.5) || objectPlaceable(zone, cx, cy);
    },
    [zone, tool, breakableKind, snapMode],
  );

  const deleteSelection = useCallback(() => {
    const z = zoneRef.current;
    const sel = selection;
    if (!z || !sel) return;
    pushUndo();
    const ok = sel.type === "breakable" ? deleteBreakable(z, sel.id) : deleteObject(z, sel.id);
    if (ok) {
      setSelection(null);
      setDirty(true);
      bump();
    } else {
      undoRef.current.pop(); // nothing deleted → discard the snapshot we just pushed
    }
  }, [selection, bump, pushUndo]);

  // Duplicate the selection beside itself (offset clears its own footprint where it
  // can) and select the copy — the prior position seeds where the new one lands.
  const duplicateSelection = useCallback(() => {
    const z = zoneRef.current;
    if (!z || !zone || !selection) return;
    const t = z.tileSize;
    if (selection.type === "breakable") {
      const src = z.breakables.find((b) => b.id === selection.id);
      if (!src) return;
      const ox = Math.max(t, src.box.w);
      const oy = Math.max(t, src.box.h);
      const tries: [number, number][] = [[ox, 0], [ox, oy], [0, oy], [-ox, 0], [0, -oy]];
      const off =
        tries.find((o) => breakableFits(zone, { ...src.box, x: src.box.x + o[0], y: src.box.y + o[1] })) ??
        tries[0]!;
      pushUndo();
      const id = duplicateBreakable(z, selection.id, off[0], off[1]);
      if (!id) {
        undoRef.current.pop();
        return;
      }
      setSelection({ type: "breakable", id });
      setDirty(true);
      bump();
    } else {
      const src = z.objects.find((o) => o.id === selection.id);
      if (!src) return;
      const tries: [number, number][] = [[t, 0], [t, t], [0, t], [-t, 0], [0, -t]];
      const off = tries.find((o) => objectPlaceable(zone, src.x + o[0], src.y + o[1])) ?? tries[0]!;
      pushUndo();
      const id = duplicateObject(z, selection.id, off[0], off[1]);
      if (!id) {
        undoRef.current.pop();
        return;
      }
      setSelection({ type: "object", id });
      setDirty(true);
      bump();
    }
  }, [selection, zone, pushUndo, bump]);

  const pickTool = useCallback((next: Tool) => {
    setTool(next);
    setSelection(null);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      // When typing in an inspector field, let the field own its keys (Backspace,
      // ⌘Z text-undo, etc.) — only Save still applies.
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) {
        if (mod && e.key.toLowerCase() === "s") {
          e.preventDefault();
          void save();
        }
        return;
      }
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        redo();
      } else if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void save();
      } else if (e.key === "Delete" || e.key === "Backspace") {
        deleteSelection();
      } else if (!mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
        duplicateSelection();
      } else if (e.key === "Escape") {
        setSelection(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [save, deleteSelection, duplicateSelection, undo, redo]);

  // Corner handles in the viewport: a selected breakable's box (breakable tool),
  // or a selected region object's rect (a trigger, object tool). Both drag-resize
  // through the same handle machinery in onPointer.
  const resizeBox: Aabb | null = (() => {
    const z = zoneRef.current;
    if (!z) return null;
    if (tool === "breakable" && selection?.type === "breakable") {
      return z.breakables.find((b) => b.id === selection.id)?.box ?? null;
    }
    if (tool === "object" && selection?.type === "object") {
      const o = z.objects.find((o) => o.id === selection.id);
      if (o && o.kind === "trigger") {
        const w = o.w && o.w > 0 ? o.w : z.tileSize;
        const h = o.h && o.h > 0 ? o.h : z.tileSize;
        return { x: o.x, y: o.y, w, h };
      }
    }
    return null;
  })();

  return (
    <div className="app">
      <div className="toolbar">
        <span className="title">Realmsmith</span>
        {loaded ? (
          <>
            <span className="muted">
              {zoneName}
              {dirty ? " — unsaved" : ""}
            </span>
            <span className="spacer" />
            <div className="tools">
              {TOOLS.map((tl) => (
                <button key={tl} className={tool === tl ? "on" : ""} onClick={() => pickTool(tl)}>
                  {tl[0]!.toUpperCase() + tl.slice(1)}
                </button>
              ))}
            </div>
            {tool === "collision" && (
              <select
                value={collisionMaterial}
                onChange={(e) => setCollisionMaterial(e.target.value as CollisionMaterial)}
                title="Collision material: wall (solid, blocks sight) or void (chasm — blocks movement only)"
              >
                <option value="wall">wall</option>
                <option value="void">void</option>
              </select>
            )}
            {tool === "breakable" && (
              <select
                value={breakableKind}
                onChange={(e) => setBreakableKind(e.target.value as BreakableKind)}
              >
                {BREAKABLE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            )}
            {tool === "object" && (
              <select
                value={objectKind}
                onChange={(e) => setObjectKind(e.target.value as ZoneObjectKind)}
              >
                {OBJECT_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
            )}
            {tool === "object" && objectKind === "creature" && (
              <select
                value={creatureId}
                onChange={(e) => setCreatureId(e.target.value as CreatureId)}
                title="Which creature this marker places"
              >
                {CREATURE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {creaturePickerLabel(id)}
                  </option>
                ))}
              </select>
            )}
            <span className="spacer-sm" />
            <button
              className={showGrid ? "on" : ""}
              onClick={() => setShowGrid((g) => !g)}
              title="Toggle grid"
            >
              Grid
            </button>
            <select
              value={snapMode}
              onChange={(e) => setSnapMode(e.target.value as "half" | "off")}
              title="Placement snap"
            >
              <option value="half">Snap: ½ tile</option>
              <option value="off">Snap: off</option>
            </select>
            <label
              className="size-ctl"
              title="Zone size in tiles (cols × rows). Growing adds void to paint into; shrinking crops. Press Enter or blur to apply."
            >
              Size
              <input
                key={`cols-${version}`}
                type="number"
                min={1}
                defaultValue={zoneRef.current?.size.cols ?? 1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => applySize({ cols: Number(e.target.value) })}
              />
              ×
              <input
                key={`rows-${version}`}
                type="number"
                min={1}
                defaultValue={zoneRef.current?.size.rows ?? 1}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                }}
                onBlur={(e) => applySize({ rows: Number(e.target.value) })}
              />
            </label>
            <button
              className={`badge ${issues.length ? "warn" : "ok"}`}
              onClick={() => setShowIssues((v) => !v)}
              title="Validation"
            >
              {issues.length ? `⚠ ${issues.length}` : "✓"}
            </button>
            <span className="spacer-sm" />
            <button onClick={undo} disabled={undoRef.current.length === 0} title="Undo (⌘Z)">
              ↶
            </button>
            <button onClick={redo} disabled={redoRef.current.length === 0} title="Redo (⌘⇧Z)">
              ↷
            </button>
            <button onClick={openZone}>Open…</button>
            <button onClick={save} disabled={!dirty}>
              Save{dirty ? " •" : ""}
            </button>
            <button
              className={showForge ? "on" : ""}
              onClick={() => setShowForge((v) => !v)}
              title="AI asset generation (docs/design/asset-forge.md)"
            >
              Forge
            </button>
          </>
        ) : (
          <>
            <span className="spacer" />
            {canReopen && <button onClick={reopen}>Reopen last</button>}
            <button onClick={openZone} disabled={!fsSupported}>
              Open zone…
            </button>
            {/* The Forge doesn't need a zone — it's usable straight from the empty state. */}
            <button
              className={showForge ? "on" : ""}
              onClick={() => setShowForge((v) => !v)}
              title="AI asset generation (docs/design/asset-forge.md)"
            >
              Forge
            </button>
          </>
        )}
      </div>

      {showIssues && loaded && (
        <div className="issues">
          {issues.length === 0 ? (
            <div className="muted">No issues.</div>
          ) : (
            issues.map((iss, i) => (
              <button
                key={i}
                className={`issue ${iss.level}`}
                onClick={() => focusIssue(iss.select, iss.focus)}
              >
                {iss.message}
              </button>
            ))
          )}
        </div>
      )}

      {loaded && zoneRef.current && zone ? (
        <div className="body">
          <Viewport
            zone={zone}
            fitToken={fitToken}
            selection={selection}
            showGrid={showGrid}
            focus={focus}
            pending={pending}
            resizeBox={resizeBox}
            onPointer={onPointer}
            validateHover={validateHover}
          />
          {/* Always mounted: with a selection it inspects that entity; with
              none it shows the zone's own settings (name, level range). */}
          <Inspector
            zoneFile={zoneRef.current}
            selection={selection}
            beginEdit={pushUndo}
            commit={commitEdit}
            onDuplicate={duplicateSelection}
            onDelete={deleteSelection}
          />
        </div>
      ) : (
        <div className="empty">
          {fsSupported ? (
            <div>
              <p>
                Open <code>apps/enter-the-gauntlet/assets/zones/realm-00.json</code> to begin.
              </p>
              {canReopen && <p className="muted">…or reopen the last file you edited.</p>}
            </div>
          ) : (
            <p>Realmsmith needs the File System Access API — use Chrome, Edge, Arc, or Brave.</p>
          )}
        </div>
      )}

      {showForge && <ForgePanel onClose={() => setShowForge(false)} />}

      {error && <div className="error">{error}</div>}
    </div>
  );
};
