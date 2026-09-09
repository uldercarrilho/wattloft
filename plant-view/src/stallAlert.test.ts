import { describe, expect, it } from "vitest";
import { evaluateStallAlert, getLocalCivilTime } from "./stallAlert";
import type { LoggerNow } from "./types";

describe("stallAlert", () => {
  const EAST: LoggerNow = {
    name: "3909309465",
    display_name: "East",
    last_success_at: "2026-09-09T14:32:00-03:00",
    power_w: 420,
  };

  it("calculates America/Sao_Paulo civil time correctly", () => {
    // 2026-09-09 15:30 UTC is 12:30 in Sao Paulo (-03:00)
    const now = new Date("2026-09-09T15:30:00Z");
    const civil = getLocalCivilTime(now);
    expect(civil.hour).toBe(12);
    expect(civil.minute).toBe(30);
    expect(civil.localDay).toBe("2026-09-09");
  });

  it("suppresses alerts outside daylight hours (before 07:00 or at/after 18:00)", () => {
    // 06:59 Sao Paulo time
    const dawn = new Date("2026-09-09T06:59:00-03:00");
    const westStalled: LoggerNow = {
      name: "3913630013",
      display_name: "West",
      last_success_at: "2026-09-09T06:20:00-03:00",
      power_w: 0,
    };
    const eastActive: LoggerNow = {
      ...EAST,
      last_success_at: "2026-09-09T06:58:00-03:00",
      power_w: 120,
    };
    expect(evaluateStallAlert(dawn, [westStalled, eastActive], new Set())).toBeNull();

    // 18:00 Sao Paulo time
    const dusk = new Date("2026-09-09T18:00:00-03:00");
    expect(evaluateStallAlert(dusk, [westStalled, eastActive], new Set())).toBeNull();
  });

  it("does not alert when silent duration is 20 minutes or less", () => {
    const now = new Date("2026-09-09T12:00:00-03:00");
    const west20m: LoggerNow = {
      name: "3913630013",
      display_name: "West",
      last_success_at: "2026-09-09T11:40:00-03:00", // exactly 20m
      power_w: 0,
    };
    const eastActive: LoggerNow = {
      ...EAST,
      last_success_at: "2026-09-09T11:59:00-03:00",
      power_w: 420,
    };
    expect(evaluateStallAlert(now, [west20m, eastActive], new Set())).toBeNull();
  });

  it("does not alert when sibling power is 50 W or less", () => {
    const now = new Date("2026-09-09T12:00:00-03:00");
    const westStalled: LoggerNow = {
      name: "3913630013",
      display_name: "West",
      last_success_at: "2026-09-09T11:30:00-03:00", // 30m silent
      power_w: 0,
    };
    const eastLowPower: LoggerNow = {
      ...EAST,
      last_success_at: "2026-09-09T11:59:00-03:00",
      power_w: 50, // threshold is > 50 W
    };
    expect(evaluateStallAlert(now, [westStalled, eastLowPower], new Set())).toBeNull();
  });

  it("fires alert when silent > 20m during daylight with sibling producing > 50 W", () => {
    const now = new Date("2026-09-09T14:32:00-03:00");
    const westStalled: LoggerNow = {
      name: "3913630013",
      display_name: "West",
      last_success_at: "2026-09-09T14:11:00-03:00", // 21 minutes silent
      power_w: 0,
    };
    const eastActive: LoggerNow = {
      ...EAST,
      last_success_at: "2026-09-09T14:31:00-03:00",
      power_w: 420.2,
    };

    const alert = evaluateStallAlert(now, [westStalled, eastActive], new Set());
    expect(alert).not.toBeNull();
    expect(alert!.key).toBe("2026-09-09:3913630013");
    expect(alert!.minutesSilent).toBe(21);
    expect(alert!.notification.title).toBe("Wattloft · Logger Stall");
    expect(alert!.notification.body).toBe(
      "West logger has been silent for 21m while East is producing 420 W.",
    );
    expect(alert!.notification.icon).toBe("/favicon.svg");
  });

  it("suppresses duplicate alert on the same Local day", () => {
    const now = new Date("2026-09-09T14:32:00-03:00");
    const westStalled: LoggerNow = {
      name: "3913630013",
      display_name: "West",
      last_success_at: "2026-09-09T14:11:00-03:00",
      power_w: 0,
    };
    const eastActive: LoggerNow = {
      ...EAST,
      last_success_at: "2026-09-09T14:31:00-03:00",
      power_w: 420,
    };

    const sentKeys = new Set(["2026-09-09:3913630013"]);
    expect(evaluateStallAlert(now, [westStalled, eastActive], sentKeys)).toBeNull();

    // Next local day: can fire again if sibling is active tomorrow
    const tomorrow = new Date("2026-09-10T14:32:00-03:00");
    const westTomorrow: LoggerNow = {
      ...westStalled,
      last_success_at: "2026-09-10T14:11:00-03:00",
    };
    const eastTomorrow: LoggerNow = {
      ...eastActive,
      last_success_at: "2026-09-10T14:31:00-03:00",
    };
    const tomorrowAlert = evaluateStallAlert(tomorrow, [westTomorrow, eastTomorrow], sentKeys);
    expect(tomorrowAlert).not.toBeNull();
    expect(tomorrowAlert!.key).toBe("2026-09-10:3913630013");
  });
});
