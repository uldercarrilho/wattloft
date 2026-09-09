# Day summaries and a pooled MySQL connection

Amends [ADR 0021](0021-heatwave-mysql-private-history.md) and [ADR 0028](0028-python-ingest-and-snapshot-api.md).

History is still Samples in HeatWave InnoDB, and ingest plus `GET /snapshot` still share one Python process. Snapshot generation no longer full-scans `samples`. Local-day rollups live in `day_summaries`, updated in the same transaction as a successful Sample, and `plant_snapshot` reads those rollups plus one Local day’s samples plus each Logger’s recent successful samples. The process keeps a small pymysql pool (five connections, ping on checkout) instead of opening a TCP connection per ingest frame and per snapshot. The JSON snapshot contract and Plant view are unchanged. SSE, PWA, and panel diagnostics stay later milestones.
