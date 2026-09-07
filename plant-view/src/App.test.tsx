/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CHART_MODE_KEY } from "./chartMode";
import type { PlantPayload } from "./types";

const chartState = vi.hoisted(() => ({
  throwNext: false,
  instances: [] as { config: { options?: { onClick?: Function } } }[],
}));

vi.mock("chart.js", () => {
  function Chart(_canvas: unknown, config: { options?: { onClick?: Function } }) {
    if (chartState.throwNext) {
      chartState.throwNext = false;
      throw new Error("chart failed");
    }
    const instance = { config, destroy: vi.fn() };
    chartState.instances.push(instance);
    return instance;
  }
  Chart.register = vi.fn();
  return {
    Chart,
    LineController: class LineController {},
    BarController: class BarController {},
    LineElement: class LineElement {},
    BarElement: class BarElement {},
    PointElement: class PointElement {},
    LinearScale: class LinearScale {},
    CategoryScale: class CategoryScale {},
    Filler: class Filler {},
  };
});

import { App } from "./App";

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
      name: "3909309465",
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
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    chartState.instances = [];
    chartState.throwNext = false;
  });

  it("shows the password form when the Operator is not authenticated", async () => {
    stubPlant(401);
    render(<App />);
    expect(await screen.findByLabelText("Password")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log in" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Wattloft" })).toBeTruthy();
    expect(screen.getByText("This Plant")).toBeTruthy();
    expect(screen.getByLabelText("Password").getAttribute("autocomplete")).toBe(
      "current-password",
    );
    expect(screen.queryByText("Today so far")).toBeNull();
    expect(screen.queryByRole("button", { name: "Each" })).toBeNull();
    expect(screen.queryByRole("button", { name: "By Logger" })).toBeNull();
  });

  it("keeps the password and says when it is not accepted", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith("/api/plant")) {
        return new Response(null, { status: 401 });
      }
      expect(url).toBe("/login");
      return new Response(JSON.stringify({ error: "not-accepted" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const field = await screen.findByLabelText("Password");
    fireEvent.change(field, { target: { value: "wrong-password" } });
    fireEvent.submit(field.closest("form")!);
    expect((await screen.findByRole("alert")).textContent).toBe("Password not accepted.");
    expect((screen.getByLabelText("Password") as HTMLInputElement).value).toBe(
      "wrong-password",
    );
    expect(screen.getByLabelText("Password").getAttribute("aria-invalid")).toBe("true");
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
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Overlay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stack" })).toBeNull();
  });

  it("shows a failure sentence when History cannot be reached", async () => {
    stubPlant(502);
    render(<App />);
    expect(
      await screen.findByText("Plant view cannot reach History."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.queryByText("This Plant has no History yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Overlay" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Stack" })).toBeNull();
  });

  it("renders KPIs, Day bars, and grain names from the snapshot", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("0.20 kWh")).toBeTruthy();
    expect(screen.getByText("50 W")).toBeTruthy();
    expect(screen.getByText("5635.4 kWh")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "Energy bars" })).toBeTruthy();
    expect(screen.getByText("2026-08-21 3.90 kWh")).toBeTruthy();
    expect(screen.queryByText("2026-09-01 0.20 kWh")).toBeNull();
    expect(document.querySelector("ol.days")).toBeNull();
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

  it("Time Overlay has a Plant toggle and Time Stack does not", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=time");
    stubPlant(200, { ...snapshot, unit: "time" });
    render(<App />);
    expect(await screen.findByRole("button", { name: "Plant" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(screen.queryByRole("button", { name: "Plant" })).toBeNull();
    expect(screen.getByRole("img", { name: "Power curve" })).toBeTruthy();
  });

  it("shows Overlay pressed by default and remembers Stack in this browser", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    const overlay = await screen.findByRole("button", { name: "Overlay" });
    const stack = screen.getByRole("button", { name: "Stack" });
    expect(overlay.getAttribute("aria-pressed")).toBe("true");
    expect(stack.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(stack);
    expect(stack.getAttribute("aria-pressed")).toBe("true");
    expect(overlay.getAttribute("aria-pressed")).toBe("false");
    expect(window.localStorage.getItem(CHART_MODE_KEY)).toBe("stack");
  });

  it("opens Stack when this browser already stored stack", async () => {
    window.localStorage.setItem(CHART_MODE_KEY, "stack");
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect((await screen.findByRole("button", { name: "Stack" })).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Overlay" }).getAttribute("aria-pressed")).toBe(
      "false",
    );
  });

  it("draws Stack Day segments from loggers and Overlay Day without them", async () => {
    const withLoggers = {
      ...snapshot,
      local_day_bars: [
        {
          local_day: "2026-08-21",
          today_energy_kwh: 3.9,
          loggers: [
            { name: "3909309465", today_energy_kwh: 2.1 },
            { name: "3909310155", today_energy_kwh: 1.8 },
          ],
        },
        {
          local_day: "2026-08-22",
          today_energy_kwh: 0.2,
          loggers: [{ name: "3909309465", today_energy_kwh: 0.2 }],
        },
        { local_day: "2026-09-01", today_energy_kwh: 0.2 },
      ],
    };
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, withLoggers);
    render(<App />);
    await screen.findByText("2026-08-21 3.90 kWh");
    expect(screen.queryByRole("button", { name: "3909309465" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(screen.getByRole("button", { name: "3909310155" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "3909309465" })).toBeTruthy();
    expect(screen.getByRole("img", { name: "Energy bars" })).toBeTruthy();
  });

  it("draws Stack Day as a solid Plant-total bar when loggers are missing", async () => {
    window.localStorage.setItem(CHART_MODE_KEY, "stack");
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("2026-08-21 3.90 kWh")).toBeTruthy();
    expect(screen.getByRole("img", { name: "Energy bars" })).toBeTruthy();
  });

  it("hides a Logger across Stack Day bars when its toggle is off", async () => {
    const withLoggers = {
      ...snapshot,
      local_day_bars: [
        {
          local_day: "2026-08-21",
          today_energy_kwh: 3.9,
          loggers: [
            { name: "3909309465", today_energy_kwh: 2.1 },
            { name: "3909310155", today_energy_kwh: 1.8 },
          ],
        },
        {
          local_day: "2026-08-22",
          today_energy_kwh: 0.2,
          loggers: [{ name: "3909309465", today_energy_kwh: 0.2 }],
        },
        { local_day: "2026-09-01", today_energy_kwh: 0.2 },
      ],
    };
    window.localStorage.setItem(CHART_MODE_KEY, "stack");
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, withLoggers);
    render(<App />);
    expect(await screen.findByText("2026-08-21 3.90 kWh")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "3909310155" }));
    expect(screen.getByText("2026-08-21 2.10 kWh")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Plant" })).toBeNull();
  });

  it("hides a Logger band on Time Stack and keeps Overlay Day free of Logger toggles", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=time");
    stubPlant(200, { ...snapshot, unit: "time" });
    render(<App />);
    await screen.findByRole("button", { name: "Plant" });
    fireEvent.click(screen.getByRole("button", { name: "Stack" }));
    expect(screen.queryByRole("button", { name: "Plant" })).toBeNull();
    expect(screen.getByRole("img", { name: "Power curve" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "3909309465" }));
    expect(screen.getByRole("img", { name: "Power curve" })).toBeTruthy();
    expect(screen.queryByText("3909309465 625 W")).toBeNull();
  });

  it("navigates from a Day column click", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    const push = vi.spyOn(window.history, "pushState");
    render(<App />);
    await screen.findByRole("img", { name: "Energy bars" });
    chartState.instances[0]?.config.options?.onClick?.({}, [{ index: 0 }]);
    expect(push).toHaveBeenCalledWith({}, "", "/?day=2026-08-21&unit=time");
  });

  it("keeps KPIs while the next grain fetch is in flight", async () => {
    let finishDay: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.includes("unit=day")) {
        return new Promise<Response>((resolve) => {
          finishDay = resolve;
        });
      }
      return new Response(JSON.stringify({ ...snapshot, unit: "time" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=time");
    render(<App />);
    expect(await screen.findByText("0.20 kWh")).toBeTruthy();
    fireEvent.click(screen.getByRole("link", { name: "Day" }));
    expect(screen.getByText("Today energy")).toBeTruthy();
    expect(document.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    finishDay?.(
      new Response(JSON.stringify(snapshot), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    expect(await screen.findByRole("img", { name: "Energy bars" })).toBeTruthy();
  });

  it("polls /api/plant every 20 seconds while the tab is visible", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    stubPlant(200, snapshot);
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    render(<App />);
    expect(await screen.findByText("0.20 kWh")).toBeTruthy();
    const fetchMock = vi.mocked(fetch);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(20_000);
    });
    expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("keeps KPIs when Chart.js cannot draw", async () => {
    chartState.throwNext = true;
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("Plant view cannot draw this chart.")).toBeTruthy();
    expect(screen.getByText("Today energy")).toBeTruthy();
    expect(screen.getByText("0.20 kWh")).toBeTruthy();
  });
});
