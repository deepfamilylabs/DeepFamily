import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { getBytes, hexlify } from "ethers";
import {
  INDEPENDENT_KEY_ARGON2ID_PROFILE,
  SHIELDED_INDEPENDENT_KEY_UNICODE_VERSION,
  buildShieldedIndependentKeyPasswordBytes,
  deriveShieldedIndependentKeyMaterial,
  deriveShieldedIndependentKeyIdentitySalt,
  deriveShieldedIndependentKeyIdentitySecret,
  encodeShieldedIndependentKeyIdentity,
  normalizeShieldedIndependentKeyIdentity,
  normalizeShieldedIndependentKeyPassphrase,
} from "../index.js";
import { independentKeyVector as vector } from "./shielded-independent-key.fixture.js";

const sha256 = (value) => crypto.createHash("sha256").update(value).digest();
const hkdf = (value, domain, info = Buffer.alloc(0)) =>
  Buffer.from(crypto.hkdfSync("sha256", value, sha256(domain), info, 32));

test("independent key freezes full credential, Argon2id, HKDF and X25519 recovery vector", async (t) => {
  assert.equal(SHIELDED_INDEPENDENT_KEY_UNICODE_VERSION, "17.0.0");
  assert.deepEqual(INDEPENDENT_KEY_ARGON2ID_PROFILE, {
    status: "candidate-awaiting-device-benchmark",
    provisional: true,
    algorithm: "Argon2id",
    version: 0x13,
    memoryKiB: 65_536,
    iterations: 3,
    parallelism: 1,
    outputBytes: 32,
    saltBytes: 16,
  });
  const normalized = normalizeShieldedIndependentKeyIdentity(vector.identity);
  assert.equal(normalized.fullName, vector.normalizedName);
  assert.equal(
    normalizeShieldedIndependentKeyPassphrase(vector.rawPassphrase),
    vector.normalizedPassphrase,
  );
  const identityBytes = encodeShieldedIndependentKeyIdentity(vector.identity);
  // Independent fixed-width encoder with literal field order and byte widths.
  assert.deepEqual(
    Buffer.from(identityBytes),
    Buffer.concat([
      Buffer.from([0, 8]),
      Buffer.from("Alice é"),
      Buffer.from([255, 1, 255, 255, 12, 31]),
    ]),
  );
  assert.equal(hexlify(identityBytes), vector.identityBytes);
  const password = buildShieldedIndependentKeyPasswordBytes(vector.rawPassphrase);
  assert.deepEqual(
    Buffer.from(password),
    Buffer.from("DeepFamily:IndependentKeyIdentityPassword:v1\0  Pa ssé  "),
  );
  assert.equal(hexlify(password), vector.passwordBytes);
  const salt = deriveShieldedIndependentKeyIdentitySalt(vector.identity);
  assert.deepEqual(
    Buffer.from(salt),
    sha256(
      Buffer.concat([Buffer.from("DeepFamily:IndependentKeyIdentitySalt:v1\0"), identityBytes]),
    ).subarray(0, 16),
  );
  assert.equal(hexlify(salt), vector.salt);
  const independentKeyIdentitySecret = await deriveShieldedIndependentKeyIdentitySecret(vector);
  assert.equal(hexlify(independentKeyIdentitySecret), vector.independentKeyIdentitySecret);
  // Node 24's OpenSSL implementation is independent of browser hash-wasm.
  // Node 22 still verifies the same previously cross-checked immutable vector.
  if (crypto.argon2Sync) {
    assert.deepEqual(
      Buffer.from(independentKeyIdentitySecret),
      crypto.argon2Sync("argon2id", {
        message: password,
        nonce: salt,
        parallelism: 1,
        tagLength: 32,
        memory: 65_536,
        passes: 3,
      }),
    );
  } else
    t.diagnostic(
      "Native independent Argon2id check requires Node 24.7 or newer; frozen reference checked.",
    );

  const boundRoot = hkdf(
    Buffer.concat([getBytes(vector.independentKeyRoot), independentKeyIdentitySecret]),
    "DeepFamily:IdentityBoundIndependentKeyRoot:v1",
  );
  assert.equal(hexlify(boundRoot), vector.boundRoot);
  const field = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
  let ownerSecret;
  for (let counter = 0; ownerSecret === undefined; counter += 1) {
    const info = Buffer.alloc(4);
    info.writeUInt32BE(counter);
    const candidate = BigInt(hexlify(hkdf(boundRoot, "DeepFamily:IndependentKeySpend:v1", info)));
    if (candidate > 0n && candidate < field) ownerSecret = candidate;
  }
  assert.equal(ownerSecret, vector.ownerSecret);
  const hpke = hkdf(boundRoot, "DeepFamily:IndependentKeyView:v1");
  assert.equal(hexlify(hpke), vector.hpkeIkm);
  // RFC 9180 DHKEM(X25519, HKDF-SHA256), independently via Node HMAC/X25519.
  const hpkeLabel = Buffer.concat([Buffer.from("HPKE-v1KEM"), Buffer.from([0, 32])]);
  const prk = crypto
    .createHmac("sha256", Buffer.alloc(32))
    .update(Buffer.concat([hpkeLabel, Buffer.from("dkp_prk"), hpke]))
    .digest();
  const sk = crypto
    .createHmac("sha256", prk)
    .update(Buffer.concat([Buffer.from([0, 32]), hpkeLabel, Buffer.from("sk"), Buffer.from([1])]))
    .digest();
  const privateKey = crypto.createPrivateKey({
    key: Buffer.concat([Buffer.from("302e020100300506032b656e04220420", "hex"), sk]),
    format: "der",
    type: "pkcs8",
  });
  const publicKey = crypto
    .createPublicKey(privateKey)
    .export({ format: "der", type: "spki" })
    .subarray(-32);
  assert.equal(hexlify(publicKey), vector.viewPublicKey);
  const keys = await deriveShieldedIndependentKeyMaterial({
    independentKeyRoot: vector.independentKeyRoot,
    independentKeyIdentitySecret,
  });
  assert.equal(keys.ownerSecret, vector.ownerSecret);
  assert.equal(keys.ownerCommitment, vector.ownerCommitment);
  assert.equal(keys.hpkeIkm, vector.hpkeIkm);
  assert.equal(hexlify(keys.viewPublicKey), vector.viewPublicKey);
  assert.equal(keys.keyFingerprint, vector.keyFingerprint);
  const owner = Buffer.from(keys.ownerCommitment.toString(16).padStart(64, "0"), "hex");
  assert.equal(
    hexlify(
      sha256(
        Buffer.concat([
          Buffer.from("DeepFamily:IndependentKeyFingerprint:v1\0"),
          Buffer.from([1, 1]),
          owner,
          publicKey,
        ]),
      ),
    ),
    vector.keyFingerprint,
  );
});

test("independent-key credential normalization preserves frozen Unicode 17 semantics and raw whitespace", () => {
  assert.equal(
    normalizeShieldedIndependentKeyIdentity({ ...vector.identity, fullName: "\u2000꟱mith\u0085 Ａ\u3000" })
      .fullName,
    "Smith A",
  );
  assert.equal(normalizeShieldedIndependentKeyPassphrase("\uff21\u00a0a\u030a "), "\uff21 å ");
  assert.notEqual(
    normalizeShieldedIndependentKeyPassphrase(" phrase "),
    normalizeShieldedIndependentKeyPassphrase("phrase"),
  );
  assert.notEqual(
    normalizeShieldedIndependentKeyPassphrase("Secret"),
    normalizeShieldedIndependentKeyPassphrase("secret"),
  );
  assert.equal(normalizeShieldedIndependentKeyPassphrase("क्‍क"), "क्‍क");
  assert.equal(normalizeShieldedIndependentKeyPassphrase("l·l"), "l·l");
  assert.throws(() => normalizeShieldedIndependentKeyPassphrase("a·b"), {
    code: "CONTEXTUAL_RULE_NOT_SATISFIED",
  });
  assert.throws(() => normalizeShieldedIndependentKeyPassphrase("ab‍cd"), {
    code: "CONTEXTUAL_RULE_NOT_SATISFIED",
  });
  for (const value of ["", " ", "\u00a0\u3000"]) {
    assert.throws(() => normalizeShieldedIndependentKeyPassphrase(value), {
      code: "INDEPENDENT_KEY_PASSPHRASE_REQUIRED",
    });
  }
  for (const value of ["a\tb", "a\u2028b", "a\u200bb", "a\ud800b"]) {
    assert.throws(() => normalizeShieldedIndependentKeyPassphrase(value));
  }
  const originalNormalize = String.prototype.normalize;
  try {
    String.prototype.normalize = () => {
      throw new Error("Host Unicode normalization forbidden");
    };
    assert.equal(normalizeShieldedIndependentKeyIdentity(vector.identity).fullName, "Alice é");
    assert.equal(normalizeShieldedIndependentKeyPassphrase(vector.rawPassphrase), "  Pa ssé  ");
  } finally {
    String.prototype.normalize = originalNormalize;
  }
});

test("independent-key identity uses exact integer widths and rejects malformed credentials before KDF", async () => {
  assert.equal(
    encodeShieldedIndependentKeyIdentity({
      fullName: "A",
      gender: 0,
      birthYear: 0,
      birthMonth: 0,
      birthDay: 0,
      isBirthBC: false,
    }).length,
    9,
  );
  assert.equal(
    normalizeShieldedIndependentKeyIdentity({ ...vector.identity, fullName: "é".repeat(128) }).fullName
      .length,
    128,
  );
  for (const override of [
    { fullName: "" },
    { fullName: "\u2000\u00a0" },
    { fullName: "é".repeat(129) },
    { fullName: "\ud800" },
    { gender: 256 },
    { gender: -1 },
    { gender: 0.5 },
    { birthYear: 65536 },
    { birthMonth: 13 },
    { birthDay: 32 },
    { isBirthBC: 1 },
  ]) {
    assert.throws(() => normalizeShieldedIndependentKeyIdentity({ ...vector.identity, ...override }));
    await assert.rejects(
      deriveShieldedIndependentKeyIdentitySecret({
        identity: { ...vector.identity, ...override },
        rawPassphrase: vector.rawPassphrase,
      }),
    );
  }
  await assert.rejects(
    deriveShieldedIndependentKeyIdentitySecret({ identity: vector.identity, rawPassphrase: "" }),
    { code: "INDEPENDENT_KEY_PASSPHRASE_REQUIRED" },
  );
});

test("independent-key credentials are stable across defaults and change only with normalized credentials", async () => {
  const canonical = {
    identity: { ...vector.identity, fullName: "Alice é" },
    rawPassphrase: "  Pa ssé  ",
  };
  const expected = getBytes(vector.independentKeyIdentitySecret);
  assert.deepEqual(
    await deriveShieldedIndependentKeyIdentitySecret({
      ...canonical,
      identitySuiteId: 99,
      identityCommitment: 123n,
      derivedSecretBytes: new Uint8Array(32),
      identityKdfProfile: { memoryKiB: 8 },
      chainId: 999,
      poolAddress: "other",
    }),
    expected,
  );
  for (const changed of [
    { ...canonical, identity: { ...canonical.identity, fullName: "Bob" } },
    { ...canonical, identity: { ...canonical.identity, birthDay: 30 } },
    { ...canonical, rawPassphrase: "  Pa ssé  x" },
  ]) {
    const secret = await deriveShieldedIndependentKeyIdentitySecret(changed);
    assert.notDeepEqual(secret, expected);
    assert.notEqual(
      (
        await deriveShieldedIndependentKeyMaterial({
          independentKeyRoot: vector.independentKeyRoot,
          independentKeyIdentitySecret: secret,
        })
      ).keyFingerprint,
      vector.keyFingerprint,
    );
  }
});

test("independent key keeps explicit frozen normalization/PRECIS implementations and data", () => {
  const source = readFileSync(new URL("../shielded-independent-key-identity.js", import.meta.url), "utf8");
  assert.match(source, /from "\.\/independent-key-precis\.js"/u);
  assert.match(source, /from "\.\/independent-key-unicode-normalization\.js"/u);
  assert.doesNotMatch(
    source,
    /from "\.\/(?:identity|canonical|precis|unicode-normalization)\.js"/u,
  );
  const normalization = readFileSync(
    new URL("../independent-key-unicode-normalization.js", import.meta.url),
    "utf8",
  );
  const precis = readFileSync(new URL("../independent-key-precis.js", import.meta.url), "utf8");
  assert.match(normalization, /from "\.\/independent-key-unicode-normalization-data\.js"/u);
  assert.match(precis, /from "\.\/independent-key-precis-data\.js"/u);
  assert.match(precis, /from "\.\/independent-key-unicode-normalization\.js"/u);
});
