# One hostname and one Elastic IP

Superseded by [ADR 0023](0023-desec-and-reserved-public-ip.md) (deSEC + reserved public IPv4).

Plant view and Server B share one DNS name pointed at an Elastic IP. Deploys reassociate that EIP onto the new VM so hidden Server B does not change. The sticks dial the hostname on the ingest port; the Operator opens `https://` on the same name. A Network Load Balancer is rejected. Hidden Server B must not be a per-instance public IP.
