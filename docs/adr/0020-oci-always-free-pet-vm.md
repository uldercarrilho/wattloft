# Always Free OCI pet VM, not AWS

v1’s Server B collector and Plant view run on one always-on public VM in this tenancy’s home region, Brazil East (São Paulo), on Oracle Cloud Always Free: Ampere A1 (2 OCPU / 12 GB) first, `VM.Standard.E2.1.Micro` if that shape has no capacity. The tenancy stays Always Free-only (no PAYG). This supersedes ADR 0005’s cloud-agnostic “public VM” as AWS and supersedes ADR 0011.

Idle Always Free compute may be reclaimed after a quiet week. Reclaim is not abort: launch again, reassign the reserved public IPv4 (ADR 0023), CI redeploys (ADR 0022). History is not on the VM (ADR 0021). Unexpected invoice, HeatWave gone, or no Always Free instance after a week of retries aborts to a Lightsail dual-stack nano at ≤ $5/month.

Lambda, API Gateway, IoT Core, and other managed ingest platforms stay rejected. Solarman V5 on the ingest port stays plaintext; Plant view is HTTPS on a different port on the same hostname.
