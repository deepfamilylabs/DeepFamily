import assert from "node:assert/strict";
import { hkdfSync } from "node:crypto";
import { test } from "node:test";
import { Wallet, getBytes, hexlify, sha256, toBeHex, toUtf8Bytes } from "ethers";
import {
  buildShieldedAssetSigningMessage,
  createShieldedAssetRoot,
  deriveShieldedAssetKeyMaterial,
  deriveShieldedAssetRootFromSignature,
  normalizeShieldedAssetSignature,
} from "../shielded-asset-keys.js";

const wallet = new Wallet(`0x${"11".repeat(32)}`);
const order = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141n;

test("new random roots require explicit creation; recovery has no entropy fallback", () => {
  assert.throws(() => createShieldedAssetRoot(), { code: "EXPLICIT_ASSET_CREATION_REQUIRED" });
  assert.throws(() => createShieldedAssetRoot({ intent: "restore" }), {
    code: "EXPLICIT_ASSET_CREATION_REQUIRED",
  });
  assert.throws(
    () => createShieldedAssetRoot({ intent: "create", rootSource: "walletSignature" }),
    { code: "INVALID_ASSET_ROOT_SOURCE" },
  );
  const a = createShieldedAssetRoot({ intent: "create" });
  const b = createShieldedAssetRoot({ intent: "create" });
  assert.equal(a.length, 32);
  assert.notDeepEqual(a, b);
});

test("exact EIP-191 message and canonical low-s signature derive the RFC5869 root", async () => {
  const message = buildShieldedAssetSigningMessage(wallet.address);
  assert.equal(
    message,
    `DeepFamily Asset Key v1\nAccount: ${wallet.address.toLowerCase()}\nPurpose: Create or restore the DeepFamily asset wallet\nKeep this signature private. It controls the derived funds.`,
  );
  const signature = await wallet.signMessage(message);
  const canonical = normalizeShieldedAssetSignature({ signerAddress: wallet.address, signature });
  const lowV = canonical.slice();
  lowV[64] -= 27;
  const highS = getBytes(
    `0x${hexlify(canonical.subarray(0, 32)).slice(2)}${toBeHex(order - BigInt(hexlify(canonical.subarray(32, 64))), 32).slice(2)}${(canonical[64] === 27 ? 28 : 27).toString(16)}`,
  );
  assert.deepEqual(
    normalizeShieldedAssetSignature({ signerAddress: wallet.address, signature: lowV }),
    canonical,
  );
  assert.deepEqual(
    normalizeShieldedAssetSignature({ signerAddress: wallet.address, signature: highS }),
    canonical,
  );
  const derived = await deriveShieldedAssetRootFromSignature({
    signerAddress: wallet.address,
    signature: highS,
  });
  const salt = getBytes(sha256(toUtf8Bytes("DeepFamily:WalletAssetRoot:v1")));
  const info = Buffer.concat([
    Buffer.from(getBytes(sha256(toUtf8Bytes(message)))),
    Buffer.from(getBytes(wallet.address)),
  ]);
  assert.deepEqual(
    derived.assetRoot,
    new Uint8Array(hkdfSync("sha256", canonical, salt, info, 32)),
  );
  assert.equal(derived.sourceMetadata.messageHash, sha256(toUtf8Bytes(message)));
  assert.equal("signature" in derived.sourceMetadata, false);
  assert.deepEqual(
    (await deriveShieldedAssetRootFromSignature({ signerAddress: wallet.address, signature }))
      .assetRoot,
    derived.assetRoot,
  );
});

test("signature input rejects compact, wrong message, wrong signer and invalid v/scalars", async () => {
  const signature = await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address));
  assert.throws(
    () =>
      normalizeShieldedAssetSignature({
        signerAddress: wallet.address,
        signature: getBytes(signature).slice(0, 64),
      }),
    { code: "INVALID_ASSET_SIGNATURE" },
  );
  const invalid = getBytes(signature);
  invalid[64] = 29;
  assert.throws(
    () => normalizeShieldedAssetSignature({ signerAddress: wallet.address, signature: invalid }),
    { code: "INVALID_ASSET_SIGNATURE" },
  );
  assert.throws(
    () =>
      normalizeShieldedAssetSignature({
        signerAddress: wallet.address,
        signature: new Uint8Array(65),
      }),
    { code: "INVALID_ASSET_SIGNATURE" },
  );
  const wrongMessage = await wallet.signMessage(
    `${buildShieldedAssetSigningMessage(wallet.address)}\n`,
  );
  assert.throws(
    () =>
      normalizeShieldedAssetSignature({ signerAddress: wallet.address, signature: wrongMessage }),
    { code: "ASSET_SIGNATURE_SIGNER_MISMATCH" },
  );
  assert.throws(
    () =>
      normalizeShieldedAssetSignature({
        signerAddress: new Wallet(`0x${"22".repeat(32)}`).address,
        signature,
      }),
    { code: "ASSET_SIGNATURE_SIGNER_MISMATCH" },
  );
});

test("common branches and funds fingerprint depend only on the root and branch suite", async () => {
  const root = Uint8Array.from({ length: 32 }, (_, i) => i);
  const first = await deriveShieldedAssetKeyMaterial(root);
  const second = await deriveShieldedAssetKeyMaterial(root);
  assert.deepEqual(first, second);
  // Frozen branch-v1 fixture for independent implementations and future releases.
  assert.equal(
    first.ownerSecret,
    21163297713406726978733507212238736142897898906436691617414556311477803122818n,
  );
  assert.equal(
    first.ownerCommitment,
    16745082092878245220021372179056393625214528694427188481587298390944523844978n,
  );
  assert.equal(first.hpkeIkm, "0x12274570ef1254e45db69544110535022727b6c15646eead2ff4a7603c4646af");
  assert.equal(
    hexlify(first.viewPublicKey),
    "0x1c383c23be2a8927f7835a83fdcb060b01acfff99661136c658f2d485e5bad56",
  );
  assert.equal(
    first.fundsFingerprint,
    "0xba9339b546645507471bedc1c78f017ec71d74de4dda220e376401883f02e027",
  );
  assert.equal(first.keyMode, 1);
  assert.equal(first.viewPublicKey.length, 32);
  assert.notEqual(first.hpkeIkm, hexlify(root));
  assert.deepEqual(
    root,
    Uint8Array.from({ length: 32 }, (_, i) => i),
  );
  const changed = root.slice();
  changed[0] ^= 1;
  assert.notEqual(
    (await deriveShieldedAssetKeyMaterial(changed)).fundsFingerprint,
    first.fundsFingerprint,
  );
  await assert.rejects(deriveShieldedAssetKeyMaterial(new Uint8Array(31)), {
    code: "INVALID_ASSET_ROOT",
  });
});
