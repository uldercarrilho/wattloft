# Public ports are 80, 443, and ingest

The VM’s product surface on the public internet is port 80 (ACME and HTTP redirect only), 443 (Plant view HTTPS), and the Server B TCP port. Plant view is not served over HTTP. Any other listener is out of v1.
