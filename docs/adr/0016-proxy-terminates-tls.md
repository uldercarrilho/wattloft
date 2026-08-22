# Reverse proxy terminates HTTPS; ingest stays raw

Caddy in the same compose as Wattloft binds 80 and 443, obtains the cert, and proxies Plant view to the Wattloft localhost port. Wattloft binds Plant view on localhost only and binds Server B on the public ingest port as plaintext Solarman V5. A load balancer in front of the VM is rejected (ADR 0023). ACME runs after the reserved public IPv4 is attached.
