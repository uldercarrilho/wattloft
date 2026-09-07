import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  b64url,
  issuePasskeyChallenge,
  parsePasskeyCredential,
  readPasskeyChallenge,
  verifyPasskeyAssertion,
} from "./passkey";

const PASSWORD = "correct-horse";

describe("passkey credential", () => {
  it("reads credential id, SPKI public key, and rpId from Vault-shaped JSON", () => {
    expect(
      parsePasskeyCredential(
        JSON.stringify({
          credentialId: "abc",
          publicKey: "cHVibGlj",
          rpId: "wattloft.dedyn.io",
        }),
      ),
    ).toEqual({
      credentialId: "abc",
      publicKey: "cHVibGlj",
      rpId: "wattloft.dedyn.io",
    });
    expect(parsePasskeyCredential(undefined)).toBeNull();
    expect(parsePasskeyCredential("{")).toBeNull();
    const json = JSON.stringify({
      credentialId: "abc",
      publicKey: "cHVibGlj",
      rpId: "wattloft.dedyn.io",
    });
    expect(parsePasskeyCredential(Buffer.from(json).toString("base64"))).toEqual({
      credentialId: "abc",
      publicKey: "cHVibGlj",
      rpId: "wattloft.dedyn.io",
    });
  });

  it("round-trips a signed challenge token", () => {
    const { challenge, token } = issuePasskeyChallenge(PASSWORD);
    expect(readPasskeyChallenge(PASSWORD, token)).toBe(challenge);
    expect(readPasskeyChallenge("other", token)).toBeNull();
  });

  it("accepts an ES256 assertion for the stored public key", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const credentialId = b64url(Buffer.from("cred-1"));
    const rpId = "localhost";
    const origin = "http://localhost:3000";
    const challenge = b64url(Buffer.from("challenge-bytes-32-characters!"));
    const passkey = {
      credentialId,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      rpId,
    };
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin }),
      "utf8",
    );
    const rpIdHash = createHash("sha256").update(rpId).digest();
    const authenticatorData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x01]),
      Buffer.from([0, 0, 0, 1]),
    ]);
    const clientHash = createHash("sha256").update(clientDataJSON).digest();
    const signature = sign("sha256", Buffer.concat([authenticatorData, clientHash]), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    expect(
      verifyPasskeyAssertion(
        passkey,
        {
          id: credentialId,
          response: {
            clientDataJSON: b64url(clientDataJSON),
            authenticatorData: b64url(authenticatorData),
            signature: b64url(signature),
          },
        },
        challenge,
        origin,
      ),
    ).toBe(true);
    expect(
      verifyPasskeyAssertion(
        passkey,
        {
          id: credentialId,
          response: {
            clientDataJSON: b64url(clientDataJSON),
            authenticatorData: b64url(authenticatorData),
            signature: b64url(signature),
          },
        },
        challenge,
        "https://evil.example",
      ),
    ).toBe(false);
  });

  it("accepts a DER-encoded ES256 signature", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const credentialId = b64url(Buffer.from("cred-der"));
    const rpId = "localhost";
    const origin = "http://localhost:3000";
    const challenge = b64url(Buffer.from("challenge-bytes-32-characters!"));
    const passkey = {
      credentialId,
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      rpId,
    };
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin }),
      "utf8",
    );
    const rpIdHash = createHash("sha256").update(rpId).digest();
    const authenticatorData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x01]),
      Buffer.from([0, 0, 0, 1]),
    ]);
    const clientHash = createHash("sha256").update(clientDataJSON).digest();
    const signature = sign("sha256", Buffer.concat([authenticatorData, clientHash]), {
      key: privateKey,
      dsaEncoding: "der",
    });
    expect(
      verifyPasskeyAssertion(
        passkey,
        {
          id: credentialId,
          response: {
            clientDataJSON: b64url(clientDataJSON),
            authenticatorData: b64url(authenticatorData),
            signature: b64url(signature),
          },
        },
        challenge,
        origin,
      ),
    ).toBe(true);
  });

  it("matches credential ids across base64 and base64url encodings", () => {
    const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const rawId = Buffer.from([0xff, 0xee, 0xdd, 0xcc, 0xbb]);
    const rpId = "localhost";
    const origin = "http://localhost:3000";
    const challenge = b64url(Buffer.from("challenge-bytes-32-characters!"));
    const passkey = {
      credentialId: rawId.toString("base64"),
      publicKey: publicKey.export({ type: "spki", format: "der" }).toString("base64"),
      rpId,
    };
    const clientDataJSON = Buffer.from(
      JSON.stringify({ type: "webauthn.get", challenge, origin }),
      "utf8",
    );
    const rpIdHash = createHash("sha256").update(rpId).digest();
    const authenticatorData = Buffer.concat([
      rpIdHash,
      Buffer.from([0x01]),
      Buffer.from([0, 0, 0, 1]),
    ]);
    const clientHash = createHash("sha256").update(clientDataJSON).digest();
    const signature = sign("sha256", Buffer.concat([authenticatorData, clientHash]), {
      key: privateKey,
      dsaEncoding: "ieee-p1363",
    });
    expect(
      verifyPasskeyAssertion(
        passkey,
        {
          id: rawId.toString("base64url"),
          response: {
            clientDataJSON: b64url(clientDataJSON),
            authenticatorData: b64url(authenticatorData),
            signature: b64url(signature),
          },
        },
        challenge,
        origin,
      ),
    ).toBe(true);
  });
});
