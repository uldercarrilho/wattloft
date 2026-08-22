# History is private MySQL HeatWave, not Postgres on the VM

Samples live in one Always Free MySQL HeatWave DB system (`MySQL.Free`) in the same VCN as the VM, in a private subnet, with no public IP. The HeatWave analytics cluster is off; this is InnoDB. Autonomous Database and NoSQL are rejected. This supersedes ADR 0010 and ADR 0011 (RDS Postgres).

Oracle’s automatic backup keeps one day. Scheduled dumps to Always Free Object Storage are how History survives past that window and past a VM reclaim. The Wattloft process and its automated tests speak MySQL, not Postgres.
