# Every deploy replaces the VM; no SSH at all

A deploy builds a new image and replaces the instance through AWS APIs. There is no SSH listener for the Operator or for CI. History survives because it is in RDS. In-flight Server B connections drop until the Loggers redial; that gap is accepted.

The public IPv4 is an Elastic IP reassociated onto the new instance. One hostname points at that EIP. Plant view is HTTPS on that name; Server B uses the same name on the ingest port. Hidden Server B stores the hostname, not a disposable instance IP. No load balancer.
