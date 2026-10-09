import { describe, expect, test } from "bun:test";
import { filledItems, itemTimes, markerWarning, mergeWindows, numberOf, windowLevel } from "./listTiming";

describe("list clip timing", () => {
  const opts = { startFrom: 0, seconds: 40, titleFor: 3 };
  test("counts down by default", () => {
    expect([0, 1, 2].map((i) => numberOf(i, 3))).toEqual([3, 2, 1]);
    expect([0, 1, 2].map((i) => numberOf(i, 3, "up"))).toEqual([1, 2, 3]);
  });
  test("blank rows are ones still being typed", () => {
    expect(filledItems(["a", " ", "", "b "])).toEqual(["a", "b"]);
    expect(filledItems(undefined)).toEqual([]);
  });
  test("each item lands on its marker, on the video's clock", () => {
    expect(itemTimes(3, [12, 4, 25], opts)).toEqual([4, 12, 25]);
    expect(itemTimes(2, [12, 4, 25], { ...opts, startFrom: 2 })).toEqual([2, 10]);
  });
  test("markers outside the video don't count", () => {
    // 1s is before the start, 50s past the end: only 10s (5s into the video) counts; the other item lands halfway to 38.5
    expect(itemTimes(2, [1, 10, 50], { ...opts, startFrom: 5 })).toEqual([5, 21.75]);
  });
  test("items short of a marker share out what's left after the last one", () => {
    // ends at 40 - 1.5 = 38.5; two spare after 10.5 → 19.833, 29.167
    expect(itemTimes(3, [10.5], opts)).toEqual([10.5, 19.833, 29.167]);
  });
  test("no markers: the first just after the title, the rest evenly", () => {
    expect(itemTimes(3, [], opts)).toEqual([3.3, 15.033, 26.767]);
  });
  test("windows that touch, or nearly, become one", () => {
    expect(mergeWindows([[20, 29], [0, 6], [6.5, 16], [40, 40]], 1)).toEqual([[0, 16], [20, 29]]);
    expect(mergeWindows([[0, 5], [5.5, 9]])).toEqual([[0, 5], [5.5, 9]]);
  });
  test("a window fades up and down, and cuts where it's told to", () => {
    const w = mergeWindows([[0, 10], [20, 30]]);
    const fade = { in: 2, out: 4, hardFrom: 0, hardTo: 30 };
    expect(windowLevel(0, w, fade)).toBe(1);
    expect(windowLevel(8, w, fade)).toBe(0.5);
    expect(windowLevel(15, w, fade)).toBe(0);
    expect(windowLevel(21, w, fade)).toBe(0.5);
    expect(windowLevel(30, w, fade)).toBe(1);
  });
  test("the warning says what's off", () => {
    expect(markerWarning(3, 3)).toBeUndefined();
    expect(markerWarning(3, 2)).toContain("the last item lands evenly");
    expect(markerWarning(3, 5)).toContain("2 markers do nothing");
    expect(markerWarning(3, 0)).toContain("press M");
    expect(markerWarning(3, undefined)).toContain("isn't an edit");
    expect(markerWarning(0, 2)).toBeUndefined();
  });
});
