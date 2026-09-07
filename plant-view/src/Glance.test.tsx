/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Glance } from "./Glance";
import type { GlanceView } from "./glanceModel";

const RING_R = [88, 72];

const healthy: GlanceView = {
  wattsLabel: "412 W",
  hollow: false,
  banner: null,
  rings: [
    { name: "3909309465", displayName: "East", closed: true, wattsLabel: "210 W" },
    { name: "3913630013", displayName: "West", closed: true, wattsLabel: "202 W" },
  ],
  todayLabel: "3.90 kWh",
  lifetimeLabel: "5,635.4 kWh",
  reportingLabel: "East and West reporting",
};

afterEach(() => cleanup());

describe("Glance", () => {
  it("shows Current Power, captions, and Logger names", () => {
    render(<Glance view={healthy} currentPowerAt="2026-09-07T16:03:00.000Z" />);
    const sun = screen.getByTestId("glance-sun");
    expect(sun.querySelector("text")?.textContent).toBe("412 W");
    expect(document.querySelector(".glance-watts")?.textContent).toBe("412 W");
    expect(screen.getByText("Today so far")).toBeTruthy();
    expect(screen.getByText("3.90 kWh")).toBeTruthy();
    expect(screen.getByText("Lifetime energy")).toBeTruthy();
    expect(screen.getByText("5,635.4 kWh")).toBeTruthy();
    expect(screen.getByText("East 210 W")).toBeTruthy();
    expect(screen.getByText("West 202 W")).toBeTruthy();
    expect(screen.getByText("East and West reporting")).toBeTruthy();
    expect(sun.getAttribute("data-hollow")).toBe("false");
    const closed = sun.querySelector("circle.series-a");
    const c = 2 * Math.PI * RING_R[0]!;
    expect(closed?.getAttribute("stroke-dasharray")).toBe(`${c} ${c}`);
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows a stall banner and a hollow sun when asked", () => {
    render(
      <Glance
        view={{
          ...healthy,
          wattsLabel: "210 W",
          hollow: true,
          banner: "West silent · last Sample 41 minutes ago",
          rings: [
            { name: "3909309465", displayName: "East", closed: true, wattsLabel: "210 W" },
            { name: "3913630013", displayName: "West", closed: false, wattsLabel: "0 W" },
          ],
          reportingLabel: "East reporting",
        }}
        currentPowerAt="2026-09-07T16:03:00.000Z"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "West silent · last Sample 41 minutes ago",
    );
    expect(screen.getByText("East reporting")).toBeTruthy();
    expect(screen.getByTestId("glance-sun").getAttribute("data-hollow")).toBe("true");
  });
});
