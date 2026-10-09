# Shielded asset keys and recovery v1

This specification freezes the independent asset-root implementation in
[shielded-asset-keys.js](../packages/protocol-core/shielded-asset-keys.js) and
[shielded-asset-recovery.js](../packages/protocol-core/shielded-asset-recovery.js).
Recovery uses a 24-word mnemonic, a Shielded Key, or the original signing wallet.
Backups use the mnemonic or Shielded Key representation of the same root.
The frontend operation sequence and secret-session lifecycle are documented in
[Shielded family inheritance](frontend.md#shielded-family-inheritance).

## Protocol and encoding versions

| Format | Version | Definition |
| --- | --- | --- |
| Asset suite, branch derivation and root generation | `1` | [Asset keys](../packages/protocol-core/shielded-asset-keys.js) |
| Pool protocol | `1` | [Shielded inheritance](../packages/protocol-core/shielded-inheritance.js) |
| Note payload | `1` | [Note codec](../packages/protocol-core/shielded-note-codec.js) |
| Receive code | `1` | [Receive code codec](../packages/protocol-core/shielded-receive-code.js) |
| HPKE envelope | `1` | [HPKE codec](../packages/protocol-core/shielded-hpke.js) |

Version fields and domain-separation strings are separate constants. For example,
the HPKE AAD domain is `DeepFamily:ShieldedNoteHPKE:v2` and the receive-code
fingerprint domain is `DeepFamily:ReceiveCodeFingerprint:v2`. Their literal bytes
remain as defined in the code; the `v2` suffix is not a declaration that either
encoded format has version 2.

## Slots and root sources

An unlocked asset session has an optional identity-derived slot (`keyMode = 0`)
and at most one independent funds slot (`keyMode = 1`, `assetRootDerived`). The
identity slot is reconstructed from the original complete identity credentials
and the frozen identity specification. It requires no backup.
The independent slot uses a 32-byte `assetRoot`. New roots have one local
`rootSource`:

- `random`: the default for an explicit new-slot action. Obtain exactly 32 bytes
  from Web Crypto `getRandomValues`. Require `intent: "create"`; missing roots,
  failed recovery and failed signatures never invoke creation.
- `walletSignature`: an explicit alternative, derived from the signature below.
  The application never reads a wallet seed or private key.

An imported mnemonic or Shielded Key contains only the root, not its provenance.
Record its source as `imported`; do not infer `random` or `walletSignature`, or
invent signer metadata. Importing a root which was originally signature-derived
does not itself prove that a particular wallet can reproduce it.

`rootSource` and signature provenance are local recovery metadata, not additional
receive-code, note or on-chain fields. Both sources use the same spend/view
branches and fingerprint. Changing a source label does not change the owner or
inherit a verified recovery state.

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
check the original funds fingerprint. Source metadata alone does not prove that
the root can be reproduced by signing.

Signature restoration is available only for roots originally derived by this
signature method. Signing cannot restore a randomly generated root. A successful
re-sign check is a convenience check, not a substitute for an independently
saved mnemonic or Shielded Key for a newly created funds slot.

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
bits. Counter exhaustion fails. The owner commitment is
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

## Shielded Key and 24-word mnemonic

**Shielded Key means the complete 32-byte `assetRoot`**, not the ordinary
Ethereum-wallet private key, the field-valued `ownerSecret`, or the viewing
branch. Its canonical text form is lowercase `0x` followed by 64 hexadecimal
digits. The application labels it a DeepFamily Shielded Key (funds master key).
Both random and signature-derived roots use this same encoding.

The recovery mnemonic encodes those same 32 bytes using the English wordlist
and entropy/checksum algorithm in [BIP39](https://github.com/bitcoin/bips/blob/master/bip-0039.mediawiki):

```text
entropy = assetRoot[32]                          // 256 bits
checksum = first 8 bits of SHA256(entropy)
indices = split(entropy || checksum, 24 groups of 11 bits)
mnemonic = EnglishWordlist[indices], separated by single spaces
```

Import requires exactly 24 supported English words and a valid checksum. Accept
at most 1024 ASCII characters; normalize ASCII case and space/tab/LF/VT/FF/CR
separators, and reject other characters rather than silently changing them. Decode
their 264 bits, validate the final eight checksum bits, and return the original
32 entropy bytes as `assetRoot`. The mnemonic and Shielded Key are reversible
representations of the same secret, not two unrelated wallets.

`encodeShieldedAssetMnemonic` / `decodeShieldedAssetMnemonic` implement that
word encoding. `encodeShieldedAssetKey` / `decodeShieldedAssetKey` implement the
hex representation. Key import requires exactly 66 characters with lowercase
`0x` prefix and 64 case-insensitive hexadecimal digits; it does not trim input.
All four functions operate on exactly 32 root bytes, preserve leading zeros,
and do not apply private-scalar rejection or modulo reduction to the root.

Do **not** call BIP39 `computeSeed`, PBKDF2, BIP32, or `Wallet.fromMnemonic` to
restore this root. No mnemonic passphrase is supported, and identity passphrases
do not enter this codec or the independent key branches. A different decoding
rule would yield a different owner and would not recover the original funds.
The 24 words are DeepFamily funds recovery words, not the connected ordinary
wallet's recovery phrase. Anyone with either complete representation can derive
both spending and viewing keys.

Mnemonic and Shielded Key encode only the root. They contain no source,
signer metadata, identity, funds fingerprint, network, factory or RPC settings.
The key suite and branch rules for this recovery format are fixed to v1.

## Recovery API and verification

The asset Worker implements these calls in
[ShieldedAssetSession](../frontend/src/workers/shieldedAssetSession.ts):

| Call | Input | Result |
| --- | --- | --- |
| `exportRecoveryMaterial` | `format: "mnemonic" \| "shieldedKey"`, trusted protocol context | Secret `material`, `format`, `version: 1`, public `fundsFingerprint` |
| `importRecoveryMaterial` | `format`, secret `material`, optional independently known `expectedFingerprint`, trusted protocol context | Public session state; verified import records path `mnemonic` or `shieldedKey` |
| `restoreSignature` | Signer address, exact-message signature, optional independently known `expectedFingerprint`, trusted protocol context | Public session state; verified re-sign records path `signature` |

Imports require an empty funds slot. Compare any supplied original fingerprint
against the root's recomputed fingerprint before installing it. No recovery
failure creates another root, falls back to the identity slot or changes the
funds owner. An unlocked root/source cannot be silently replaced.

| State | Allowed transition |
| --- | --- |
| New random or signature-derived root | Mark `backupRequired`. Export words or Key, destroy the original Worker, then manually import the independently saved material in a fresh Worker and match the original fingerprint. Only this material import completes its backup drill. |
| Existing root with an independently known original fingerprint | Import the material or re-sign, derive the root and require that fingerprint to match. |
| Existing root without an original fingerprint | Keep an unverified candidate. A complete selected-pool scan may confirm it only through valid, positive, unspent VALUE under that exact owner. |
| Reopened root matching a retained new-wallet pending fingerprint | Permit recovery-material re-export to resume the drill; keep `backupRequired`. Re-signing and historical notes cannot complete the pending drill. |

A valid mnemonic checksum, an empty scan, zero-value or already-spent VALUE, and
BUDGET records alone do not confirm a candidate. Unknown unverified candidates
cannot export official backups or public recovery descriptions. Client backup
markers are local workflow guards, not additional cryptographic authorization;
[the frontend guide](frontend.md#funds-keys-backup-and-recovery) specifies their
`sessionStorage` and lifecycle boundaries.

A verified root-only session can decrypt and spend its matching VALUE. Claiming
an independent BUDGET additionally requires the original complete identity
credentials and the existing family, period and enrollment eligibility. The
identity slot is reconstructed from those credentials and needs no backup.

The root does not encode random note openings. Recovery also needs the public
chain ciphertexts and history, using trusted application configuration for the
current chain and factory. It does not automatically traverse other chain or
factory scopes. See [frontend discovery](frontend.md#pool-recovery-and-transactions)
and [historical recovery](../frontend/src/domains/inheritance/services/shieldedWalletRecovery.ts).

## Frozen vectors and boundary tests

For root `0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`:

| Output | Value |
| --- | --- |
| `ownerSecret` | `21163297713406726978733507212238736142897898906436691617414556311477803122818` |
| `ownerCommitment` | `16745082092878245220021372179056393625214528694427188481587298390944523844978` |
| `hpkeIkm` | `0x12274570ef1254e45db69544110535022727b6c15646eead2ff4a7603c4646af` |
| `viewPublicKey` | `0x1c383c23be2a8927f7835a83fdcb060b01acfff99661136c658f2d485e5bad56` |
| `fundsFingerprint` | `0xba9339b546645507471bedc1c78f017ec71d74de4dda220e376401883f02e027` |

The same root's 24 recovery words are:

```text
abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware
```

[Key tests](../packages/protocol-core/test/shielded-asset-keys.test.js) freeze this
vector, compare signature-root derivation with Node's RFC 5869 implementation,
and check high-s/v normalization and rejected signatures.
[Recovery-codec tests](../packages/protocol-core/test/shielded-asset-recovery.test.js)
check official 256-bit English BIP39 vectors, exact root/word/hex round trips,
checksum and length rejection, and preservation of the existing funds
fingerprint.
[Session tests](../frontend/src/workers/shieldedAssetSession.test.ts) exercise the
key derivation, fresh-session gates, source/root replacement rejection,
root-only recovery and secret-free DTO/error boundaries.
