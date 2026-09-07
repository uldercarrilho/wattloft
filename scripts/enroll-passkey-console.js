(async () => {
  if (location.origin !== "https://wattloft.dedyn.io") {
    console.error("Run this on https://wattloft.dedyn.io after logging in with the password.");
    return;
  }
  const cred = await navigator.credentials.create({
    publicKey: {
      challenge: crypto.getRandomValues(new Uint8Array(32)),
      rp: { id: "wattloft.dedyn.io", name: "Wattloft" },
      user: {
        id: crypto.getRandomValues(new Uint8Array(16)),
        name: "operator",
        displayName: "Operator",
      },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      authenticatorSelection: { residentKey: "preferred", userVerification: "preferred" },
      attestation: "none",
    },
  });
  if (!cred || cred.type !== "public-key") {
    throw new Error("no credential");
  }
  const spki = cred.response.getPublicKey();
  if (!spki) {
    throw new Error("this browser did not expose getPublicKey(); try Chrome or Edge");
  }
  const b64std = (buf) => {
    const bytes = new Uint8Array(buf);
    let s = "";
    for (const b of bytes) s += String.fromCharCode(b);
    return btoa(s);
  };
  const json = JSON.stringify({
    credentialId: b64std(cred.rawId).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, ""),
    publicKey: b64std(spki),
    rpId: "wattloft.dedyn.io",
  });
  console.log(json);
  try {
    await navigator.clipboard.writeText(json);
  } catch {
    /* paste from the console if clipboard is blocked */
  }
  alert("Passkey JSON is in the console (and clipboard if allowed). Paste it into the wizard.");
})();
