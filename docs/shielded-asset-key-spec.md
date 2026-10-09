# Shielded asset keys and funds vault v1

This specification freezes the independent asset-root implementation in
[shielded-asset-keys.js](../packages/protocol-core/shielded-asset-keys.js) and
[shielded-asset-vault.js](../packages/protocol-core/shielded-asset-vault.js).
It describes the supported v1 encoding, rather than a migration format for older
wallets. Asset suite, branch derivation, root generation and vault versions are
all `1`; the associated pool protocol version is `3`.

## Slots and root sources

An unlocked asset session has an optional identity-derived slot (`keyMode = 0`)
and at most one independent funds slot (`keyMode = 1`, `assetRootDerived`). The
identity slot is reconstructed from the original complete identity credentials
and the frozen identity specification. It has no backup file or backup state.
The independent slot uses a 32-byte `assetRoot`, with one local `rootSource`:

- `random`: the default for an explicit new-slot action. Obtain exactly 32 bytes
  from Web Crypto `getRandomValues`. Require `intent: "create"`; missing roots,
  failed decryption, recovery and failed signatures never invoke creation.
- `walletSignature`: an explicit alternative, derived from the signature below.
  The application never reads a wallet seed or private key.

`rootSource` and signature provenance are local recovery metadata, not additional
receive-code, note or on-chain fields. Both sources use the same spend/view
branches and fingerprint. Changing a source label does not migrate funds,
replace an existing owner or inherit a verified recovery state.

## Exact signature-derived root

Let `S` be the selected nonzero EOA address. Encode it as lowercase `0x` followed
by 40 hexadecimal characters. Sign the following UTF-8 message, with LF line
separators, no BOM and **no final newline**:

```text
DeepFamily Asset Key v1
Account: <S>
Purpose: Create or restore the DeepFamily asset wallet
Keep this signature private. It controls the derived funds.
```

The method is `personal_sign` / EIP-191. The signed digest is Keccak-256 of
`0x19 || UTF8("Ethereum Signed Message:\n") || ASCII(decimal(messageBytes.length))
|| messageBytes`. The separate `messageHash` used below is **SHA-256 of the
message bytes**, not this EIP-191 digest.

Accept only a 65-byte signature `r[32] || s[32] || v[1]`, with the scalars encoded
as unsigned big-endian integers. Let the secp256k1 order be:

```text
n = 0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141
```

Require `0 < r,s < n`. Normalize `v = 0/1` to `27/28`; reject other values. If
`s > floor(n/2)`, replace it with `n - s` and flip `27 ↔ 28`. Recover the signer
of the exact EIP-191 message from this canonical signature and require it to
equal `S`. The canonical 65 bytes are the root KDF input. Compact 64-byte, DER,
ERC-1271 and other signing methods are unsupported in v1.

Define `HKDF32(IKM, domain, info)` as RFC 5869 HKDF-SHA-256 with:

```text
salt = SHA256(UTF8(domain))
PRK  = HMAC-SHA256(key = salt, data = IKM)
OKM  = HMAC-SHA256(key = PRK, data = info || 0x01)  // exactly 32 bytes
```

Then:

```text
messageHash = SHA256(messageBytes)
assetRoot = HKDF32(canonicalSignature,
                   "DeepFamily:WalletAssetRoot:v1",
                   messageHash[32] || rawAddressS[20])
```

Low-s normalization removes the equivalent high-s representation. It does not
make different valid nonce choices identical. A wallet, device or version change
can produce a different valid signature for the same message. Restoration must
check the original funds fingerprint; a signature file's source label alone
does not prove that its root can be reproduced by signing.

Retain only this signature metadata, never the raw signature:

```text
signerAddress, message, messageHash,
messageVersion = 1, signatureVersion = 1, rootKdfVersion = 1,
method = "personal_sign"
```

## Common spend/view branches and funds fingerprint

Both sources take the same exact 32-byte root. All integers below are unsigned.
The scalar field is:

```text
p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
```

For counters `c = 0, 1, …, 0xffffffff`, compute:

```text
candidate = uint256BE(HKDF32(assetRoot, "DeepFamily:AssetSpend:v1", uint32BE(c)))
```

The first `0 < candidate < p` is `ownerSecret`; do not reduce modulo `p` or mask
bits. Counter exhaustion fails. The existing owner commitment is
`Poseidon(1013, ownerSecret)`, as implemented by
[computeShieldedOwnerCommitment](../packages/protocol-core/shielded-inheritance.js).

```text
hpkeIkm = HKDF32(assetRoot, "DeepFamily:AssetView:v1", emptyBytes)
viewPublicKey = RFC9180.DHKEM(X25519, HKDF-SHA256).DeriveKeyPair(hpkeIkm).publicKey
```

Serialize the X25519 public key as the KEM's 32 raw public-key bytes, using
[shielded-hpke.js](../packages/protocol-core/shielded-hpke.js). `hpkeIkm` is input
to RFC 9180 derivation, not a directly imported X25519 private key.

The funds fingerprint is the following 32-byte SHA-256 digest:

```text
SHA256(UTF8("DeepFamily:AssetFingerprint:v1\0")
       || uint8(assetSuite = 1) || uint8(branchVersion = 1)
       || uint256BE(ownerCommitment)[32] || viewPublicKey[32])
```

The domain ends in one NUL byte; `\0` above denotes that byte, not two printable
characters. The fingerprint excludes root source, signer address, signing
versions, identity, chain and pool. Check source/KDF versions separately when
restoring. The receive-code fingerprint is distinct: its proved statement also
binds identity and key-mode/version fields; see
[shielded-receive-code.js](../packages/protocol-core/shielded-receive-code.js).
Note commitments and HPKE AAD provide chain/pool binding later.

## Funds vault payload

The vault contains only independent funds material. It excludes identity
secrets, original identity records/passphrases, identity-derived slot keys,
wallet seeds/private keys and raw signatures. Unknown schema fields are
rejected at the payload, signature-metadata and discovery-context levels.

The exporter writes UTF-8 `JSON.stringify` output without BOM or a trailing
newline. Its normalized object has this insertion order:

1. `assetRoot`: lowercase `0x` plus 64 hex digits.
2. `rootSource`: `"random"` or `"walletSignature"`.
3. `assetSuite`: number `1`.
4. `branchVersion`: number `1`.
5. `rootGenerationVersion`: number `1`.
6. `fundsFingerprint`: lowercase `0x` plus the 32-byte recomputed digest.
7. `signatureMetadata`: present only for `walletSignature`, in the field order
   listed in the signature section. Address/hash are lowercase hex; versions are
   JSON numbers. Random roots forbid this field.
8. `discovery`: an ordered array of 1–64 contexts.

Each normalized discovery object has this field order:

| Field | JSON encoding |
| --- | --- |
| `chainId` | Canonical decimal string, `1 ≤ chainId ≤ 2^64 - 1` |
| `factoryAddress` | Lowercase nonzero 20-byte address with `0x` |
| `factoryDeploymentBlock` | Nonnegative safe-integer JSON number |
| `lineageIndexAddress` | Lowercase nonzero 20-byte address with `0x` |
| `verifierAddress` | Lowercase nonzero 20-byte address with `0x` |
| `protocolVersion` | JSON number `3` |

Reject duplicate `chainId + factoryAddress` contexts. Preserve array order.
The decoder parses UTF-8 JSON and normalizes the supported schema; whitespace
and object-key ordering need not match exporter bytes. Missing payload suite,
branch and root-generation versions default to `1`; exports always include
them. Unsupported versions fail. Recompute keys and the funds fingerprint from
the actual root, check any payload fingerprint, then check any independently
supplied expected fingerprint. Signature metadata must match the exact v1
message/hash/method; it is provenance metadata, not a stored recovery approval.

## Funds vault binary encoding

All multibyte header integers are big-endian. The entire 51-byte header is AES
additional authenticated data, including its KDF parameters and payload length.

| Offset | Bytes | Value |
| --- | --- | --- |
| 0 | 8 | ASCII `DFAVLT01` (`44 46 41 56 4c 54 30 31`) |
| 8 | 1 | Vault version `1` |
| 9 | 1 | Argon2id profile `1` |
| 10 | 4 | Memory KiB `65536` |
| 14 | 4 | Iterations `3` |
| 18 | 1 | Parallelism `1` |
| 19 | 16 | Fresh random salt |
| 35 | 12 | Fresh random AES-GCM IV |
| 47 | 4 | Plaintext UTF-8 byte length `N` |
| 51 | `N` | AES-256-GCM ciphertext |
| `51 + N` | 16 | GCM authentication tag |

Require total file length `51 + N + 16 ≤ 65536`. Validate magic, exact supported
version/KDF profile/parameters and the length relation before running Argon2id.
There is no weaker-profile fallback. Every export uses a fresh salt and IV.

The unlock credential is independent of identity credentials. Strings are exact
UTF-8 bytes, with no trimming or identity normalization. The low-level codec
accepts 16–1024 credential bytes. The frontend requires a strong custom
credential or defaults to `0x` plus the hex encoding of 16 random bytes (128 bits
of entropy); preserve the credential separately from the encrypted file.

```text
password = UTF8("DeepFamily:VaultKDF:v1\0") || credentialBytes
KEK = Argon2id(version=0x13, password, salt[16], memoryKiB=65536, iterations=3,
               parallelism=1, outputBytes=32)
AES-256-GCM(key=KEK, iv=header[35:47], aad=header[0:51], tagBits=128)
```

The KDF domain ends in one NUL byte. Import authenticates before parsing the
payload, derives the actual root's key material and returns `verifiedPath:
"file"`. Import neither requests a wallet signature nor grants verified
re-signing capability. Wrong credentials, malformed files and mismatches fail
without installing a replacement root.

## Recovery gates and discovery

[ShieldedAssetSession](../frontend/src/workers/shieldedAssetSession.ts) holds
secrets inside one ephemeral Worker. New independent slots start unverified;
they cannot issue receive codes or prepare funds operations until the relevant
gate succeeds:

- **Random creation:** export the real encrypted root file, save it outside the
  device, destroy the original Worker, then import/decrypt it in a fresh Worker
  and match the original funds fingerprint. The UI requires acknowledgement of
  external storage. In-memory round trips and chain history do not satisfy this
  new-root gate.
- **Signature creation:** destroy the original Worker, actually sign the exact
  message again, derive through canonicalization and the frozen source KDF, and
  match the original fingerprint; alternatively use the external-file path.
  Repeatable signing in this check is not a lifetime or cross-device guarantee.
- **Existing signature restoration without an old fingerprint:** keep an
  unverified candidate. An empty scan is not recovery success. A validated,
  positive owned VALUE recovered from the selected canonical pool can confirm
  that candidate. This exception never verifies a newly created random root or
  an old file missing the selected discovery scope.

File import and signature restoration require an empty funds slot. A different
root/source cannot overwrite an unlocked slot; lock first. No recovery failure
automatically creates random funds, falls back to the identity slot or changes
the owner. The ordinary transaction/gas wallet `G` is separate from signature
source `S`; changing `G` does not change the funds root.

A root-only import can view and spend recovered VALUE without identity input.
Owner-bound BUDGETs remain pending identity confirmation and outside claimable
balances until the original identity is unlocked. Public identity-bound budgets
remain recoverable by the identity slot even if no independent root is present.

The root alone cannot reconstruct random note openings. Replay unfiltered
public chain history, including spent change notes and authentic Fund memos,
to recover notes, rules and the original funding templates. For every recorded
factory, enumerate all `PoolCreated` events from its deployment block and check
the pool count at a single block/hash anchor per chain. Later pools under the
same recorded factory require no new root file. A new chain/factory context
requires an updated file and independent import for the file recovery path.
An old valid file may load its root to export that update, but does not mark the
new context verified. Runtime RPC selection is not stored in the vault.

Enumeration completeness and each pool's history completeness are separate.
Validate pool/factory/lineage/verifier/version wiring; isolate pool failures and
report incomplete scopes. Token metadata failure preserves raw integer amounts
with unknown decimals rather than assuming 18 or blocking healthy pools. Root,
note, action and spent-nullifier checks must use the same anchor; v3 checks the
unique spent-nullifier count against the contract count. See
[shieldedAssetRegistry.ts](../frontend/src/domains/inheritance/services/shieldedAssetRegistry.ts),
[shieldedPoolChain.ts](../frontend/src/domains/inheritance/services/shieldedPoolChain.ts)
and [shieldedWalletRecovery.ts](../frontend/src/domains/inheritance/services/shieldedWalletRecovery.ts).

## Frozen vectors and boundary tests

For root `0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`:

| Output | Value |
| --- | --- |
| `ownerSecret` | `21163297713406726978733507212238736142897898906436691617414556311477803122818` |
| `ownerCommitment` | `16745082092878245220021372179056393625214528694427188481587298390944523844978` |
| `hpkeIkm` | `0x12274570ef1254e45db69544110535022727b6c15646eead2ff4a7603c4646af` |
| `viewPublicKey` | `0x1c383c23be2a8927f7835a83fdcb060b01acfff99661136c658f2d485e5bad56` |
| `fundsFingerprint` | `0xba9339b546645507471bedc1c78f017ec71d74de4dda220e376401883f02e027` |

[Key tests](../packages/protocol-core/test/shielded-asset-keys.test.js) freeze this
vector, compare signature-root derivation with Node's RFC 5869 implementation,
and check high-s/v normalization and rejected signatures.
[Vault tests](../packages/protocol-core/test/shielded-asset-vault.test.js) exercise
fresh randomized exports, tampering, bounded KDF profiles, schema exclusions and
restoration without the original signer.
[Session tests](../frontend/src/workers/shieldedAssetSession.test.ts) exercise the
real vault/key KDF, fresh-session gates, source/root replacement rejection,
root-only recovery and secret-free DTO/error boundaries.
