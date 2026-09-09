from __future__ import annotations

from collections.abc import Iterator
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any
from zoneinfo import ZoneInfo

from wattloft.history._mysql import _database_name, connection

_LOCAL = ZoneInfo("America/Sao_Paulo")
_BACKFILL_KEY = "day_summaries_backfill"
_BACKFILL_COMPLETE = "complete"

_SAMPLES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS samples (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    logger_serial VARCHAR(32) NOT NULL,
    received_at DATETIME(6) NOT NULL,
    ac_power_w DOUBLE,
    today_energy_kwh DOUBLE,
    lifetime_energy_kwh DOUBLE,
    parse_succeeded TINYINT(1) NOT NULL
)
"""

_DAY_SUMMARIES_TABLE_SQL = """
CREATE TABLE IF NOT EXISTS day_summaries (
    local_day DATE NOT NULL,
    logger_serial VARCHAR(32) NOT NULL,
    first_received_at DATETIME(6) NOT NULL,
    last_received_at DATETIME(6) NOT NULL,
    start_lifetime_kwh DOUBLE,
    last_lifetime_kwh DOUBLE,
    last_today_energy_kwh DOUBLE,
    peak_power_w DOUBLE,
    sample_count INT NOT NULL DEFAULT 1,
    clipped_minutes INT NOT NULL DEFAULT 0,
    estimated_clipped_kwh DOUBLE DEFAULT NULL,
    PRIMARY KEY (local_day, logger_serial),
    INDEX idx_day_summaries_day (local_day)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_HISTORY_META_SQL = """
CREATE TABLE IF NOT EXISTS history_meta (
    k VARCHAR(64) NOT NULL PRIMARY KEY,
    v VARCHAR(255) NOT NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
"""

_SAMPLES_INDEXES = (
    ("idx_samples_received_serial", "(received_at, logger_serial)"),
    ("idx_samples_success_received", "(parse_succeeded, received_at)"),
)

_DUMP_SAMPLES_SQL = """
SELECT logger_serial, received_at, ac_power_w,
       today_energy_kwh, lifetime_energy_kwh, parse_succeeded
FROM samples
ORDER BY received_at, logger_serial
"""

_DUMP_SUMMARIES_SQL = """
SELECT local_day, logger_serial, first_received_at, last_received_at,
       start_lifetime_kwh, last_lifetime_kwh, last_today_energy_kwh,
       peak_power_w, sample_count, clipped_minutes, estimated_clipped_kwh
FROM day_summaries
ORDER BY local_day, logger_serial
"""

_UPSERT_DAY_SUMMARY_SQL = """
INSERT INTO day_summaries (
    local_day, logger_serial, first_received_at, last_received_at,
    start_lifetime_kwh, last_lifetime_kwh, last_today_energy_kwh,
    peak_power_w, sample_count
)
VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 1)
ON DUPLICATE KEY UPDATE
    last_received_at = VALUES(last_received_at),
    start_lifetime_kwh = COALESCE(start_lifetime_kwh, VALUES(start_lifetime_kwh)),
    last_lifetime_kwh = COALESCE(VALUES(last_lifetime_kwh), last_lifetime_kwh),
    last_today_energy_kwh = CASE
        WHEN VALUES(last_today_energy_kwh) IS NULL THEN last_today_energy_kwh
        WHEN VALUES(last_today_energy_kwh) = 0
             AND last_today_energy_kwh IS NOT NULL
             AND last_today_energy_kwh <> 0
            THEN last_today_energy_kwh
        ELSE VALUES(last_today_energy_kwh)
    END,
    peak_power_w = CASE
        WHEN VALUES(peak_power_w) IS NULL THEN peak_power_w
        WHEN peak_power_w IS NULL THEN VALUES(peak_power_w)
        ELSE GREATEST(peak_power_w, VALUES(peak_power_w))
    END,
    sample_count = sample_count + 1
"""


@dataclass(frozen=True)
class _SampleRow:
    logger_serial: str
    received_at: datetime
    ac_power_w: float | None
    today_energy_kwh: float | None
    lifetime_energy_kwh: float | None


@dataclass(frozen=True)
class _DaySummaryRow:
    local_day: date
    logger_serial: str
    last_lifetime_kwh: float | None
    last_today_energy_kwh: float | None
    last_received_at: datetime
    clipped_minutes: int = 0
    estimated_clipped_kwh: float | None = None


def _as_utc(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _as_float(value: float | None) -> float | None:
    if value is None:
        return None
    return float(value)


def _as_date(value: date | datetime) -> date:
    if isinstance(value, datetime):
        return value.date()
    return value


def _nonzero(value: float | None) -> float | None:
    if value is None or value == 0:
        return None
    return value


def _sql_literal(value: object) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, datetime):
        stamped = _as_utc(value).replace(tzinfo=None)
        return "'" + stamped.strftime("%Y-%m-%d %H:%M:%S.%f") + "'"
    if isinstance(value, date):
        return "'" + value.isoformat() + "'"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        return repr(value)
    text = str(value).replace("\\", "\\\\").replace("'", "\\'")
    return "'" + text + "'"


def _index_exists(cursor: Any, table: str, name: str) -> bool:
    cursor.execute(
        """
        SELECT 1 FROM information_schema.statistics
        WHERE table_schema = DATABASE()
          AND table_name = %s AND index_name = %s
        LIMIT 1
        """,
        (table, name),
    )
    return cursor.fetchone() is not None


def _ensure_indexes(cursor: Any) -> None:
    for name, columns in _SAMPLES_INDEXES:
        if _index_exists(cursor, "samples", name):
            continue
        cursor.execute(f"ALTER TABLE samples ADD INDEX {name} {columns}")


def _column_exists(cursor: Any, table: str, column: str) -> bool:
    cursor.execute(
        """
        SELECT 1 FROM information_schema.columns
        WHERE table_schema = DATABASE()
          AND table_name = %s AND column_name = %s
        LIMIT 1
        """,
        (table, column),
    )
    return cursor.fetchone() is not None


def _ensure_day_summary_columns(cursor: Any) -> None:
    if not _column_exists(cursor, "day_summaries", "clipped_minutes"):
        cursor.execute(
            "ALTER TABLE day_summaries ADD COLUMN clipped_minutes INT NOT NULL DEFAULT 0"
        )
    if not _column_exists(cursor, "day_summaries", "estimated_clipped_kwh"):
        cursor.execute(
            "ALTER TABLE day_summaries ADD COLUMN estimated_clipped_kwh DOUBLE DEFAULT NULL"
        )


def _backfill_complete(cursor: Any) -> bool:
    cursor.execute(
        "SELECT v FROM history_meta WHERE k = %s",
        (_BACKFILL_KEY,),
    )
    row = cursor.fetchone()
    return row is not None and str(row[0]) == _BACKFILL_COMPLETE


def _set_backfill_complete(cursor: Any) -> None:
    cursor.execute(
        """
        INSERT INTO history_meta (k, v) VALUES (%s, %s)
        ON DUPLICATE KEY UPDATE v = VALUES(v)
        """,
        (_BACKFILL_KEY, _BACKFILL_COMPLETE),
    )


def _utc_month_chunks(
    first: datetime, last: datetime
) -> Iterator[tuple[datetime, datetime]]:
    start_local = first.astimezone(_LOCAL)
    end_local = last.astimezone(_LOCAL)
    year, month = start_local.year, start_local.month
    while (year, month) <= (end_local.year, end_local.month):
        month_start = datetime(year, month, 1, tzinfo=_LOCAL)
        if month == 12:
            month_end = datetime(year + 1, 1, 1, tzinfo=_LOCAL)
            year, month = year + 1, 1
        else:
            month_end = datetime(year, month + 1, 1, tzinfo=_LOCAL)
            month += 1
        yield (
            month_start.astimezone(timezone.utc),
            month_end.astimezone(timezone.utc),
        )


def _upsert_day_summary(
    cursor: Any,
    *,
    logger_serial: str,
    received_at: datetime,
    ac_power_w: float | None,
    today_energy_kwh: float | None,
    lifetime_energy_kwh: float | None,
) -> None:
    stored_at = _as_utc(received_at).replace(tzinfo=None)
    local_day = _as_utc(received_at).astimezone(_LOCAL).date()
    life = _nonzero(lifetime_energy_kwh)
    cursor.execute(
        _UPSERT_DAY_SUMMARY_SQL,
        (
            local_day,
            logger_serial,
            stored_at,
            stored_at,
            life,
            life,
            today_energy_kwh,
            ac_power_w,
        ),
    )


def _backfill_day_summaries(cursor: Any) -> None:
    cursor.execute(
        """
        SELECT MIN(received_at), MAX(received_at)
        FROM samples WHERE parse_succeeded
        """
    )
    first, last = cursor.fetchone()
    if first is None or last is None:
        return
    for start, end in _utc_month_chunks(_as_utc(first), _as_utc(last)):
        cursor.execute(
            """
            SELECT logger_serial, received_at, ac_power_w,
                   today_energy_kwh, lifetime_energy_kwh
            FROM samples
            WHERE parse_succeeded
              AND received_at >= %s AND received_at < %s
            ORDER BY received_at, logger_serial
            """,
            (
                start.replace(tzinfo=None),
                end.replace(tzinfo=None),
            ),
        )
        rows = cursor.fetchall()
        for row in rows:
            serial, received_at, ac_power_w, today, lifetime = row
            _upsert_day_summary(
                cursor,
                logger_serial=str(serial),
                received_at=_as_utc(received_at),
                ac_power_w=_as_float(ac_power_w),
                today_energy_kwh=_as_float(today),
                lifetime_energy_kwh=_as_float(lifetime),
            )


def _backfill_if_needed(conn: Any, *, rebuild: bool) -> None:
    with conn.cursor() as cursor:
        if _backfill_complete(cursor):
            return
        cursor.execute("SELECT 1 FROM samples WHERE parse_succeeded LIMIT 1")
        if cursor.fetchone() is None:
            return
        cursor.execute("SELECT 1 FROM day_summaries LIMIT 1")
        has_summaries = cursor.fetchone() is not None
        if has_summaries and not rebuild:
            _set_backfill_complete(cursor)
            return
        if rebuild:
            cursor.execute("TRUNCATE TABLE day_summaries")
        _backfill_day_summaries(cursor)
        _set_backfill_complete(cursor)


def _sample_rows(fetched: Any) -> tuple[_SampleRow, ...]:
    samples: list[_SampleRow] = []
    for row in fetched:
        serial, received_at, ac_power_w, today_energy_kwh, lifetime_energy_kwh = row
        samples.append(
            _SampleRow(
                logger_serial=str(serial),
                received_at=_as_utc(received_at),
                ac_power_w=_as_float(ac_power_w),
                today_energy_kwh=_as_float(today_energy_kwh),
                lifetime_energy_kwh=_as_float(lifetime_energy_kwh),
            )
        )
    return tuple(samples)


def ensure_history(database_url: str) -> None:
    name = _database_name(database_url)
    with connection(database_url, use_database=False) as conn:
        with conn.cursor() as cursor:
            cursor.execute(f"CREATE DATABASE IF NOT EXISTS `{name}`")
        conn.commit()
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(_SAMPLES_TABLE_SQL)
            _ensure_indexes(cursor)
            cursor.execute(_DAY_SUMMARIES_TABLE_SQL)
            _ensure_day_summary_columns(cursor)
            cursor.execute(_HISTORY_META_SQL)
        conn.commit()
        _backfill_if_needed(conn, rebuild=True)
        conn.commit()


def dump_history(database_url: str) -> str:
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(_DUMP_SAMPLES_SQL)
            sample_rows = cursor.fetchall()
            cursor.execute(_DUMP_SUMMARIES_SQL)
            summary_rows = cursor.fetchall()
    statements = [_SAMPLES_TABLE_SQL.strip() + ";"]
    for row in sample_rows:
        values = ", ".join(_sql_literal(item) for item in row)
        statements.append(
            "INSERT INTO samples ("
            "logger_serial, received_at, ac_power_w, "
            "today_energy_kwh, lifetime_energy_kwh, parse_succeeded"
            f") VALUES ({values});"
        )
    statements.append(_DAY_SUMMARIES_TABLE_SQL.strip() + ";")
    for row in summary_rows:
        values = ", ".join(_sql_literal(item) for item in row)
        statements.append(
            "INSERT INTO day_summaries ("
            "local_day, logger_serial, first_received_at, last_received_at, "
            "start_lifetime_kwh, last_lifetime_kwh, last_today_energy_kwh, "
            "peak_power_w, sample_count, clipped_minutes, estimated_clipped_kwh"
            f") VALUES ({values});"
        )
    return "\n".join(statements) + "\n"


def restore_history(database_url: str, dump: str) -> None:
    ensure_history(database_url)
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            for raw in dump.split(";"):
                statement = raw.strip()
                if statement:
                    cursor.execute(statement)
        conn.commit()
        _backfill_if_needed(conn, rebuild=False)
        conn.commit()


def record_sample(
    database_url: str,
    *,
    logger_serial: str,
    received_at: datetime,
    ac_power_w: float | None,
    today_energy_kwh: float | None,
    lifetime_energy_kwh: float | None,
    parse_succeeded: bool = True,
) -> None:
    stored_at = _as_utc(received_at).replace(tzinfo=None)
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                INSERT INTO samples (
                    logger_serial,
                    received_at,
                    ac_power_w,
                    today_energy_kwh,
                    lifetime_energy_kwh,
                    parse_succeeded
                )
                VALUES (%s, %s, %s, %s, %s, %s)
                """,
                (
                    logger_serial,
                    stored_at,
                    ac_power_w,
                    today_energy_kwh,
                    lifetime_energy_kwh,
                    1 if parse_succeeded else 0,
                ),
            )
            if parse_succeeded:
                _upsert_day_summary(
                    cursor,
                    logger_serial=logger_serial,
                    received_at=received_at,
                    ac_power_w=ac_power_w,
                    today_energy_kwh=today_energy_kwh,
                    lifetime_energy_kwh=lifetime_energy_kwh,
                )
                _set_backfill_complete(cursor)
        conn.commit()


def load_successful_samples(database_url: str) -> tuple[_SampleRow, ...]:
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT logger_serial, received_at, ac_power_w,
                       today_energy_kwh, lifetime_energy_kwh
                FROM samples
                WHERE parse_succeeded
                ORDER BY received_at
                """
            )
            rows = cursor.fetchall()
    return _sample_rows(rows)


def load_day_summaries(database_url: str) -> tuple[_DaySummaryRow, ...]:
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT local_day, logger_serial, last_lifetime_kwh,
                       last_today_energy_kwh, last_received_at,
                       clipped_minutes, estimated_clipped_kwh
                FROM day_summaries
                ORDER BY local_day ASC, logger_serial ASC
                """
            )
            rows = cursor.fetchall()
    summaries: list[_DaySummaryRow] = []
    for row in rows:
        local_day, serial, last_life, last_today, last_received, clipped_min, est_clipped = row
        summaries.append(
            _DaySummaryRow(
                local_day=_as_date(local_day),
                logger_serial=str(serial),
                last_lifetime_kwh=_as_float(last_life),
                last_today_energy_kwh=_as_float(last_today),
                last_received_at=_as_utc(last_received),
                clipped_minutes=int(clipped_min or 0),
                estimated_clipped_kwh=_as_float(est_clipped),
            )
        )
    return tuple(summaries)


def update_day_summary_clipping(
    database_url: str,
    *,
    local_day: date,
    logger_serial: str,
    clipped_minutes: int,
    estimated_clipped_kwh: float | None,
) -> None:
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                UPDATE day_summaries
                SET clipped_minutes = %s, estimated_clipped_kwh = %s
                WHERE local_day = %s AND logger_serial = %s
                """,
                (clipped_minutes, estimated_clipped_kwh, local_day, logger_serial),
            )
        conn.commit()


def load_samples_for_local_day(
    database_url: str, local_day: date
) -> tuple[_SampleRow, ...]:
    start = datetime.combine(local_day, datetime.min.time(), tzinfo=_LOCAL)
    end = datetime.combine(
        local_day + timedelta(days=1), datetime.min.time(), tzinfo=_LOCAL
    )
    start_utc = start.astimezone(timezone.utc).replace(tzinfo=None)
    end_utc = end.astimezone(timezone.utc).replace(tzinfo=None)
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT logger_serial, received_at, ac_power_w,
                       today_energy_kwh, lifetime_energy_kwh
                FROM samples
                WHERE received_at >= %s AND received_at < %s
                  AND parse_succeeded = 1
                ORDER BY received_at ASC
                """,
                (start_utc, end_utc),
            )
            rows = cursor.fetchall()
    return _sample_rows(rows)


def load_latest_logger_samples(database_url: str) -> tuple[_SampleRow, ...]:
    with connection(database_url) as conn:
        with conn.cursor() as cursor:
            cursor.execute(
                """
                SELECT s.logger_serial, s.received_at, s.ac_power_w,
                       s.today_energy_kwh, s.lifetime_energy_kwh
                FROM samples s
                INNER JOIN (
                    SELECT logger_serial, MAX(last_received_at) AS last_at
                    FROM day_summaries
                    GROUP BY logger_serial
                ) d ON s.logger_serial = d.logger_serial
                WHERE s.parse_succeeded = 1
                  AND s.received_at >= DATE_SUB(d.last_at, INTERVAL 24 HOUR)
                ORDER BY s.received_at ASC
                """
            )
            rows = cursor.fetchall()
    return _sample_rows(rows)
