import { describe, expect, it } from "vitest";
import { curveWattsAt } from "./curveWatts";

describe("curveWattsAt", () => {
  it("interpolates linearly across a short gap", () => {
    expect(
      curveWattsAt(
        [
          { m: 100, w: 100, l: 10 },
          { m: 110, w: 200, l: 10.1 },
        ],
        105,
        15,
      ),
    ).toBe(150);
  });

  it("omits a long gap where Lifetime barely moved", () => {
    expect(
      curveWattsAt(
        [
          { m: 100, w: 100, l: 10 },
          { m: 120, w: 80, l: 10.01 },
        ],
        110,
        15,
      ),
    ).toBeNull();
  });

  it("smooths a long gap where Lifetime still rose", () => {
    const watts = curveWattsAt(
      [
        { m: 100, w: 100, l: 10 },
        { m: 120, w: 200, l: 11 },
      ],
      110,
      15,
    );
    expect(watts).toBeGreaterThan(0);
  });
});
