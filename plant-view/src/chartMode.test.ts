import { describe, expect, it } from "vitest";
import {
  CHART_MODE_KEY,
  parseChartMode,
  readChartMode,
  writeChartMode,
} from "./chartMode";

describe("chartMode", () => {
  it("parses only stack as Stack and everything else as Overlay", () => {
    expect(parseChartMode("stack")).toBe("stack");
    expect(parseChartMode(null)).toBe("overlay");
    expect(parseChartMode("nope")).toBe("overlay");
    expect(parseChartMode(undefined)).toBe("overlay");
  });

  it("reads stack from storage and Overlay when getItem throws", () => {
    expect(
      readChartMode({ getItem: (key) => (key === CHART_MODE_KEY ? "stack" : null) }),
    ).toBe("stack");
    expect(
      readChartMode({
        getItem: () => {
          throw new Error("blocked");
        },
      }),
    ).toBe("overlay");
  });

  it("ignores setItem failures", () => {
    expect(() =>
      writeChartMode(
        {
          setItem: () => {
            throw new Error("quota");
          },
        },
        "stack",
      ),
    ).not.toThrow();
  });
});
