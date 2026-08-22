# Secrets: GitHub Actions to SSM, instance role at boot

GitHub Actions secrets are the source for the Operator password and the database URL. They are never committed. The deploy job writes them to SSM Parameter Store (Secrets Manager is the same pattern). The VM’s instance role reads them at boot. User-data and baked AMIs must not carry those secrets.
