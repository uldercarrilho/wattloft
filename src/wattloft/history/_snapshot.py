from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import date, datetime
from zoneinfo import ZoneInfo

from wattloft.config import now_utc
from wattloft.history._store import _as_utc, load_successful_samples

_LOCAL = ZoneInfo("America/Sao_Paulo")


@dataclass(frozen=True)
class CurvePoint:
    at: datetime
    watts: float


@dataclass(frozen=True)
class CurveSeries:
    name: str
    points: tuple[CurvePoint, ...]


@dataclass(frozen=True)
class LocalDayBar:
    local_day: date
    today_energy_kwh: float


@dataclass(frozen=True)
class PlantSnapshot:
    today_energy_kwh: float | None
    current_power_w: float
    lifetime_energy_kwh: float
    current_power_at: datetime
    local_day_bars: tuple[LocalDayBar, ...]
    curve: tuple[CurveSeries, ...]


def _local(value: datetime) -> datetime:
    return _as_utc(value).astimezone(_LOCAL)


def _local_minute(value: datetime) -> datetime:
    stamped = _local(value).replace(second=0, microsecond=0)
    return stamped.replace(tzinfo=None)


def _curve_series(rows: Iterable[tuple[str, datetime, float]]) -> tuple[CurveSeries, ...]:
    by_logger: dict[str, list[CurvePoint]] = {}
    by_minute: dict[datetime, float] = {}
    for serial, minute, watts in rows:
        point = CurvePoint(at=minute, watts=watts)
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


def plant_snapshot(
    database_url: str, selected_day: date | None = None
) -> PlantSnapshot | None:
    local_day = now_utc().astimezone(_LOCAL).date()
    curve_day = selected_day or local_day
    samples = load_successful_samples(database_url)
    if not samples:
        return None

    today_last: dict[str, float] = {}
    lifetime_last: dict[str, float] = {}
    latest_power_at: datetime | None = None
    power_in_minute: dict[str, float] = {}
    bar_last: dict[tuple[date, str], float] = {}
    curve_last: dict[tuple[str, datetime], float] = {}

    for sample in samples:
        local_stamp = _local(sample.received_at)
        sample_day = local_stamp.date()
        if sample.today_energy_kwh is not None:
            if sample_day == local_day:
                today_last[sample.logger_serial] = sample.today_energy_kwh
            bar_last[(sample_day, sample.logger_serial)] = sample.today_energy_kwh
        if sample.lifetime_energy_kwh is not None:
            lifetime_last[sample.logger_serial] = sample.lifetime_energy_kwh
        if sample.ac_power_w is None:
            continue
        if latest_power_at is None or sample.received_at >= latest_power_at:
            latest_power_at = sample.received_at
        if sample_day == curve_day:
            curve_last[(sample.logger_serial, _local_minute(sample.received_at))] = (
                sample.ac_power_w
            )

    if not lifetime_last or latest_power_at is None:
        return None

    current_minute = _local_minute(latest_power_at)
    for sample in samples:
        if sample.ac_power_w is None:
            continue
        if _local_minute(sample.received_at) == current_minute:
            power_in_minute[sample.logger_serial] = sample.ac_power_w

    by_bar_day: dict[date, float] = {}
    for (day, _), kwh in bar_last.items():
        by_bar_day[day] = by_bar_day.get(day, 0.0) + kwh

    curve_points = [
        (serial, minute, watts) for (serial, minute), watts in curve_last.items()
    ]

    return PlantSnapshot(
        today_energy_kwh=sum(today_last.values()) if today_last else None,
        current_power_w=sum(power_in_minute.values()),
        lifetime_energy_kwh=sum(lifetime_last.values()),
        current_power_at=latest_power_at,
        local_day_bars=tuple(
            LocalDayBar(local_day=day, today_energy_kwh=kwh)
            for day, kwh in sorted(by_bar_day.items())
        ),
        curve=_curve_series(curve_points),
    )
