/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Glance } from "./Glance";
import type { GlanceView } from "./glanceModel";

const healthy: GlanceView = {
  wattsLabel: "412 W",
  hollow: false,
  banner: null,
  rings: [
    { name: "3909309465", displayName: "East", closed: true },
    { name: "3913630013", displayName: "West", closed: true },
  ],
  todayLabel: "3.90 kWh",
  lifetimeLabel: "5635.4 kWh",
};

afterEach(() => cleanup());

describe("Glance", () => {
  it("shows Current Power, captions, and Logger names", () => {
    render(<Glance view={healthy} currentPowerAt="2026-09-07T16:03:00.000Z" />);
    expect(screen.getByText("412 W")).toBeTruthy();
    expect(screen.getByText("Today so far")).toBeTruthy();
    expect(screen.getByText("3.90 kWh")).toBeTruthy();
    expect(screen.getByText("Lifetime energy")).toBeTruthy();
    expect(screen.getByText("5635.4 kWh")).toBeTruthy();
    expect(screen.getByText("East")).toBeTruthy();
    expect(screen.getByText("West")).toBeTruthy();
    expect(screen.getByTestId("glance-sun").getAttribute("data-hollow")).toBe("false");
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
            { name: "3909309465", displayName: "East", closed: true },
            { name: "3913630013", displayName: "West", closed: false },
          ],
        }}
        currentPowerAt="2026-09-07T16:03:00.000Z"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "West silent · last Sample 41 minutes ago",
    );
    expect(screen.getByTestId("glance-sun").getAttribute("data-hollow")).toBe("true");
  });
});
