# Server B is the only ingest path

Wattloft receives Samples only from Loggers pushing on Server B. HTTP polling is not in v1, even as an abort hatch: that would be a second always-on collector, and two writers still fight. Aborting Server B means a gap until the collector is proven again, one Logger at a time. Titan must not keep listening on the same path once Wattloft is Server B.
