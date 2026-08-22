# One public always-on VM

Wattloft’s Server B collector and v1 Plant view run on one always-on public VM that the Loggers dial. History does not live on that VM (see ADR 0010). Lambda, API Gateway, IoT Core, and the rest of a managed ingest platform are still rejected.

The TCP port is not part of the protocol: it is whatever the hidden Server B slot and the collector agree. Titan used 10000; the number is confirmed at cutover, not assumed. Solarman V5 on that port stays plaintext; TLS on the ingest port would break the sticks.

Plant view is HTTPS on a hostname pointed at this VM. That is a different port from Server B. The two must not be collapsed onto one TLS listener.