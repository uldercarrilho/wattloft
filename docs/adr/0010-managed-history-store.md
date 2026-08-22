# History lives in a managed database, not on the VM

The VM is replaceable: ingest and Plant view run there, Samples do not. History is one managed Postgres (RDS or equivalent) in the same AWS network as the VM, not on the public internet, so a new VM from the pipeline does not amnesia the Plant. This amends ADR 0005: the runtime is one VM plus this store, not a SQLite file on disk, and not a wider AWS ingest platform.
