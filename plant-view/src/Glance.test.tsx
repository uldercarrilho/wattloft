/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { Glance } from "./Glance";
import type { GlanceView } from "./glanceModel";

const healthy: GlanceView = {
  wattsLabel: "412 W",
  banner: null,
  loggers: [
    {
      name: "1000000001",
      displayName: "East",
      reporting: true,
      wattsLabel: "210 W",
      ageLabel: "1 minute ago",
    },
    {
      name: "1000000002",
      displayName: "West",
      reporting: true,
      wattsLabel: "202 W",
      ageLabel: "1 minute ago",
    },
  ],
  todayLabel: "3.90 kWh",
  lifetimeLabel: "5,635.4 kWh",
};

afterEach(() => cleanup());

describe("Glance", () => {
  it("shows Plant now, captions, and Logger rows", () => {
    render(<Glance view={healthy} currentPowerAt="2026-09-07T16:03:00.000Z" />);
    expect(screen.getByText("Plant now")).toBeTruthy();
    expect(screen.getByText("412 W")).toBeTruthy();
    expect(screen.getByText("Today so far")).toBeTruthy();
    expect(screen.getByText("3.90 kWh")).toBeTruthy();
    expect(screen.getByText("Lifetime energy")).toBeTruthy();
    expect(screen.getByText("5,635.4 kWh")).toBeTruthy();
    expect(screen.getByText("East")).toBeTruthy();
    expect(screen.getByText("210 W")).toBeTruthy();
    expect(screen.getByText("West")).toBeTruthy();
    expect(screen.getByText("202 W")).toBeTruthy();
    expect(screen.getAllByText("reporting · 1 minute ago")).toHaveLength(2);
    expect(screen.getByText("Loggers")).toBeTruthy();
    expect(screen.queryByTestId("glance-sun")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByText(/as of/)).toBeTruthy();
  });

  it("shows a stall banner and last watts on a silent row", () => {
    render(
      <Glance
        view={{
          ...healthy,
          wattsLabel: "210 W",
          banner: "West silent · last Sample 41 minutes ago",
          loggers: [
            {
              name: "1000000001",
              displayName: "East",
              reporting: true,
              wattsLabel: "210 W",
              ageLabel: "1 minute ago",
            },
            {
              name: "1000000002",
              displayName: "West",
              reporting: false,
              wattsLabel: "last 202 W",
              ageLabel: "41 minutes ago",
            },
          ],
        }}
        currentPowerAt="2026-09-07T16:03:00.000Z"
      />,
    );
    expect(screen.getByRole("status").textContent).toBe(
      "West silent · last Sample 41 minutes ago",
    );
    expect(screen.getByText("last 202 W")).toBeTruthy();
    expect(screen.getByText("silent · last Sample 41 minutes ago")).toBeTruthy();
    expect(screen.queryByText("East and West reporting")).toBeNull();
    expect(screen.queryByTestId("glance-sun")).toBeNull();
  });

  it("omits as of when currentPowerAt is absent", () => {
    render(<Glance view={healthy} />);
    expect(screen.queryByText(/as of/)).toBeNull();
  });

  it("omits the Loggers heading when the list is empty", () => {
    render(<Glance view={{ ...healthy, loggers: [] }} />);
    expect(screen.queryByText("Loggers")).toBeNull();
  });
});
