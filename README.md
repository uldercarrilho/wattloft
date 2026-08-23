# Wattloft

Wattloft observes production of one household solar Plant. It exists so that Plant can be watched without using the vendor cloud as the store.

Loggers push Solarman V5 frames to Wattloft on Server B. Wattloft records Samples in History and serves Plant view over HTTPS to the Operator. Server A stays the vendor slot.

## Plant view

On the shared hostname, the Operator sees:

- Today energy, Current Power (with as-of time), and Lifetime energy
- Local-day Today energy bars (`America/Sao_Paulo`)
- That Local day’s Power curve (each Logger and the Plant)

A password authenticates the Operator. Plant view is not served over HTTP.

## Ingest

Samples arrive only from Loggers pushing on Server B (TCP, default port 10000), on the same hostname as Plant view. Wattloft does not poll.

Only Admitted Loggers may create Samples. Unknown serials get no ACK and no write. Sample time is receive time; in-frame Logger clocks are ignored.

## Runtime

v1 is one Python process: ingest, History writes, and Plant view. Caddy terminates TLS in front. History lives in private MySQL HeatWave, not on the VM.

The collector runs on an Always Free OCI pet in São Paulo. Push to `main` tests, publishes a private GHCR image, and deploys through OCI Bastion. The Operator does not SSH.

## Develop

Python 3.12+. Tests need Docker (MySQL via testcontainers).

```bash
pip install -e ".[dev]"
pytest -q
mypy
```

To run the process locally:

```bash
export OPERATOR_PASSWORD=…
export DATABASE_URL=mysql://…
wattloft
```

Optional env: `PLANT_VIEW_HOST` / `PLANT_VIEW_PORT` (default `127.0.0.1:8000`), `INGEST_HOST` / `INGEST_PORT` (default `0.0.0.0:10000`).

## Domain

Terms live in [`CONTEXT.md`](CONTEXT.md). Decisions live in [`docs/adr/`](docs/adr/). Use that vocabulary; do not substitute synonyms the glossary avoids.
