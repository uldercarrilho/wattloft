# Security Policy

## Supported Versions

Only the current `main` branch deployed to production is supported with security updates.

| Version | Supported          |
| ------- | ------------------ |
| `main`  | :white_check_mark: |

## Reporting a Vulnerability

Wattloft is a private solar plant monitoring project. If you discover a security vulnerability or potential credential exposure:

1. **Do not create a public issue.**
2. Report the vulnerability privately to the repository owner or open an issue marked with appropriate confidentiality.
3. Include details of the potential issue, impact, and reproduction steps.

## Security Practices in CI/CD

- **Static Analysis (SAST)**: Automated Bandit and Semgrep scans run on pull requests and commits to `main`.
- **Secret Scanning**: Gitleaks runs on every pull request and push to ensure secrets and private keys are never committed.
- **Dependency Auditing (SCA)**: Automated `pip-audit` and `npm audit` check for known vulnerabilities in third-party dependencies.
- **Container Vulnerability Scanning**: Trivy scans Docker container images prior to production deployment.
- **Dynamic Analysis (DAST)**: OWASP ZAP baseline scan runs against ephemeral test containers in deployment staging.
