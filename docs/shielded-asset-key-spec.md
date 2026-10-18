# Shielded asset keys and recovery v1

This specification freezes the independent asset-root implementation in
[shielded-asset-keys.js](../packages/protocol-core/shielded-asset-keys.js) and
[shielded-asset-recovery.js](../packages/protocol-core/shielded-asset-recovery.js).
Recovery first unlocks a credentials session with the original person details and
identity passphrase, then restores a 24-word mnemonic, a Shielded Key, or a
reproducible signature from the original signing wallet. Backups encode the same
original root; they contain neither the identity details nor its passphrase.
The root alone cannot reconstruct the funds spending or viewing keys.
The frontend operation sequence and secret-session lifecycle are documented in
[Shielded family inheritance](frontend.md#shielded-family-inheritance).

## Current frontend entry points

The project has no released frontend contract to preserve. Callers use the
following current paths directly; retired entry points have no adapters,
aliases or alternate witness-generation flow.

| Responsibility | Current implementation and boundary |
| --- | --- |
| Unlock the holder's credentials | [`ShieldedAssetSession.unlockIdentity`](../frontend/src/workers/shieldedAssetSession.ts) retains identity and funds secrets in the asset Worker and returns public session handles. The form-to-crypto-Worker service that returned derived identity material to the page has been removed. |
| Generate the holder's receive code | The same asset session's `receiveCode({ slot })` uses its private identity and selected keys and returns only the code. The raw-identity-material service wrapper has been removed. Creating and verifying another recipient's code remains in [`shieldedReceiveCode.ts`](../frontend/src/domains/inheritance/services/shieldedReceiveCode.ts). |
| Read asset metadata | [`readShieldedAsset`](../frontend/src/domains/inheritance/services/shieldedAssetRegistry.ts) is the single reader for page selection, import and factory recovery. Every token read uses the selected block. Unknown precision is `null` and displays base units; failed metadata or interoperability calls do not discard a verified pool. `resolveShieldedAssetPool` independently checks the canonical factory mapping, asset, kind, protocol, lineage, verifier and creation block. The separate fail-closed metadata reader and recovered-asset type have been removed. |
| Prepare and prove an action | The asset session's `preview` binds the approved inputs, outputs and chain context; `prove` rejects changed family roots, expired snapshots and spent inputs. A stale plan requires a fresh preview and confirmation. The witness-callback submission service and its automatic lineage retry loop have been removed. |
| Supply spending material | Preparation and recovery require explicit `keyMaterial`; receive-code generation also requires an explicit `keyMode`. Raw-secret overloads and missing-key derivation fallbacks have been removed. Identity mode still validates its canonical keys; funds mode requires the original independent keys. |
| Submit a transaction | [`shieldedPoolFlows.ts`](../frontend/src/domains/inheritance/services/shieldedPoolFlows.ts) accepts the asset Worker's verified proof and public action data. After fee confirmation and nonce reads, it rechecks time-bound family roots and proof lifetime at one fixed block before requesting the wallet. It rejects private witnesses. The generic crypto Worker no longer exposes raw asset-proof or holder receive-code RPCs. |
| Replay current pool history | [`shieldedPoolChain.ts`](../frontend/src/domains/inheritance/services/shieldedPoolChain.ts) requires the current protocol version, event ABI, complete action output groups and nullifier count. Contracts or fixtures without these interfaces are rejected rather than scanned through a reduced path. |
| Select VALUE inputs | [`planShieldedValueSpend`](../packages/protocol-core/shielded-value-capacity.js) plans the permitted candidates and consolidation for the current one-input funding or eight-input spending circuits. The separate one/two-input selector has been removed. Active BUDGET claim selection remains in [`shieldedActionSelection.ts`](../frontend/src/domains/inheritance/services/shieldedActionSelection.ts). |

These removals do not retire `keyMode = 0` or `keyMode = 1`: both are current
authorization modes with different required credentials. The secret boundary and
plan guards are checked by the
[asset session tests](../frontend/src/workers/shieldedAssetSession.test.ts) and
[action tests](../frontend/src/workers/shieldedAssetActions.test.ts). Canonical pool
bindings, pinned metadata reads and hostile-token isolation are checked by the
[registry tests](../frontend/src/domains/inheritance/services/shieldedAssetRegistry.test.ts);
candidate limits, ownership and consolidation by the
[VALUE planner tests](../packages/protocol-core/test/shielded-value-capacity.test.js).

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
and at most one asset-root-derived slot (`keyMode = 1`, `assetRootDerived`). The
identity slot is reconstructed from the original complete identity credentials
and the frozen identity specification. It requires no backup.
The UI names these key modes **Identity credentials** and **Funds key**.
Deposit, payment, receive-code and budget-filter options share those
same labels. They remain selectable when a key is unavailable; only submission
requires that key to be ready. Processing or a pending transaction disables the
choices consistently. These display names preserve the existing derivation
mechanisms and protocol fields.

Budget funding uses these entry labels:

| UI entry | Existing authorization and visibility |
| --- | --- |
| **Public budget** | Identity-bound budget, `keyMode = 0`; identity commitments and budget terms are public. |
| **Private (identity credentials)** | Owner-bound encrypted budget, `keyMode = 0`; the original identity credentials reconstruct the spending and viewing keys. |
| **Private (funds key)** | Owner-bound encrypted budget, `keyMode = 1`; the asset root and funds-specific identity secret derive the spending and viewing keys. |

Both private entries use the same HPKE note encryption and select the recipient's
authorization mode. Users separately select **Deposit to** for new VALUE notes
and **Use balance from** for the payer's existing VALUE notes: **Identity credentials**
or **Funds key**. The deposit choice determines who can spend and recover the
new notes; it is not an encryption-algorithm choice. Each operation requires the
selected slot's available keys, including verified recovery and completed backup
for the funds slot. A missing or changed key invalidates prepared work and never
silently selects another owner. An independent deposit or payment choice is bound
to its funds fingerprint: restoring the same key preserves the choice, while a
different verified key must be explicitly selected again. The Worker may choose
an adequate subset and plan consolidation only within the user's selected owner,
pool and allowed note range; it does not automatically combine or transfer
balances across owners.
Receive-code type and budget claim filters do not change the deposit destination
or payer selection. A funds key controls its VALUE notes; budget claims also
require the original identity credentials and existing family, period and
enrollment eligibility.

The funds slot uses a 32-byte `assetRoot` and the current credentials session.
The separate **Funds key** wallet entry manages recovery, creation and backup.
Receive-code settings only choose the credential type and generate the code.
A claim whose
original funds key is missing offers unlocking that key; the claim action remains
disabled until recovery and keeps the same identity and eligibility checks.
New roots have one local `rootSource`:

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
automatically check any trusted original funds fingerprint, or retain an
unconfirmed candidate until valid funds history confirms it. Users do not save
or compare fingerprints. Source metadata alone does not prove that
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

## Frozen funds identity secret

The funds path has its own fixed credential encoding and Argon2id profile.
It does not use `identitySuiteId`, `identityCommitment`, `personHash`, identity
KDF defaults, `derivedSecretBytes`, `derivedSecretField`, or their HKDF branches.
A change in the active identity suite must not change an existing funds key.

Normalize the name with the frozen Unicode 17.0.0 NFKC rules and fixed
White_Space folding and trimming. Require 1–256 UTF-8 bytes. Freeze the
passphrase rules to Unicode 17.0.0 PRECIS FreeformClass, non-ASCII space mapping
and NFC; preserve case and leading/trailing spaces and reject blank passphrases.
The form passes raw inputs: the active identity suite cannot rewrite or reject
inputs before this funds path applies its own rules.

Encode the normalized person fields as follows, with unsigned big-endian integers:

```text
fundsIdentityBytes = uint16BE(nameUtf8.length) || nameUtf8
                 || uint8(gender) || uint8(isBirthBC)
                 || uint16BE(birthYear) || uint8(birthMonth) || uint8(birthDay)
fundsPasswordBytes = UTF8("DeepFamily:FundsIdentityPassword:v1")
                  || 0x00 || UTF8(normalizedPassphrase)
fundsSalt = first16(SHA256(UTF8("DeepFamily:FundsIdentitySalt:v1")
                         || 0x00 || fundsIdentityBytes))
fundsIdentitySecret = Argon2id(fundsPasswordBytes, fundsSalt,
                              FUNDS_ARGON2ID_PROFILE)
```

Require `gender: 0–255`, `birthYear: 0–65_535`, `birthMonth: 0–12`,
`birthDay: 0–31`, and a boolean `isBirthBC`. Identity proofs apply their own
validity constraints separately. The independent funds profile is Argon2id
version `0x13`, memory `65_536 KiB`, 3 iterations, parallelism 1, output 32 bytes,
salt 16 bytes, and empty additional secret/associated data. These values must
not follow identity defaults or adapt to devices. Run funds and identity KDFs
sequentially to avoid holding two Argon2 workspaces at once.

The profile is currently marked `candidate-awaiting-device-benchmark` and
`provisional: true`; the independent Android/iPhone performance matrix and
pre-release security review remain required before final production freezing.

Only the asset Worker's credentials-unlock path derives this secret. The Worker
atomically installs it with an independent public credentials handle and never
returns it through a DTO, general identity Worker, or React state. If identity
proof reconstruction is unavailable or fails, a successful funds credentials
session remains usable. Do not retain raw passphrases for later reconstruction.
Clear temporary password, salt and KDF buffers after use. Original credentials
leaking or being guessed affects both paths; leaking identity KDF output alone
does not directly reveal this independently derived secret.

## Common spend/view branches and funds fingerprint

Both sources and imported roots require the same exact 32-byte `assetRoot` and
32-byte `fundsIdentitySecret`, preserving leading zeros. The public API is
`deriveShieldedAssetKeyMaterial({ assetRoot, fundsIdentitySecret })`; missing or
invalid secrets fail without a root-only branch or old derivation fallback.
It accepts no active identity suite, commitment, chain, pool or source parameter.

```text
boundRoot = HKDF32(assetRoot[32] || fundsIdentitySecret[32],
                   "DeepFamily:IdentityBoundAssetRoot:v1", emptyBytes)
```

Use `boundRoot` for both existing branches. Wipe it and the concatenated IKM
when done; it is neither exported nor persisted. All integers below are unsigned.
The scalar field is:

```text
p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
```

For counters `c = 0, 1, …, 0xffffffff`, compute:

```text
candidate = uint256BE(HKDF32(boundRoot, "DeepFamily:AssetSpend:v1", uint32BE(c)))
```

The first `0 < candidate < p` is `ownerSecret`; do not reduce modulo `p` or mask
bits. Counter exhaustion fails. The owner commitment is
`Poseidon(1013, ownerSecret)`, as implemented by
[computeShieldedOwnerCommitment](../packages/protocol-core/shielded-inheritance.js).

```text
hpkeIkm = HKDF32(boundRoot, "DeepFamily:AssetView:v1", emptyBytes)
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
characters. The fingerprint encoding excludes root source, signer address, signing
versions, identity, chain and pool; its final owner and viewing key depend on
the funds identity secret and therefore on the original credentials. Check source/KDF versions separately when
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
restore this root. No extra mnemonic passphrase is supported. The original identity passphrase
does not enter this codec; it is required by the separate funds identity KDF
before the decoded root can reconstruct spending and viewing branches. A different decoding
rule would yield a different owner and would not recover the original funds.
The 24 words are DeepFamily funds recovery words, not the connected ordinary
wallet's recovery phrase. Both representations are sensitive: together with
the original person details and passphrase they reconstruct spending and viewing
keys. They do not replace those credentials.

Mnemonic and Shielded Key encode only the root. They contain no source,
signer metadata, identity, funds fingerprint, network, factory or RPC settings.
The funds normalization, encoding, Argon2id, HKDF and branch rules form one fixed
derivation, independent of the active identity-suite defaults. The project is
unreleased; this implementation has no derivation-version selector, old-backup
compatibility, or old derivation fallback. Rebuild old development data.

## Recovery API and verification

The asset Worker implements these calls in
[ShieldedAssetSession](../frontend/src/workers/shieldedAssetSession.ts):

| Call | Input | Result |
| --- | --- | --- |
| `exportRecoveryMaterial` | `format: "mnemonic" \| "shieldedKey"`, trusted protocol context | Secret `material`, `format`, `version: 1`, public `fundsFingerprint` |
| `importRecoveryMaterial` | `format`, secret `material`, current `expectedCredentialsHandle`, optional trusted `expectedFingerprint`, protocol context | Public session state; automatically verified against trusted evidence or retained as a candidate |
| `restoreSignature` | Signer address, exact-message signature, current `expectedCredentialsHandle`, optional trusted `expectedFingerprint`, protocol context | Public session state with confirmed or candidate funds |
| `createFunds` | Explicit root-source choice, current `expectedCredentialsHandle`, source-specific inputs, protocol context | New root requiring a material backup drill |
| `clearFunds` | None | Wipes the root and spend/view keys; retains credentials, funds identity secret and available identity proof material |
| `discover` | Trusted protocol context | Per-pool raw VALUE and BUDGET totals or unknown status, enumeration completeness, public session state |

Every funds installation and access requires the Worker's current credentials
session and funds-specific identity secret. The main thread cannot supply a
replacement secret. Imports require an empty funds slot. Check the expected
credentials handle before derivation and again before installation so a late
result cannot enter another credentials session. Compare any trusted original
fingerprint automatically before installation; never ask users to save or enter
one. Failure creates no replacement root and never falls back to the identity
slot. Full locking or replacing credentials clears both identity paths, roots,
caches and prepared work; `clearFunds` preserves both identity paths.

| State | Allowed transition |
| --- | --- |
| New random or signature root | Mark `backupRequired`. Export and independently save words or Key, clear funds and displayed material, then manually re-import under the retained credentials session. The application automatically matches its original fingerprint before opening funds operations. Re-signing cannot complete the drill. |
| Existing root with trusted original fingerprint | Import or re-sign under the original credentials, derive the funds key, and automatically require the fingerprint to match without overwriting the original evidence. |
| Words, Key or re-signing without trusted original evidence | Keep an unconfirmed candidate and allow scanning. A verified scan may confirm positive unspent VALUE under that owner, or a positive unspent mode-1 BUDGET under that owner and the unlocked original identity. |
| Empty scan, only zero/spent notes, or unverified pools | Remain unconfirmed; do not report a verified original wallet with zero balance. Other slots, public budgets and public person information cannot confirm the candidate. |
| Re-signed root matching a retained pending new-wallet fingerprint | Permit re-export to resume the material drill but retain `backupRequired`; signing or funds history does not replace the saved-material import. |

Pending backup drills can resume after full locking or a same-tab reload.
[The Worker client](../frontend/src/shared/workers/shieldedAssetWorkerClient.ts)
retains only the application's trusted pending new-wallet fingerprints in
`sessionStorage` (or memory if storage is unavailable), then internally attaches
them as `pendingBackupFingerprints` to material-import and signature-restore
requests. This is public local challenge evidence, not a saved root, passphrase,
credentials handle, or user-entered fingerprint.

After unlocking the original credentials again, manually importing the saved
words or Key re-derives the funds fingerprint. An exact pending-challenge match
completes the material drill even if that new wallet has no funds history yet;
the client removes only the matching completed challenge. A matching re-sign
instead restores `backupRequired` and the ability to re-export and resume the
drill; it does not complete the independent backup requirement. Wrong
credentials or material cannot consume an unmatched challenge or turn its
derived candidate into confirmed funds. Full locking also clears the panel's
in-memory evidence and backup acknowledgement, so earlier UI state cannot
validate a different credentials session. On another device, or after the tab's
challenge is gone, recovery without other trusted evidence remains a candidate
and requires valid historical confirmation.

Confirmation verifies decryption, owner, note commitment and the scan anchor.
A valid mnemonic checksum or a valid wallet signature proves only valid input,
not original-wallet recovery. Unknown candidates cannot receive, spend, or
export official backups. Partial pool recovery remains visibly incomplete.
Public backup workflow markers contain no secrets and cannot prove where users
saved backups; see [the frontend guide](frontend.md#funds-keys-backup-and-recovery).

The original person details, original passphrase, and original root or
reproducible signing result are jointly needed to reconstruct matching VALUE
keys. An available funds credentials session can recover and use VALUE even if
the active identity proof suite is unavailable or the current chain has no
person record. BUDGET claims and identity-authorized receive codes still need
their original identity specification, commitment and eligibility. The client
KDF relationship is not verified by the circuits: final spending secrets and
note openings authorize VALUE independently of this client recovery workflow.
The identity-derived slot retains its existing identity derivation and needs no
funds-root backup.

The root does not encode random note openings. Recovery also needs the public
chain ciphertexts and history, using trusted application configuration for the
current chain and factory. It does not automatically traverse other chain or
factory scopes. See [frontend discovery](frontend.md#pool-recovery-and-transactions)
and [historical recovery](../frontend/src/domains/inheritance/services/shieldedWalletRecovery.ts).

## Frozen vectors and boundary tests

The full funds vector freezes person normalization/encoding, password bytes,
salt, independent Argon2id output, bound root, owner secret/commitment, HPKE IKM,
viewing public key and funds fingerprint. See
[funds identity vectors](../packages/protocol-core/test/shielded-funds-identity.test.js)
([synthetic fixture](../packages/protocol-core/test/shielded-funds.fixture.js))
and [funds key tests](../packages/protocol-core/test/shielded-asset-keys.test.js) and
[credentials/session tests](../frontend/src/workers/shieldedAssetSession.test.ts).
Tests compare independent Argon2id and RFC 5869 implementations and require the
same credentials/root to keep the same funds keys when identity defaults,
commitments, root source, chain or pool change.

The frozen vector uses raw name `"  \uFF21lice\u00A0e\u0301  "`, gender 255,
year 65535, month 12, day 31, `isBirthBC: true`, raw passphrase
`"  Pa\u00A0sse\u0301  "`, and the root below. The normalized name is `Alice é`
and normalized passphrase is `"  Pa ssé  "` (two spaces at either end).

| Output | Value |
| --- | --- |
| `fundsIdentityBytes` | `0x0008416c69636520c3a9ff01ffff0c1f` |
| `fundsPasswordBytes` | `0x4465657046616d696c793a46756e64734964656e7469747950617373776f72643a76310020205061207373c3a92020` |
| `fundsSalt` | `0x2ee93be1b4b72cad7ac4e7bba0f03971` |
| `fundsIdentitySecret` | `0xa835452d2b036a74fb0bfa73d7e10e3c516b1ec59760fac283f33d69b6fd4f43` |
| `boundRoot` | `0x32bd9786950f1768fe0d6422a1c8d491e59fcdb706960a355659b6665277172b` |
| `ownerSecret` | `10427067817047264739375061634765270854070477586908251981454477667657234876144` |
| `ownerCommitment` | `13257167545851383886859378700073274345156193578009534038394940180468538553429` |
| `hpkeIkm` | `0x18ced215e851625532292ece63e834c0a17a5ff102cc8218b17a3a101aee2004` |
| `viewPublicKey` | `0x6414dcbbf49f55a1b4e81ee7243833b1f8436cddbf20acf5e704d14d698cf251` |
| `fundsFingerprint` | `0xbfd67d827c92d7eedd88c3eac9ba9467c91d70eba41520073364b1af9afa7626` |

The root `0x000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f`
still encodes these same 24 words; root representation does not depend on the
identity binding:

```text
abandon amount liar amount expire adjust cage candy arch gather drum bullet absurd math era live bid rhythm alien crouch range attend journey unaware
```

[Recovery-codec tests](../packages/protocol-core/test/shielded-asset-recovery.test.js)
check official 256-bit English BIP39 vectors, exact root/word/hex round trips,
checksum/length rejection and leading zeros. Protocol tests also cover
signature-root HKDF, high-s/v normalization and rejected signatures. Worker and
frontend checks cover missing/stale credentials handles, identity-proof failure
with usable funds credentials, source/root replacement rejection, fresh-session
candidate confirmation, actual backup-drill clearing, signature handoff and
secret-free DTO/error boundaries. Check results belong in the implementation
record after the corresponding commands have completed.
