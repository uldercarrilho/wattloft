# One AWS VM plus one private Postgres

Superseded by [ADR 0020](0020-oci-always-free-pet-vm.md) and [ADR 0021](0021-heatwave-mysql-private-history.md).

v1 runs on AWS as one public VM (EC2 or equivalent) and one Postgres (RDS or equivalent). The database is in the same VPC as the VM and is not reachable from the public internet. No ECS, App Runner, DynamoDB, Redis, queue, or extra ingest services.
