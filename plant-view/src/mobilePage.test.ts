import { describe, expect, it } from "vitest";
import { adjacentMobilePage, mobileHref, mobilePageOf } from "./mobilePage";

describe("mobilePageOf", () => {
  it("treats a missing unit as the glance", () => {
    expect(mobilePageOf("")).toBe("glance");
    expect(mobilePageOf("?day=2026-09-07")).toBe("glance");
  });

  it("treats an unknown unit as the glance", () => {
    expect(mobilePageOf("?unit=week")).toBe("glance");
  });

  it("maps grain units to chart snaps", () => {
    expect(mobilePageOf("?unit=time")).toBe("time");
    expect(mobilePageOf("?day=2026-09-07&unit=day")).toBe("day");
    expect(mobilePageOf("?unit=month")).toBe("month");
    expect(mobilePageOf("?unit=year")).toBe("year");
  });
});

describe("mobileHref", () => {
  it("omits unit on the glance and keeps day", () => {
    expect(mobileHref("2026-09-07", "glance")).toBe("/?day=2026-09-07");
  });

  it("uses grain hrefs for chart snaps", () => {
    expect(mobileHref("2026-09-07", "time")).toBe("/?day=2026-09-07&unit=time");
    expect(mobileHref("2026-09-07", "day")).toBe("/?day=2026-09-07&unit=day");
  });
});

describe("adjacentMobilePage", () => {
  it("steps through glance then Power Day Month Year without wrapping", () => {
    expect(adjacentMobilePage("glance", 1)).toBe("time");
    expect(adjacentMobilePage("time", 1)).toBe("day");
    expect(adjacentMobilePage("year", 1)).toBeNull();
    expect(adjacentMobilePage("glance", -1)).toBeNull();
    expect(adjacentMobilePage("day", -1)).toBe("time");
  });
});
