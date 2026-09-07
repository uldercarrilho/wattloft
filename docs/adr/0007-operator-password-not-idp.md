# Operator password is v1 auth; passkey is a second Vault factor

Plant view is on the public internet, so a secret URL is not access control. v1 authenticates the one Operator with a password Wattloft stores, and optionally a passkey. Google, Apple, and Cognito are deferred: they are an identity product for one human, not a cheaper login.

The passkey is not an IdP. It is a WebAuthn credential (credential id + public key) injected as `OPERATOR_PASSKEY_CREDENTIAL` from Vault, the same env file as `OPERATOR_PASSWORD`. `POST /login` remains the password form. `POST /login/passkey` verifies an assertion against that public key and sets the same session cookie. There is no Plant view settings page to register a passkey.
