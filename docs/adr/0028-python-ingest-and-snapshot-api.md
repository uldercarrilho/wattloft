# One Python process for ingest and snapshot API

Amends [ADR 0015](0015-one-wattloft-process.md).

v1 is still one Python process: Server B ingest, History writes, and `GET /snapshot`. HeatWave is not a reason to split ingest from the snapshot API. Plant view is not in that process; the Operator HTTP surface is Node (ADR 0027). A reverse proxy may sit in front; it does not write Samples.
