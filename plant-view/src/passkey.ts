import {
  createHash,
  createHmac,
  createPublicKey,
  randomBytes,
  timingSafeEqual,
  verify,
} from "node:crypto";

export type OperatorPasskey = {
  credentialId: string;
  publicKey: string;
  rpId: string;
};

export type PasskeyAssertion = {
  id: string;
  response: {
    clientDataJSON: string;
    authenticatorData: string;
    signature: string;
  };
};

const CHALLENGE_TTL_SECONDS = 5 * 60;

export function parsePasskeyCredential(raw: string | undefined): OperatorPasskey | null {
  if (!raw?.trim()) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (
      typeof parsed.credentialId === "string" &&
      typeof parsed.publicKey === "string" &&
      typeof parsed.rpId === "string" &&
      parsed.credentialId &&
      parsed.publicKey &&
      parsed.rpId
    ) {
      return {
        credentialId: parsed.credentialId,
        publicKey: parsed.publicKey,
        rpId: parsed.rpId,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function b64url(data: Buffer): string {
  return data.toString("base64url");
}

export function fromB64url(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

export function issuePasskeyChallenge(password: string): { challenge: string; token: string } {
  const challenge = b64url(randomBytes(32));
  const issuedAt = Math.floor(Date.now() / 1000);
  return { challenge, token: signChallenge(password, challenge, issuedAt) };
}

export function readPasskeyChallenge(password: string, token: string | null): string | null {
  if (!token) {
    return null;
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    return null;
  }
  const [issuedRaw, challenge, offeredHmac] = parts;
  const issuedAt = Number(issuedRaw);
  if (!Number.isInteger(issuedAt) || issuedRaw !== String(issuedAt) || !challenge || !offeredHmac) {
    return null;
  }
  const age = Math.floor(Date.now() / 1000) - issuedAt;
  if (age < 0 || age > CHALLENGE_TTL_SECONDS) {
    return null;
  }
  const expected = Buffer.from(challengeHmac(password, challenge, issuedAt));
  const got = Buffer.from(offeredHmac);
  if (got.length !== expected.length) {
    return null;
  }
  if (!timingSafeEqual(got, expected)) {
    return null;
  }
  return challenge;
}

export function verifyPasskeyAssertion(
  passkey: OperatorPasskey,
  assertion: PasskeyAssertion,
  challenge: string,
  origin: string,
): boolean {
  if (assertion.id !== passkey.credentialId) {
    return false;
  }
  let clientData: { type?: string; challenge?: string; origin?: string };
  const clientDataBytes = fromB64url(assertion.response.clientDataJSON);
  try {
    clientData = JSON.parse(clientDataBytes.toString("utf8")) as {
      type?: string;
      challenge?: string;
      origin?: string;
    };
  } catch {
    return false;
  }
  if (clientData.type !== "webauthn.get") {
    return false;
  }
  if (clientData.challenge !== challenge) {
    return false;
  }
  if (clientData.origin !== origin) {
    return false;
  }
  const authenticatorData = fromB64url(assertion.response.authenticatorData);
  if (authenticatorData.length < 37) {
    return false;
  }
  const rpIdHash = createHash("sha256").update(passkey.rpId).digest();
  if (!timingSafeEqual(authenticatorData.subarray(0, 32), rpIdHash)) {
    return false;
  }
  const flags = authenticatorData[32]!;
  if ((flags & 0x01) === 0) {
    return false;
  }
  const clientHash = createHash("sha256").update(clientDataBytes).digest();
  const signed = Buffer.concat([authenticatorData, clientHash]);
  const signature = fromB64url(assertion.response.signature);
  try {
    const key = createPublicKey({
      key: Buffer.from(passkey.publicKey, "base64"),
      format: "der",
      type: "spki",
    });
    return verify(
      "sha256",
      signed,
      { key, dsaEncoding: "ieee-p1363" },
      signature,
    );
  } catch {
    return false;
  }
}

function challengeHmac(password: string, challenge: string, issuedAt: number): string {
  return createHmac("sha256", password).update(`passkey.${issuedAt}.${challenge}`).digest("hex");
}

function signChallenge(password: string, challenge: string, issuedAt: number): string {
  return `${issuedAt}.${challenge}.${challengeHmac(password, challenge, issuedAt)}`;
}
