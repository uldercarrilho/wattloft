# Git deploys a container through Bastion; the VM is a pet

The Operator never SSHs. GitHub Actions is how the box changes: it builds a multi-arch image (`linux/arm64` and `linux/amd64`), pushes private GHCR, opens an OCI Bastion session, and runs `compose pull && up` on the pet. There is no public TCP 22. This supersedes ADR 0009’s “no SSH even for CI” and ADR 0012 (replace the instance via AWS APIs).

Caddy and Wattloft run in the same compose (ADR 0016). In-flight Server B connections drop across a compose restart or a VM rebuild; the Loggers redial; that gap is accepted. No load balancer.
