# One deSEC hostname and one reserved public IPv4

Plant view and Server B share one deSEC DNS name pointed at a reserved public IPv4 on the VM’s VNIC. The record is DNS-only: a CDN proxy would swallow ingest TCP. Rebuilds reassign that reserved IP so hidden Server B does not change. Hidden Server B stores the hostname, not a disposable instance IP. This supersedes ADR 0013 (Elastic IP).

An OCI Network Load Balancer is rejected even though Always Free includes one.
