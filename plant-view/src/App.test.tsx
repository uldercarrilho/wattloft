/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import type { PlantPayload } from "./types";

const snapshot: Extract<PlantPayload, { empty: false }> = {
  empty: false,
  unit: "day",
  selected_day: "2026-08-21",
  today_energy_kwh: 0.2,
  current_power_w: 50,
  lifetime_energy_kwh: 5635.4,
  current_power_at: "2026-08-22T13:00:00+00:00",
  local_day_bars: [
    { local_day: "2026-08-21", today_energy_kwh: 3.9 },
    { local_day: "2026-08-22", today_energy_kwh: 0.2 },
    { local_day: "2026-09-01", today_energy_kwh: 0.2 },
  ],
  curve: [
    {
      name: "1000000001",
      points: [{ at: "2026-08-21T15:00:00", watts: 625, lifetime_kwh: 5635.4 }],
    },
    { name: "Plant", points: [{ at: "2026-08-21T15:00:00", watts: 625 }] },
  ],
};

function stubPlant(status: number, body?: unknown): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      expect(url.startsWith("/api/plant")).toBe(true);
      if (status === 401) {
        return new Response(null, { status: 401 });
      }
      if (status === 502) {
        return new Response(null, { status: 502 });
      }
      return new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

describe("Plant view", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("shows the password form when the Operator is not authenticated", async () => {
    stubPlant(401);
    render(<App />);
    expect(await screen.findByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.queryByText("Today energy")).toBeNull();
  });

  it("shows empty History without KPIs or a chart", async () => {
    stubPlant(200, { empty: true });
    render(<App />);
    expect(
      await screen.findByText("This Plant has no History yet."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.queryByText("Today energy")).toBeNull();
    expect(screen.queryByText("Current Power")).toBeNull();
    expect(document.querySelector("svg")).toBeNull();
  });

  it("shows a failure sentence when History cannot be reached", async () => {
    stubPlant(502);
    render(<App />);
    expect(
      await screen.findByText("Plant view cannot reach History."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.queryByText("This Plant has no History yet.")).toBeNull();
  });

  it("renders KPIs, Day bars, and grain names from the snapshot", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("0.20 kWh")).toBeTruthy();
    expect(screen.getByText("50 W")).toBeTruthy();
    expect(screen.getByText("5635.4 kWh")).toBeTruthy();
    expect(screen.getByText("2026-08-21 3.90 kWh")).toBeTruthy();
    expect(screen.queryByText("2026-09-01 0.20 kWh")).toBeNull();
    expect(screen.getByRole("link", { name: "Time" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Day" }).getAttribute("aria-current")).toBe(
      "true",
    );
    expect(screen.getByRole("link", { name: "Month" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Year" })).toBeTruthy();
  });

  it("says when a Local day has no curve Samples", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-22&unit=time");
    stubPlant(200, {
      ...snapshot,
      unit: "time",
      selected_day: "2026-08-22",
      curve: [],
    });
    render(<App />);
    expect(
      await screen.findByText("This Local day has no curve Samples."),
    ).toBeTruthy();
  });

  it("shows Last sample as a relative age", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-08-22T13:00:30+00:00"));
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=time");
    stubPlant(200, { ...snapshot, unit: "time" });
    render(<App />);
    const last = await screen.findByText("30s ago");
    expect(last.getAttribute("datetime")).toBe("2026-08-22T10:00:00-03:00");
  });
});
