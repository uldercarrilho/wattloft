# Secrets: Vault and instance principal, env file at boot

GitHub Actions is the source for the Operator password, the database URL, and the GHCR pull token. They are never committed. The deploy job writes them to OCI Vault. A host systemd unit uses the instance principal at boot (or after a pull) to write a root-only env file; compose reads that file. Wattloft does not speak OCI. User-data and images must not carry those secrets. This supersedes ADR 0014 (SSM).
