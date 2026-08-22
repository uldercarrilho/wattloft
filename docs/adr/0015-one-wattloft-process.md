# One Wattloft process

v1 is one Wattloft process: Server B ingest, History writes, and Plant view. RDS is not a reason to split ingest and view. A reverse proxy may sit in front; it does not write Samples.
