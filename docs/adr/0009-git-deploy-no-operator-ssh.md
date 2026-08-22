# Operator does not SSH; git is how the box changes

Superseded by [ADR 0022](0022-compose-deploy-via-bastion.md) (Operator still does not SSH; CI uses Bastion, not a public listener, and does not replace the VM).

v1 has no SSH on the instance, not even for CI. Admit list, deploys, and other config change by shipping this repo through GitHub Actions. The pipeline talks to AWS APIs and replaces the VM (ADR 0012). The Operator does not log in.
