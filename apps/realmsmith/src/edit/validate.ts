import type { ZoneFile } from "@heroic/core";
import type { Selection } from "./types";

/** A non-blocking authoring problem the editor surfaces (warnings, not errors that stop saving). */
export interface Issue {
  level: "error" | "warn";
  message: string;
  /** World point to centre the camera on when the issue is clicked. */
  focus?: { x: number; y: number };
  /** The offending entity to select when the issue is clicked. */
  select?: Selection;
}

const floorAt = (file: ZoneFile, col: number, row: number): number => {
  if (col < 0 || row < 0 || col >= file.size.cols || row >= file.size.rows) return 0;
  return file.layers.floor[row]?.[col] ?? 0;
};

const onFloor = (file: ZoneFile, x: number, y: number): boolean => {
  const t = file.tileSize;
  return floorAt(file, Math.floor(x / t), Math.floor(y / t)) !== 0;
};

/**
 * Authoring checks (run on every edit). Catches the things that look fine on the
 * canvas but break in-game: no spawn, things off the map, or sitting on void.
 */
export const validateZone = (file: ZoneFile): Issue[] => {
  const issues: Issue[] = [];
  const W = file.size.cols * file.tileSize;
  const H = file.size.rows * file.tileSize;

  const spawns = file.objects.filter((o) => o.kind === "playerSpawn");
  if (spawns.length === 0) {
    issues.push({ level: "error", message: "No player spawn placed." });
  } else if (spawns.length > 1) {
    const extra = spawns[1]!;
    issues.push({
      level: "warn",
      message: `${spawns.length} player spawns — only the first is used.`,
      focus: { x: extra.x, y: extra.y },
      select: { type: "object", id: extra.id },
    });
  }

  for (const o of file.objects) {
    const sel: Selection = { type: "object", id: o.id };
    if (o.x < 0 || o.x > W || o.y < 0 || o.y > H) {
      issues.push({ level: "warn", message: `${o.kind} "${o.id}" is out of bounds.`, focus: { x: o.x, y: o.y }, select: sel });
    } else if (!onFloor(file, o.x, o.y)) {
      issues.push({ level: "warn", message: `${o.kind} "${o.id}" is on void (no floor).`, focus: { x: o.x, y: o.y }, select: sel });
    }
  }

  for (const b of file.breakables) {
    const { x, y, w, h } = b.box;
    const sel: Selection = { type: "breakable", id: b.id };
    if (x - w / 2 < 0 || x + w / 2 > W || y - h / 2 < 0 || y + h / 2 > H) {
      issues.push({ level: "warn", message: `breakable "${b.id}" extends out of bounds.`, focus: { x, y }, select: sel });
    } else if (!onFloor(file, x, y)) {
      issues.push({ level: "warn", message: `breakable "${b.id}" is on void (no floor).`, focus: { x, y }, select: sel });
    }
  }

  return issues;
};
