from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from wattloft.config import now_utc
from wattloft.history._store import _SampleRow, _as_utc, load_successful_samples

_LOCAL = ZoneInfo("America/Sao_Paulo")


@dataclass(frozen=True)
class CurvePoint:
    at: datetime
    watts: float
    lifetime_kwh: float | None = None


@dataclass(frozen=True)
class CurveSeries:
    name: str
    points: tuple[CurvePoint, ...]


@dataclass(frozen=True)
class LoggerEnergy:
    name: str
    today_energy_kwh: float


@dataclass(frozen=True)
class LoggerNow:
    name: str
    last_success_at: datetime
    power_w: float


@dataclass(frozen=True)
class LocalDayBar:
    local_day: date
    today_energy_kwh: float
    loggers: tuple[LoggerEnergy, ...]


@dataclass(frozen=True)
class PlantSnapshot:
    today_energy_kwh: float | None
    current_power_w: float
    lifetime_energy_kwh: float
    current_power_at: datetime
    local_day_bars: tuple[LocalDayBar, ...]
    curve: tuple[CurveSeries, ...]
    loggers_now: tuple[LoggerNow, ...] = ()


def _local(value: datetime) -> datetime:
    return _as_utc(value).astimezone(_LOCAL)


def _local_minute(value: datetime) -> datetime:
    stamped = _local(value).replace(second=0, microsecond=0)
    return stamped.replace(tzinfo=None)


def _positive(value: float | None) -> float | None:
    if value is None or value == 0:
        return None
    return value


def _local_day_production(
    bar_life: dict[tuple[date, str], float],
    bar_today: dict[tuple[date, str], float],
) -> dict[date, dict[str, float]]:
    serials = {serial for _, serial in bar_life} | {serial for _, serial in bar_today}
    days = sorted({day for day, _ in bar_life} | {day for day, _ in bar_today})
    by_bar_day: dict[date, dict[str, float]] = {}
    for serial in serials:
        prev_life: float | None = None
        for day in days:
            life = bar_life.get((day, serial))
            today = bar_today.get((day, serial))
            if life is None and today is None:
                continue
            if prev_life is not None and life is not None and life >= prev_life:
                produced = round(life - prev_life, 2)
            elif today is not None:
                produced = today
            else:
                produced = 0.0
            by_bar_day.setdefault(day, {})[serial] = produced
            if life is not None:
                prev_life = life
    return by_bar_day


def _curve_series(
    rows: Iterable[tuple[str, datetime, float, float | None]],
) -> tuple[CurveSeries, ...]:
    by_logger: dict[str, list[CurvePoint]] = {}
    by_minute: dict[datetime, float] = {}
    for serial, minute, watts, lifetime_kwh in rows:
        point = CurvePoint(at=minute, watts=watts, lifetime_kwh=lifetime_kwh)
        by_logger.setdefault(serial, []).append(point)
        by_minute[minute] = by_minute.get(minute, 0.0) + watts
    series = [
        CurveSeries(name=name, points=tuple(sorted(points, key=lambda item: item.at)))
        for name, points in sorted(by_logger.items())
    ]
    if by_minute:
        series.append(
            CurveSeries(
                name="Plant",
                points=tuple(
                    CurvePoint(at=minute, watts=watts)
                    for minute, watts in sorted(by_minute.items())
                ),
            )
        )
    return tuple(series)


def build_plant_snapshot(
    samples: tuple[_SampleRow, ...],
    *,
    selected_day: date | None = None,
    now: datetime | None = None,
) -> PlantSnapshot | None:
    local_day = (now or now_utc()).astimezone(_LOCAL).date()
    curve_day = selected_day or local_day
    if not samples:
        return None

    lifetime_last: dict[str, float] = {}
    latest_power_at: datetime | None = None
    power_in_minute: dict[str, float] = {}
    bar_life: dict[tuple[date, str], float] = {}
    bar_today: dict[tuple[date, str], float] = {}
    curve_last: dict[tuple[str, datetime], tuple[float, float | None]] = {}
    now_success_at: dict[str, datetime] = {}
    now_power: dict[str, float] = {}

    for sample in samples:
        local_stamp = _local(sample.received_at)
        sample_day = local_stamp.date()
        serial = sample.logger_serial
        now_success_at[serial] = sample.received_at
        if sample.ac_power_w is not None:
            now_power[serial] = sample.ac_power_w
        if sample.today_energy_kwh is not None:
            key = (sample_day, serial)
            if sample.today_energy_kwh or key not in bar_today:
                bar_today[key] = sample.today_energy_kwh
        life = _positive(sample.lifetime_energy_kwh)
        if life is not None:
            bar_life[(sample_day, serial)] = life
            lifetime_last[serial] = life
        if sample.ac_power_w is None:
            continue
        if latest_power_at is None or sample.received_at >= latest_power_at:
            latest_power_at = sample.received_at
        if sample_day == curve_day:
            curve_last[(serial, _local_minute(sample.received_at))] = (
                sample.ac_power_w,
                sample.lifetime_energy_kwh,
            )

    if not lifetime_last or latest_power_at is None:
        return None

    current_minute = _local_minute(latest_power_at)
    for sample in samples:
        if sample.ac_power_w is None:
            continue
        if _local_minute(sample.received_at) == current_minute:
            power_in_minute[sample.logger_serial] = sample.ac_power_w

    by_bar_day = _local_day_production(bar_life, bar_today)

    curve_points = [
        (serial, minute, watts, lifetime_kwh)
        for (serial, minute), (watts, lifetime_kwh) in curve_last.items()
    ]

    return PlantSnapshot(
        today_energy_kwh=(
            None
            if local_day not in by_bar_day
            else sum(by_bar_day[local_day].values())
        ),
        current_power_w=sum(power_in_minute.values()),
        lifetime_energy_kwh=sum(lifetime_last.values()),
        current_power_at=latest_power_at,
        local_day_bars=tuple(
            LocalDayBar(
                local_day=day,
                today_energy_kwh=sum(parts.values()),
                loggers=tuple(
                    LoggerEnergy(name=serial, today_energy_kwh=kwh)
                    for serial, kwh in sorted(parts.items())
                    if kwh != 0
                ),
            )
            for day, parts in sorted(by_bar_day.items())
        ),
        curve=_curve_series(curve_points),
        loggers_now=tuple(
            LoggerNow(
                name=serial,
                last_success_at=now_success_at[serial],
                power_w=now_power[serial],
            )
            for serial in sorted(now_power)
        ),
    )


def plant_snapshot(
    database_url: str, selected_day: date | None = None
) -> PlantSnapshot | None:
    return build_plant_snapshot(load_successful_samples(database_url), selected_day=selected_day)
