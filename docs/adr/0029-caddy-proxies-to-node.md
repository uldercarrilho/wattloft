# Reverse proxy terminates HTTPS onto Node

Amends [ADR 0016](0016-proxy-terminates-tls.md).

Caddy in the same compose as Wattloft binds 80 and 443, obtains the cert, and proxies Plant view to the Node loopback port. Node calls Python’s snapshot API on loopback. Wattloft binds that API on localhost only and binds Server B on the public ingest port as plaintext Solarman V5. A load balancer in front of the VM is rejected (ADR 0023). ACME runs after the reserved public IPv4 is attached.
