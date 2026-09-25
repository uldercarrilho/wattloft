/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, act, waitFor, within } from "@testing-library/react";
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
  Chart.defaults = { locale: "en-US" };
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
      display_name: "East",
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
      if (url.startsWith("/login/passkey")) {
        return new Response(JSON.stringify({ error: "unavailable" }), { status: 404 });
      }
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

function stubMatchMedia(wide: boolean): void {
  vi.stubGlobal(
    "matchMedia",
    (query: string) => ({
      matches: wide && query.includes("min-width: 60rem"),
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
      onchange: null,
    }),
  );
}

describe("Plant view", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    window.localStorage.clear();
    stubMatchMedia(true);
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
    expect(screen.getByText("Watch this Plant.")).toBeTruthy();
    await waitFor(() => expect(document.title).toBe("Log in · Wattloft"));
    expect(document.querySelector(".login-mark")?.getAttribute("aria-hidden")).toBe("true");
    expect(screen.queryByText("Plant now")).toBeNull();
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
      if (url.startsWith("/login/passkey")) {
        return new Response(JSON.stringify({ error: "unavailable" }), { status: 404 });
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

  it("treats an opaque login redirect as granted", async () => {
    let authed = false;
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith("/login/passkey")) {
        return new Response(JSON.stringify({ error: "unavailable" }), { status: 404 });
      }
      if (url === "/login") {
        authed = true;
        const opaque = new Response(null, { status: 204 });
        Object.defineProperty(opaque, "status", { value: 0 });
        Object.defineProperty(opaque, "ok", { value: false });
        Object.defineProperty(opaque, "type", { value: "opaqueredirect" });
        return opaque;
      }
      if (!authed) {
        return new Response(null, { status: 401 });
      }
      return new Response(JSON.stringify({ empty: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const field = await screen.findByLabelText("Password");
    fireEvent.change(field, { target: { value: "correct-horse" } });
    fireEvent.submit(field.closest("form")!);
    expect(await screen.findByText("This Plant has no History yet.")).toBeTruthy();
    expect(screen.queryByText("Password not accepted.")).toBeNull();
  });

  it("shows Use passkey when a credential is configured", async () => {
    vi.stubGlobal("PublicKeyCredential", class PublicKeyCredential {});
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith("/api/plant")) {
        return new Response(null, { status: 401 });
      }
      if (url === "/login/passkey/options") {
        return new Response(
          JSON.stringify({
            challenge: "abc",
            rpId: "localhost",
            timeout: 60_000,
            userVerification: "preferred",
            allowCredentials: [{ type: "public-key", id: "cred" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } },
        );
      }
      throw new Error(url);
    });
    vi.stubGlobal("fetch", fetchMock);
    render(<App />);
    const passkey = await screen.findByRole("button", { name: "Use passkey" });
    const buttons = within(screen.getByRole("main")).getAllByRole("button");
    expect(buttons[0]).toBe(passkey);
    expect(screen.getByRole("button", { name: "Use password" })).toBeTruthy();
  });

  it("shows empty History without KPIs or a chart", async () => {
    stubPlant(200, { empty: true });
    render(<App />);
    expect(
      await screen.findByText("This Plant has no History yet."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.queryByText("Today so far")).toBeNull();
    expect(screen.queryByText("Current Power")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.queryByRole("button", { name: "Each" })).toBeNull();
    expect(screen.queryByRole("button", { name: "By Logger" })).toBeNull();
  });

  it("shows a failure sentence when History cannot be reached", async () => {
    stubPlant(502);
    render(<App />);
    expect(
      await screen.findByText("Plant view cannot reach History."),
    ).toBeTruthy();
    expect(screen.getByRole("button", { name: "Log out" })).toBeTruthy();
    expect(screen.queryByText("This Plant has no History yet.")).toBeNull();
    expect(screen.queryByRole("button", { name: "Each" })).toBeNull();
    expect(screen.queryByRole("button", { name: "By Logger" })).toBeNull();
  });

  it("renders KPIs, Day bars, and grain names from the snapshot", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("0.20 kWh")).toBeTruthy();
    expect(screen.getByText("50 W")).toBeTruthy();
    expect(screen.getByText("5,635.4 kWh")).toBeTruthy();
    expect(await screen.findByRole("img", { name: "Energy bars" })).toBeTruthy();
    expect(screen.getAllByText("21 Aug 3.90 kWh").length).toBeGreaterThan(0);
    expect(screen.queryByText("2026-09-01 0.20 kWh")).toBeNull();
    expect(document.querySelector("ol.days")).toBeNull();
    expect(screen.getByRole("link", { name: "Power curve for this Local day" })).toBeTruthy();
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
    fireEvent.click(screen.getByRole("button", { name: "By Logger" }));
    expect(screen.queryByRole("button", { name: "Plant" })).toBeNull();
    expect(screen.getByRole("img", { name: "Power curve" })).toBeTruthy();
  });

  it("keeps the Time readout at the clicked minute", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=time");
    stubPlant(200, { ...snapshot, unit: "time" });
    render(<App />);
    await waitFor(() => expect(chartState.instances.length).toBeGreaterThan(0));
    const canvas = screen.getByRole("img", { name: "Power curve" });
    expect(document.querySelector(".when")?.textContent).toBe("15:00");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      x: 0,
      y: 0,
      top: 0,
      left: 0,
      bottom: 40,
      right: 120,
      width: 120,
      height: 40,
      toJSON: () => ({}),
    });
    fireEvent.pointerDown(canvas, { clientX: 0, clientY: 10, pointerId: 1, buttons: 1 });
    await waitFor(() => {
      expect(document.querySelector(".when")?.textContent).toBe("14:00 gap");
    });
  });

  it("shows Overlay pressed by default and remembers Stack in this browser", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    const overlay = await screen.findByRole("button", { name: "Each" });
    const stack = screen.getByRole("button", { name: "By Logger" });
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
    expect((await screen.findByRole("button", { name: "By Logger" })).getAttribute("aria-pressed")).toBe(
      "true",
    );
    expect(screen.getByRole("button", { name: "Each" }).getAttribute("aria-pressed")).toBe(
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
    await screen.findAllByText("21 Aug 3.90 kWh");
    expect(screen.queryByRole("button", { name: "3909309465" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "By Logger" }));
    expect(screen.getByRole("button", { name: "3909310155" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "East" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "East" }).getAttribute("data-series")).toBe(
      "3909309465",
    );
    expect(screen.getByRole("button", { name: "East" }).getAttribute("title")).toBe(
      "3909309465",
    );
    expect(screen.getByRole("img", { name: "Energy bars" })).toBeTruthy();
  });

  it("draws Stack Day as a solid Plant-total bar when loggers are missing", async () => {
    window.localStorage.setItem(CHART_MODE_KEY, "stack");
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect((await screen.findAllByText("21 Aug 3.90 kWh")).length).toBeGreaterThan(0);
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
    expect((await screen.findAllByText("21 Aug 3.90 kWh")).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "3909310155" }));
    expect(screen.getAllByText("21 Aug 2.10 kWh").length).toBeGreaterThan(0);
    expect(screen.queryByRole("button", { name: "Plant" })).toBeNull();
  });

  it("hides a Logger band on Time Stack and keeps Overlay Day free of Logger toggles", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=time");
    stubPlant(200, { ...snapshot, unit: "time" });
    render(<App />);
    await screen.findByRole("button", { name: "Plant" });
    fireEvent.click(screen.getByRole("button", { name: "By Logger" }));
    expect(screen.queryByRole("button", { name: "Plant" })).toBeNull();
    expect(screen.getByRole("img", { name: "Power curve" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "East" }));
    expect(screen.getByRole("img", { name: "Power curve" })).toBeTruthy();
    expect(screen.queryByText("East 625 W")).toBeNull();
  });

  it("navigates from a Day column click", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    const push = vi.spyOn(window.history, "pushState");
    render(<App />);
    await screen.findByRole("img", { name: "Energy bars" });
    await waitFor(() => expect(chartState.instances.length).toBeGreaterThan(0));
    const onClick = chartState.instances.at(-1)?.config.options?.onClick;
    expect(onClick).toBeTypeOf("function");
    act(() => {
      onClick?.({}, [{ index: 0 }]);
    });
    expect(push).toHaveBeenCalledWith({}, "", "/?day=2026-08-21&unit=time");
  });

  it("keeps KPIs while the next grain fetch is in flight", async () => {
    let finishDay: ((value: Response) => void) | undefined;
    const fetchMock = vi.fn(async (input: RequestInfo) => {
      const url = String(input);
      if (url.startsWith("/login/passkey")) {
        return new Response(JSON.stringify({ error: "unavailable" }), { status: 404 });
      }
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
    expect(screen.getByText("Today so far")).toBeTruthy();
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
    expect(screen.getByText("Today so far")).toBeTruthy();
    expect(screen.getByText("0.20 kWh")).toBeTruthy();
  });

  it("keeps Today so far as Plant-now and names the selected day's energy", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, { ...snapshot, history_start: "2026-08-21" });
    render(<App />);
    expect(await screen.findByText("Today so far")).toBeTruthy();
    expect(screen.getAllByText("0.20 kWh").length).toBeGreaterThan(0);
    expect(screen.getAllByText("21 Aug 3.90 kWh").length).toBeGreaterThan(0);
    expect(screen.getByText("In progress")).toBeTruthy();
  });

  it("captions Month History since the first Sample", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=month");
    stubPlant(200, { ...snapshot, unit: "month", history_start: "2026-08-21" });
    render(<App />);
    expect(
      await screen.findByText("Wattloft History · from 21 Aug"),
    ).toBeTruthy();
    expect(document.querySelector(".grain-title")?.textContent).toBe(
      "Wattloft History · from 21 Aug",
    );
    expect(screen.getByText("This month is incomplete in Wattloft")).toBeTruthy();
    expect(screen.getByText("Tap a month to open the Day chart")).toBeTruthy();
  });

  it("omits Year chevrons when History is one span", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=year");
    stubPlant(200, { ...snapshot, unit: "year" });
    render(<App />);
    expect(await screen.findByText("This year is incomplete in Wattloft")).toBeTruthy();
    expect(document.querySelector(".grain-title")?.textContent).toBe(
      "Wattloft History · from 21 Aug",
    );
    expect(screen.getByText("Lifetime 5,635.4 kWh · before Wattloft")).toBeTruthy();
    expect(document.querySelector(".stepper span")?.textContent).toBe("2026");
    expect(screen.getByText("Tap a year to open the Month chart")).toBeTruthy();
    expect(screen.queryByRole("link", { name: "Previous" })).toBeNull();
    expect(screen.queryByRole("link", { name: "Next" })).toBeNull();
  });

  it("exposes a skip link to the chart and keeps Log out off the heading", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    const skip = await screen.findByRole("link", { name: "Skip to chart" });
    expect(skip.getAttribute("href")).toBe("#plant-chart");
    expect(screen.getByRole("heading", { level: 1 }).textContent).toBe("Plant");
  });

  it("keeps Why gaps closed on Power", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=time");
    stubPlant(200, { ...snapshot, unit: "time" });
    render(<App />);
    const disclosure = await screen.findByText("Why gaps?");
    expect(disclosure.closest("details")?.open).toBe(false);
    const body = disclosure.closest("details")?.querySelector("p")?.textContent ?? "";
    expect(body).not.toContain("Tap a name");
    expect(body).toContain("interpolated");
    expect(screen.getByRole("button", { name: "East" }).getAttribute("data-series")).toBe(
      "3909309465",
    );
  });

  it("shows the Plant now glance on a narrow viewport with no unit and 4-tab dock", async () => {
    stubMatchMedia(false);
    window.history.replaceState({}, "", "/?day=2026-08-21");
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("Plant now")).toBeTruthy();
    expect(screen.getByRole("tablist", { name: "Mobile views" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Glance/i }).getAttribute("aria-selected")).toBe(
      "true",
    );
    expect(screen.getByRole("tab", { name: /Power/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /History/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Insights/i })).toBeTruthy();
    expect(screen.queryByRole("navigation", { name: "Grain" })).toBeNull();
    expect(screen.getByText("50 W")).toBeTruthy();
  });

  it("opens the Day snap in History tab on a narrow viewport with day grain", async () => {
    stubMatchMedia(false);
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByRole("link", { name: "Day" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Day" }).getAttribute("aria-current")).toBe("true");
    expect(screen.queryByRole("heading", { name: "Day" })).toBeNull();
    expect(screen.queryByText("Plant now")).toBeNull();
    expect(screen.queryByRole("navigation", { name: "Grain" })).toBeNull();
    expect(screen.getByRole("button", { name: "Each" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /History/i }).getAttribute("aria-selected")).toBe("true");
  });

  it("keeps day when moving from the glance to Power tab", async () => {
    stubMatchMedia(false);
    window.history.replaceState({}, "", "/?day=2026-08-21");
    stubPlant(200, snapshot);
    render(<App />);
    await screen.findByText("Plant now");
    const push = vi.spyOn(window.history, "pushState");
    fireEvent.click(screen.getByRole("tab", { name: /Power/i }));
    const pushed = String(push.mock.calls[0]?.[2]);
    expect(pushed).toContain("day=2026-08-21");
    expect(pushed).toContain("unit=time");
  });

  it("renders the Azulejo Moderno theme toggle and switches theme", async () => {
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("Today so far")).toBeTruthy();
    const toggleBtn = screen.getByRole("button", { name: /Switch to (dark|light) mode/i });
    expect(toggleBtn).toBeTruthy();

    fireEvent.click(toggleBtn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("dark");

    fireEvent.click(toggleBtn);
    expect(document.documentElement.getAttribute("data-theme")).toBe("light");
  });

  it("renders 4-metric KPI grid and diagnostics panel on desktop", async () => {
    stubPlant(200, snapshot);
    render(<App />);
    expect(await screen.findByText("Today so far")).toBeTruthy();
    expect(screen.getByText("Current Power")).toBeTruthy();
    expect(screen.getByText("Lifetime energy")).toBeTruthy();
    expect(screen.getByText("Solar Envelope")).toBeTruthy();
    expect(
      screen.getByText("Production Intelligence & Solar Diagnostics (ADR 0032)"),
    ).toBeTruthy();
  });

  it("keeps desktop Grain nav and no glance on a wide viewport", async () => {
    window.history.replaceState({}, "", "/?day=2026-08-21&unit=day");
    stubPlant(200, {
      ...snapshot,
      loggers_now: [
        {
          name: "3909309465",
          display_name: "East",
          last_success_at: "2026-08-22T13:00:00+00:00",
          power_w: 50,
        },
      ],
    });
    render(<App />);
    expect(await screen.findByRole("navigation", { name: "Grain" })).toBeTruthy();
    expect(screen.queryByText("Plant now")).toBeNull();
    expect(screen.getByText("Today so far")).toBeTruthy();
    expect(screen.getByText("50 W")).toBeTruthy();
  });

  it("does not show Glance on login, empty History, or 502", async () => {
    stubMatchMedia(false);
    stubPlant(401);
    const { unmount } = render(<App />);
    expect(await screen.findByLabelText("Password")).toBeTruthy();
    expect(screen.queryByText("Plant now")).toBeNull();
    unmount();
    stubPlant(200, { empty: true });
    render(<App />);
    expect(await screen.findByText("This Plant has no History yet.")).toBeTruthy();
    expect(screen.queryByText("Plant now")).toBeNull();
    cleanup();
    stubPlant(502);
    render(<App />);
    expect(await screen.findByText("Plant view cannot reach History.")).toBeTruthy();
    expect(screen.queryByText("Plant now")).toBeNull();
  });

  it("streams live telemetry samples and updates Current Power without polling", async () => {
    class MockEventSource {
      static instances: MockEventSource[] = [];
      url: string;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      listeners: Record<string, ((event: MessageEvent) => void)[]> = {};

      constructor(url: string) {
        this.url = url;
        MockEventSource.instances.push(this);
        setTimeout(() => this.onopen?.(), 0);
      }

      addEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (!this.listeners[type]) this.listeners[type] = [];
        this.listeners[type].push(listener);
      }

      removeEventListener(type: string, listener: (event: MessageEvent) => void) {
        if (!this.listeners[type]) return;
        this.listeners[type] = this.listeners[type].filter((l) => l !== listener);
      }

      emit(type: string, data: unknown) {
        const event = new MessageEvent(type, {
          data: typeof data === "string" ? data : JSON.stringify(data),
        });
        this.listeners[type]?.forEach((l) => l(event));
      }

      close() {}
    }

    vi.stubGlobal("EventSource", MockEventSource);
    stubPlant(200, {
      ...snapshot,
      current_power_w: 50,
    });

    render(<App />);
    expect(await screen.findByText("50 W")).toBeTruthy();

    expect(MockEventSource.instances.length).toBeGreaterThanOrEqual(1);
    const es = MockEventSource.instances[0];
    expect(es.url).toBe("/api/plant/stream");

    // Push a sample event
    act(() => {
      es.emit("sample", {
        type: "sample",
        logger_serial: "3909309465",
        received_at: "2026-08-22T13:05:00+00:00",
        ac_power_w: 780,
        today_energy_kwh: 0.8,
        lifetime_energy_kwh: 5636.0,
      });
    });

    // Verify instantaneous update to 780 W
    expect(await screen.findByText("780 W")).toBeTruthy();
  });

  it("disables 20s polling when SSE is active and falls back to polling after 3 SSE errors", async () => {
    let sseErrorTrigger: (() => void) | null = null;

    class MockEventSource {
      url: string;
      onopen: (() => void) | null = null;
      onerror: (() => void) | null = null;
      constructor(url: string) {
        this.url = url;
        setTimeout(() => this.onopen?.(), 0);
        sseErrorTrigger = () => this.onerror?.();
      }
      addEventListener() {}
      removeEventListener() {}
      close() {}
    }

    vi.stubGlobal("EventSource", MockEventSource);
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.startsWith("/api/plant")) {
          fetchCount++;
          return new Response(JSON.stringify(snapshot), {
            status: 200,
            headers: { "content-type": "application/json" },
          });
        }
        return new Response("{}", { status: 200 });
      }),
    );

    const setIntervalSpy = vi.spyOn(window, "setInterval");
    render(<App />);
    expect(await screen.findByText("Today so far")).toBeTruthy();
    expect(fetchCount).toBe(1);

    // While SSE is active, no 20s polling interval should be active
    await waitFor(() => {
      const pollingIntervals = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === 20_000,
      );
      expect(pollingIntervals.length).toBe(0);
    });

    // Simulate 4 consecutive SSE errors (> 3 retries threshold)
    for (let i = 0; i < 4; i++) {
      act(() => {
        sseErrorTrigger?.();
      });
    }

    // After >3 failures, 20s polling interval should be registered
    await waitFor(() => {
      const pollingIntervals = setIntervalSpy.mock.calls.filter(
        ([, delay]) => delay === 20_000,
      );
      expect(pollingIntervals.length).toBeGreaterThanOrEqual(1);
    });
  });

  it("renders quiet offline banner when offline or reading cached plant state", async () => {
    stubPlant(200, {
      ...snapshot,
      current_power_at: "2026-08-22T14:32:00-03:00",
    });

    render(<App />);
    expect(await screen.findByText("Today so far")).toBeTruthy();
    expect(screen.queryByText(/Offline · Showing cached plant state/)).toBeNull();

    // Simulate going offline
    act(() => {
      window.dispatchEvent(new Event("offline"));
    });

    expect(
      await screen.findByText("Offline · Showing cached plant state as of 14:32"),
    ).toBeTruthy();

    // Simulate coming back online
    act(() => {
      window.dispatchEvent(new Event("online"));
    });

    await waitFor(() => {
      expect(screen.queryByText(/Offline · Showing cached plant state/)).toBeNull();
    });
  });

  it("renders offline banner on mobile when cached response header is present", async () => {
    stubMatchMedia(false);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo) => {
        const url = String(input);
        if (url.startsWith("/api/plant")) {
          return new Response(
            JSON.stringify({
              ...snapshot,
              current_power_at: "2026-08-22T15:45:00-03:00",
            }),
            {
              status: 200,
              headers: {
                "content-type": "application/json",
                "X-Wattloft-Offline": "true",
              },
            },
          );
        }
        return new Response("{}", { status: 200 });
      }),
    );

    render(<App />);
    expect(
      await screen.findByText("Offline · Showing cached plant state as of 15:45"),
    ).toBeTruthy();
  });
});
