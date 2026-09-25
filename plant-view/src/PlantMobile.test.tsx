/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MobilePlantView } from "./components/mobile/MobilePlantView";
import type { PlantPayload } from "./types";

vi.mock("chart.js", () => {
  return {
    Chart: class {
      static register = vi.fn();
      static defaults = { locale: "en-US" };
      destroy = vi.fn();
      update = vi.fn();
    },
    LineController: class {},
    BarController: class {},
    LineElement: class {},
    BarElement: class {},
    PointElement: class {},
    LinearScale: class {},
    CategoryScale: class {},
    Filler: class {},
  };
});

const snapshot: Extract<PlantPayload, { empty: false }> = {
  empty: false,
  unit: "day",
  selected_day: "2026-08-21",
  today_energy_kwh: 3.9,
  current_power_w: 450,
  lifetime_energy_kwh: 5635.4,
  current_power_at: "2026-08-21T14:30:00+00:00",
  local_day_bars: [
    {
      local_day: "2026-08-21",
      today_energy_kwh: 3.9,
      prev_year_today_energy_kwh: 3.5,
      loggers: [
        { name: "3909309465", display_name: "East", today_energy_kwh: 2.0 },
        { name: "3913630013", display_name: "West", today_energy_kwh: 1.9 },
      ],
    },
  ],
  loggers_now: [
    {
      name: "3909309465",
      display_name: "East",
      last_success_at: "2026-08-21T14:30:00+00:00",
      power_w: 230,
    },
    {
      name: "3913630013",
      display_name: "West",
      last_success_at: "2026-08-21T14:30:00+00:00",
      power_w: 220,
    },
  ],
  curve: [
    {
      name: "3909309465",
      display_name: "East",
      points: [{ at: "2026-08-21T14:30:00", watts: 230, lifetime_kwh: 5635.4 }],
    },
    {
      name: "3913630013",
      display_name: "West",
      points: [{ at: "2026-08-21T14:30:00", watts: 220, lifetime_kwh: 5410.2 }],
    },
    {
      name: "Plant",
      points: [{ at: "2026-08-21T14:30:00", watts: 450 }],
    },
  ],
  clipping: {
    clipped: true,
    clipped_minutes: 45,
    estimated_clipped_kwh: 0.25,
    plateaus: [
      {
        logger_serial: "3909309465",
        start_minute: 720,
        end_minute: 765,
        start_at: "2026-08-21T12:00:00",
        end_at: "2026-08-21T12:45:00",
        plateau_watts: 600,
        estimated_clipped_kwh: 0.25,
      },
    ],
  },
  drift: {
    detected: false,
    advisory: null,
    affected_logger: null,
    drift_pct: 3,
    baseline_ratio: 1.05,
    rolling_ratio: 1.04,
  },
  ideal_curve: [
    { at: "2026-08-21T12:00:00", watts: 800 },
  ],
};

describe("MobilePlantView (Azulejo Moderno 4-Tab Dock)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-21T14:35:00Z"));
    window.history.replaceState({}, "", "/");
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("renders the 4-tab bottom navigation dock with accessible ARIA roles", () => {
    render(<MobilePlantView payload={snapshot} busy={false} />);

    const tablist = screen.getByRole("tablist", { name: "Mobile views" });
    expect(tablist).toBeTruthy();

    const tabs = screen.getAllByRole("tab");
    expect(tabs).toHaveLength(4);
    expect(screen.getByRole("tab", { name: /Glance/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Power/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /History/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /Insights/i })).toBeTruthy();

    // Glance tab selected by default
    expect(screen.getByRole("tab", { name: /Glance/i }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Plant now")).toBeTruthy();
    expect(screen.getByText("450 W")).toBeTruthy();
  });

  it("switches to Power tab and renders diurnal power curve controls", () => {
    render(<MobilePlantView payload={snapshot} busy={false} />);

    const powerTab = screen.getByRole("tab", { name: /Power/i });
    fireEvent.click(powerTab);

    expect(powerTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByRole("button", { name: "Each" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "By Logger" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Ideal envelope" })).toBeTruthy();
    expect(screen.getByRole("navigation", { name: "Period" })).toBeTruthy();
  });

  it("switches to History tab and displays Day, Month, Year grain switcher", () => {
    render(<MobilePlantView payload={snapshot} busy={false} />);

    const historyTab = screen.getByRole("tab", { name: /History/i });
    fireEvent.click(historyTab);

    expect(historyTab.getAttribute("aria-selected")).toBe("true");
    expect(historyTab.classList.contains("is-active")).toBe(true);
    expect(screen.getByRole("navigation", { name: "History Grain" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Day" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Month" })).toBeTruthy();
    expect(screen.getByRole("link", { name: "Year" })).toBeTruthy();

    // On Day grain, PeriodStepper is present and footer is not rendered
    expect(screen.getByRole("navigation", { name: "Period" })).toBeTruthy();
    expect(screen.queryByText(/Wattloft History · from/)).toBeNull();

    // Switch to Month grain
    fireEvent.click(screen.getByRole("link", { name: "Month" }));
    expect(screen.getByRole("navigation", { name: "Period" })).toBeTruthy();
    expect(screen.getByText(/Wattloft History · from/)).toBeTruthy();

    // Switch to Year grain: PeriodStepper hidden, footer rendered
    fireEvent.click(screen.getByRole("link", { name: "Year" }));
    expect(screen.queryByRole("navigation", { name: "Period" })).toBeNull();
    expect(screen.getByText(/Wattloft History · from/)).toBeTruthy();
  });

  it("switches to Insights tab and surfaces passive solar intelligence metrics", () => {
    render(<MobilePlantView payload={snapshot} busy={false} />);

    const insightsTab = screen.getByRole("tab", { name: /Insights/i });
    fireEvent.click(insightsTab);

    expect(insightsTab.getAttribute("aria-selected")).toBe("true");
    expect(screen.getByText("Array Balance (East / West)")).toBeTruthy();
    expect(screen.getByText(/R\(d\) = 1\.05/)).toBeTruthy();
    expect(screen.getByText("Inverter AC Clipping")).toBeTruthy();
    expect(screen.getByText(/45 min clipping/)).toBeTruthy();
    expect(screen.getByText("Solar Envelope Efficiency")).toBeTruthy();
  });

  it("renders stall banner when one microinverter is silent", () => {
    const stalledSnapshot: Extract<PlantPayload, { empty: false }> = {
      ...snapshot,
      loggers_now: [
        {
          name: "3909309465",
          display_name: "East",
          last_success_at: "2026-08-21T14:30:00+00:00",
          power_w: 230,
        },
        {
          name: "3913630013",
          display_name: "West",
          last_success_at: "2026-08-21T13:45:00+00:00", // 45m silent
          power_w: 0,
        },
      ],
    };

    render(<MobilePlantView payload={stalledSnapshot} busy={false} />);
    const statuses = screen.getAllByRole("status");
    expect(statuses.length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText(/West silent/)).toBeTruthy();
  });

  it("renders offline banner when offline is true", () => {
    render(<MobilePlantView payload={snapshot} busy={false} offline={true} />);
    expect(screen.getByText(/Offline · Showing cached plant state/)).toBeTruthy();
  });
});
