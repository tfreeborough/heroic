/**
 * Feedback rows (bits-feedback.md): every report lands whole, oversized
 * fields are clipped rather than rejected, and the admin read pages
 * newest-first.
 */
import { beforeEach, describe, expect, test } from "bun:test";
import { createDb, ensureSchema, type Db } from "./db";
import { FEEDBACK_EMAIL_MAX, FEEDBACK_MESSAGE_MAX, listFeedback, recordFeedback } from "./feedback";
import { registerPlayer } from "./players";

let db: Db;
let player: string;

beforeEach(async () => {
  db = createDb(":memory:");
  await ensureSchema(db);
  player = (await registerPlayer(db)).playerId;
});

describe("recordFeedback", () => {
  test("stores the report with its context stamps", async () => {
    const id = await recordFeedback(db, {
      playerId: player,
      kind: "bug",
      message: "  the trident hits through walls  ",
      contactEmail: "me@example.com",
      playerName: "Tom",
      platform: "ios",
      osVersion: "18.5",
      appBinary: "v1.0.0 · production",
      appBundle: "OTA abcd1234",
    });
    const [row] = await listFeedback(db);
    expect(row).toMatchObject({
      id,
      playerId: player,
      kind: "bug",
      message: "the trident hits through walls",
      contactEmail: "me@example.com",
      playerName: "Tom",
      platform: "ios",
      osVersion: "18.5",
      appBinary: "v1.0.0 · production",
      appBundle: "OTA abcd1234",
    });
    expect(row!.createdAt).toBeGreaterThan(0);
  });

  test("blank optional fields store as null", async () => {
    await recordFeedback(db, { playerId: player, kind: "idea", message: "more sand", contactEmail: "   " });
    const [row] = await listFeedback(db);
    expect(row!.contactEmail).toBeNull();
    expect(row!.playerName).toBeNull();
    expect(row!.platform).toBeNull();
  });

  test("clips oversized text instead of refusing it", async () => {
    await recordFeedback(db, {
      playerId: player,
      kind: "other",
      message: "x".repeat(FEEDBACK_MESSAGE_MAX + 500),
      contactEmail: "y".repeat(FEEDBACK_EMAIL_MAX + 5),
    });
    const [row] = await listFeedback(db);
    expect(row!.message.length).toBe(FEEDBACK_MESSAGE_MAX);
    expect(row!.contactEmail!.length).toBe(FEEDBACK_EMAIL_MAX);
  });

  test("refuses an empty message and an unknown kind", async () => {
    await expect(recordFeedback(db, { playerId: player, kind: "bug", message: "   " })).rejects.toThrow();
    await expect(
      recordFeedback(db, { playerId: player, kind: "rant" as "bug", message: "hi" }),
    ).rejects.toThrow();
    expect(await listFeedback(db)).toHaveLength(0);
  });
});

describe("listFeedback", () => {
  test("pages newest-first with `before`", async () => {
    const ids: number[] = [];
    for (let i = 0; i < 5; i++) {
      ids.push(await recordFeedback(db, { playerId: player, kind: "other", message: `report ${i}` }));
    }
    const first = await listFeedback(db, { limit: 2 });
    expect(first.map((r) => r.id)).toEqual([ids[4]!, ids[3]!]);
    const next = await listFeedback(db, { limit: 2, before: first[1]!.id });
    expect(next.map((r) => r.id)).toEqual([ids[2]!, ids[1]!]);
    const last = await listFeedback(db, { before: next[1]!.id });
    expect(last.map((r) => r.id)).toEqual([ids[0]!]);
  });
});
