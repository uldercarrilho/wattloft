/** @vitest-environment jsdom */
import { describe, expect, it } from "vitest";
import { adjacentMobilePage, mobileHref, mobilePageOf, pagerSwipeIgnored } from "./mobilePage";

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

describe("pagerSwipeIgnored", () => {
  it("ignores swipes that start on the chart, stepper, mode bar, chips, or readout", () => {
    document.body.innerHTML =
      '<div class="plant-chart"><canvas></canvas></div><nav class="stepper"><a>‹</a></nav><nav class="chart-mode"><button>Each</button></nav><div class="series-toggles"><button>East</button></div><div class="readout"><span class="when">15:00</span></div>';
    expect(pagerSwipeIgnored(document.querySelector("canvas"))).toBe(true);
    expect(pagerSwipeIgnored(document.querySelector(".stepper a"))).toBe(true);
    expect(pagerSwipeIgnored(document.querySelector(".chart-mode button"))).toBe(true);
    expect(pagerSwipeIgnored(document.querySelector(".series-toggles button"))).toBe(true);
    expect(pagerSwipeIgnored(document.querySelector(".readout .when"))).toBe(true);
    expect(pagerSwipeIgnored(document.body)).toBe(false);
  });
});
