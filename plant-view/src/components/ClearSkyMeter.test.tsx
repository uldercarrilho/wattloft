/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { ClearSkyMeter } from "./ClearSkyMeter";
import type { ClearSkyInstant } from "../glanceModel";

afterEach(() => cleanup());

describe("ClearSkyMeter", () => {
  it("renders with accessible role='meter' and correct values for optimal condition", () => {
    const meter: ClearSkyInstant = {
      efficiencyPct: 89,
      barWidthPct: 89,
      idealWatts: 3840,
      idealLabel: "3.8 kW ideal",
      condition: "optimal",
    };

    render(<ClearSkyMeter meter={meter} />);

    const meterEl = screen.getByRole("meter", { name: "Clear-sky efficiency" });
    expect(meterEl).toBeTruthy();
    expect(meterEl.getAttribute("aria-valuenow")).toBe("89");
    expect(meterEl.getAttribute("aria-valuemin")).toBe("0");
    expect(meterEl.getAttribute("aria-valuemax")).toBe("100");
    expect(meterEl.getAttribute("aria-valuetext")).toBe("89% clear-sky · 3.8 kW ideal");

    expect(screen.getByText("89% clear-sky")).toBeTruthy();
    expect(screen.getByText("3.8 kW ideal")).toBeTruthy();

    const fill = meterEl.querySelector(".clearsky-bar-fill");
    expect(fill?.classList.contains("condition-optimal")).toBe(true);
    expect((fill as HTMLElement)?.style.width).toBe("89%");
  });

  it("applies condition-reduced styling for moderate efficiency", () => {
    const meter: ClearSkyInstant = {
      efficiencyPct: 62,
      barWidthPct: 62,
      idealWatts: 2500,
      idealLabel: "2.5 kW ideal",
      condition: "reduced",
    };

    render(<ClearSkyMeter meter={meter} />);
    const fill = screen.getByRole("meter").querySelector(".clearsky-bar-fill");
    expect(fill?.classList.contains("condition-reduced")).toBe(true);
    expect((fill as HTMLElement)?.style.width).toBe("62%");
  });

  it("caps bar width at 100% when efficiency exceeds 100% (cloud enhancement)", () => {
    const meter: ClearSkyInstant = {
      efficiencyPct: 108,
      barWidthPct: 100,
      idealWatts: 3800,
      idealLabel: "3.8 kW ideal",
      condition: "optimal",
    };

    render(<ClearSkyMeter meter={meter} />);
    expect(screen.getByText("108% clear-sky")).toBeTruthy();
    const fill = screen.getByRole("meter").querySelector(".clearsky-bar-fill");
    expect((fill as HTMLElement)?.style.width).toBe("100%");
  });

  it("applies condition-overcast styling for heavy cloud cover", () => {
    const meter: ClearSkyInstant = {
      efficiencyPct: 25,
      barWidthPct: 25,
      idealWatts: 850,
      idealLabel: "850 W ideal",
      condition: "overcast",
    };

    render(<ClearSkyMeter meter={meter} />);
    expect(screen.getByText("850 W ideal")).toBeTruthy();
    const fill = screen.getByRole("meter").querySelector(".clearsky-bar-fill");
    expect(fill?.classList.contains("condition-overcast")).toBe(true);
  });
});
