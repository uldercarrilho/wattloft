# Reverse proxy terminates HTTPS; ingest stays raw

Caddy or nginx on the image binds 80 and 443, obtains the cert, and proxies Plant view to localhost. Wattloft binds Plant view on localhost only and binds Server B on the public ingest port as plaintext Solarman V5. An AWS load balancer in front of the VM is rejected. ACME runs after the Elastic IP is attached.
