import assert from "node:assert/strict";
import { test } from "node:test";
import { Wallet } from "ethers";
import {
  buildShieldedAssetSigningMessage,
  deriveShieldedAssetKeyMaterial,
  deriveShieldedAssetRootFromSignature,
} from "../shielded-asset-keys.js";
import {
  decryptShieldedAssetVault,
  encryptShieldedAssetVault,
  generateShieldedVaultUnlockCredential,
} from "../shielded-asset-vault.js";

const discovery = [
  {
    chainId: 31337n,
    factoryAddress: `0x${"12".repeat(20)}`,
    factoryDeploymentBlock: 8,
    lineageIndexAddress: `0x${"34".repeat(20)}`,
    verifierAddress: `0x${"56".repeat(20)}`,
    protocolVersion: 3,
  },
];
const assetRoot = Uint8Array.from({ length: 32 }, (_, i) => i);
const unlockCredential = "a strong separate vault credential";

test("random vault fresh export/import preserves root, discovery and source-independent fingerprint", async () => {
  const keys = await deriveShieldedAssetKeyMaterial(assetRoot);
  const file = await encryptShieldedAssetVault({
    assetRoot,
    rootSource: "random",
    discovery,
    unlockCredential,
  });
  const again = await encryptShieldedAssetVault({
    assetRoot,
    rootSource: "random",
    discovery,
    unlockCredential,
  });
  assert.notDeepEqual(file, again);
  const restored = await decryptShieldedAssetVault({
    file,
    unlockCredential,
    expectedFingerprint: keys.fundsFingerprint,
  });
  assert.deepEqual(restored.assetRoot, assetRoot);
  assert.deepEqual(restored.keyMaterial, keys);
  assert.equal(restored.verifiedPath, "file");
  assert.equal(restored.rootSource, "random");
  assert.equal(restored.discovery[0].chainId, "31337");
  assert.equal("identitySecret" in restored, false);
  assert.equal("signatureMetadata" in restored, false);
  assert.equal(generateShieldedVaultUnlockCredential().length, 34);
});

test("vault authenticates header and body and rejects unsupported KDF before deriving", async () => {
  const file = await encryptShieldedAssetVault({
    assetRoot,
    rootSource: "random",
    discovery,
    unlockCredential,
  });
  const unsupported = file.slice();
  unsupported[10] ^= 1;
  await assert.rejects(decryptShieldedAssetVault({ file: unsupported, unlockCredential: "" }), {
    code: "UNSUPPORTED_ASSET_VAULT_VERSION",
  });
  const changed = file.slice();
  changed[changed.length - 1] ^= 1;
  await assert.rejects(decryptShieldedAssetVault({ file: changed, unlockCredential }), {
    code: "ASSET_VAULT_DECRYPTION_FAILED",
  });
  await assert.rejects(
    decryptShieldedAssetVault({ file, unlockCredential: "wrong but long credential" }),
    { code: "ASSET_VAULT_DECRYPTION_FAILED" },
  );
  await assert.rejects(
    decryptShieldedAssetVault({
      file,
      unlockCredential,
      expectedFingerprint: `0x${"ff".repeat(32)}`,
    }),
    { code: "ASSET_FINGERPRINT_MISMATCH" },
  );
});

test("identity material and signature provenance cannot be smuggled into random vaults", async () => {
  await assert.rejects(
    encryptShieldedAssetVault({
      assetRoot,
      rootSource: "random",
      discovery,
      unlockCredential,
      identitySecret: 123n,
    }),
    { code: "INVALID_ASSET_VAULT" },
  );
  await assert.rejects(
    encryptShieldedAssetVault({
      assetRoot,
      rootSource: "random",
      discovery,
      unlockCredential,
      signatureMetadata: {},
    }),
    { code: "INVALID_ASSET_VAULT" },
  );
  await assert.rejects(
    encryptShieldedAssetVault({
      assetRoot,
      rootSource: "random",
      discovery: [{ ...discovery[0], identityPassphrase: "secret" }],
      unlockCredential,
    }),
    { code: "INVALID_ASSET_VAULT" },
  );
});

test("signature root file works without the signer and does not grant resign verification", async () => {
  const wallet = new Wallet(`0x${"11".repeat(32)}`);
  const signature = await wallet.signMessage(buildShieldedAssetSigningMessage(wallet.address));
  const generated = await deriveShieldedAssetRootFromSignature({
    signerAddress: wallet.address,
    signature,
  });
  const file = await encryptShieldedAssetVault({
    assetRoot: generated.assetRoot,
    rootSource: "walletSignature",
    signatureMetadata: generated.sourceMetadata,
    discovery,
    unlockCredential,
  });
  const restored = await decryptShieldedAssetVault({ file, unlockCredential });
  assert.deepEqual(restored.assetRoot, generated.assetRoot);
  assert.equal(restored.verifiedPath, "file");
  assert.equal("signature" in restored.signatureMetadata, false);
  await assert.rejects(
    encryptShieldedAssetVault({
      assetRoot: generated.assetRoot,
      rootSource: "walletSignature",
      signatureMetadata: { ...generated.sourceMetadata, message: "changed" },
      discovery,
      unlockCredential,
    }),
    { code: "INVALID_ASSET_VAULT" },
  );
});
