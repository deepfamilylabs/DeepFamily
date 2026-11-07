# Diversified receive encryption, version 1

This document specifies the ordinary receive encryption used by `dfrecv` codes,
private-transfer VALUE notes and private letters. It fixes the bytes processed by
`packages/protocol-core/shielded-receive-encryption.js` and the additional checks
required before the application accepts a recovered record. Budgets, self outputs
and donor backup memos use their separate X25519 HPKE suite.

The construction uses a diversified Diffie–Hellman base, HKDF-SHA256 and
AES-256-GCM. It is an application protocol, not RFC 9180 HPKE or an implementation
of the complete Zcash note-encryption protocol. The analysis below records its
assumptions and remaining proof obligations; it is not a formal security proof or
an independent cryptographic audit.

## Encodings and constants

`||` means byte concatenation. `UTF8(s)` encodes the literal text without a BOM,
terminating zero byte or newline. `LEOS2IP` interprets bytes as an unsigned
little-endian integer. `I2OSP_BE(n, k)` encodes an unsigned integer in exactly `k`
big-endian bytes and rejects overflow. Seeds and diversifiers are exactly 32
bytes. Scalars are reduced modulo the Ristretto255 order

```text
L = 2^252 + 27742317777372353535851937790883648493.
```

Ristretto elements use the canonical 32-byte encoding of RFC 9496. Decode must
reject malformed or noncanonical encodings. The identity element is rejected for
address points, diversified bases and ciphertext ephemeral points.

Every domain below is the exact UTF-8 string shown:

| Name              | Bytes before UTF-8 encoding                                            |
| ----------------- | ---------------------------------------------------------------------- |
| `ViewDomain`      | `DeepFamily:ReceiveViewScalar:v1`                                      |
| `EphemeralDomain` | `DeepFamily:ReceiveEphemeralScalar:v1`                                 |
| `DST`             | `DeepFamily:ReceiveBase:ristretto255_XMD:SHA-512_R255MAP_RO_:v1`       |
| `KdfDomain`       | `DeepFamily:ReceiveEncryption:ristretto255:HKDF-SHA256:AES-256-GCM:v1` |
| `KeyLabel`        | `DeepFamily:ReceiveEncryption:Key:v1`                                  |
| `NonceLabel`      | `DeepFamily:ReceiveEncryption:Nonce:v1`                                |
| `AddressDomain`   | `DeepFamily:ReceivePublicKeyCommitment:v1`                             |
| `NoteInfo`        | `DeepFamily:ReceiveNote:v1`                                            |
| `LetterInfo`      | `DeepFamily:PrivateLetterHPKE:v1`                                      |

The retained `HPKE` text in letter and note scope labels is a fixed application
domain string. It does not select the RFC 9180 algorithm for ordinary receives.

## Scalar and address derivation

For either scalar domain and a 32-byte seed, define:

```text
Scalar(domain, seed):
    for counter = 0, 1, ..., 255:
        wide = SHA-512(UTF8(domain) || seed || byte(counter))
        s = LEOS2IP(wide) mod L
        if s != 0: return s
    fail
```

There is no scalar clamping. The 512-bit reduction has negligible statistical
bias. The zero retry counter is one byte, and starts at zero for every call.

`viewIkm` is the original viewing input deterministically derived by the selected
wallet key mode. It is not the serialized X25519 private key. Let
`v = Scalar(ViewDomain, viewIkm)`. Generate a fresh uniformly random 32-byte `d`
with the platform CSPRNG unless an explicit diversifier is supplied for address
reconstruction. Compute:

```text
G_d = hash_to_ristretto255(d, DST)
P_d = v * G_d
address = d || Encode(P_d)
```

`hash_to_ristretto255` is RFC 9380 Appendix B: first
`expand_message_xmd(d, DST, 64)` with SHA-512, then the RFC 9496 64-byte element
derivation map. Calling that map directly on `d` or on `SHA-512(d)` is a different
protocol. If `G_d` is the identity, fail rather than substitute another base.

Address validation checks the 64-byte length, the base and the canonical nonzero
point. It does not prove knowledge of `v` or establish that the chosen point came
from a particular backup. The credential proof authenticates the identity's
chosen address; deterministic backup recovery relies on the honest address
generator following the derivation above.

The address also diversifies ordinary receive ownership. Let `Fr` be the BN254
scalar field modulus, and use the complete-address digest already bound by the
credential's two viewing-key limbs:

```text
digest = SHA-256(UTF8(AddressDomain) || address)
ownerNonce = OS2IP_BE(digest) mod Fr
owner = Poseidon3(1013, ownerSecret, ownerNonce)
```

Reject a zero `ownerNonce`. The original root `ownerSecret` stays unchanged; each
fresh address changes its authenticated nonce and owner commitment. This is the
ordinary credential's owner relation, not a new per-code spending secret. Fund
credentials and BUDGET notes retain `Poseidon2(1013, ownerSecret)`.

## Shared secret and key schedule

The sender validates the address, draws a fresh 32-byte `rseed` from the CSPRNG,
and computes:

```text
e = Scalar(EphemeralDomain, rseed)
epk = Encode(e * G_d)
ss = Encode(e * P_d)
context = SHA-256(UTF8(KdfDomain) || epk || SHA-256(info) || SHA-256(aad))
key = HKDF-SHA256(IKM=ss, salt=context, info=UTF8(KeyLabel), L=32)
nonce = HKDF-SHA256(IKM=ss, salt=context, info=UTF8(NonceLabel), L=12)
framed = d || rseed || plaintext
sealed = AES-256-GCM.Encrypt(key, nonce, framed, aad, tagBits=128)
ciphertext = epk || sealed
```

`sealed` is the encrypted frame followed by its 16-byte tag. `info` and `aad` are
byte strings; the primitive does not normalize either. Their SHA-256 digests make
the key-schedule context unambiguous even for variable-length values. The KDF
context excludes the address because the scanner does not know `d` until it has
decrypted the frame. Key and nonce use distinct labels.

There is no caller-supplied encryption randomness in the production API. Reusing
`rseed` for the same address and scope repeats both key and nonce; AES-GCM does
not tolerate that reuse for different frames. Correctness and security therefore
depend on fresh platform randomness. Testing with fixed randomness must remain
outside the production encryption API.

## Primitive decryption and release rule

Given only the restored `viewIkm`, the ciphertext, `info` and `aad`:

1. Reject ciphertext shorter than 112 bytes (`32 + 64 + 16`). Decode the first
   32 bytes as canonical nonidentity `E`.
2. Compute `ss = Encode(v * E)` and the same key schedule. Authenticate and open
   the remaining bytes with AES-256-GCM; fail on a tag mismatch.
3. Read `d` and `rseed` from the first 64 authenticated plaintext bytes. Recompute
   `G_d` and `e`, rejecting an identity base.
4. Require `Encode(e * G_d)` to equal the original 32 ciphertext bytes. This
   opening check is required even when the GCM tag is valid.
5. Only then return `framed[64:]` and `d || Encode(v * G_d)` as the reconstructed
   recipient public key. Do not return `rseed` or unverified plaintext.

The implementation snapshots caller-owned buffers before its first asynchronous
operation. Secret byte arrays and internal plaintext copies are cleared after use
on success and failure. Failure messages do not include plaintext, key material
or nested crypto-library diagnostics. These measures reduce exposure; they do
not promise erasure of every copy made by the JavaScript engine or WebCrypto.

## Application envelopes and acceptance

Primitive decryption establishes neither an on-chain record's authenticity nor
its receive authorization. An application must perform the following checks.

### Ordinary money notes

For chain ID `chainId` and pool address `pool`, the application builds

```text
aad = Keccak256(UTF8("DeepFamily:ShieldedNoteHPKE:v1"))
      || I2OSP_BE(chainId, 8) || AddressBytes(pool)
info = UTF8(NoteInfo)
plaintext = 0x01 || I2OSP_BE(payload.length, 2) || payload || randomPadding
```

`chainId` and `pool` are nonzero. `AddressBytes` is the 20-byte EVM address. The
plaintext is exactly 400 bytes, with `payload.length <= 397`; its remaining bytes
are CSPRNG padding. The primitive adds 64 metadata bytes, a 32-byte `epk` and a
16-byte tag, so the on-chain ciphertext is exactly 512 bytes. Decryption checks
the version, length and canonical note payload.

Before treating the result as a wallet note, `verifyShieldedNotePayload` must
validate the payload against the exact archived ciphertext and on-chain note
commitment under the same chain and pool. Recovery then requires the VALUE note's
owner to equal `Poseidon3(1013, ownerSecret, note.nonce)` for the selected wallet's
restored root spending secret. An external receive-code transfer must use the
address-derived `ownerNonce` as that note nonce. Self outputs use fresh note
nonces and the same three-input owner relation. Budget-specific identity,
mode and policy checks remain applicable to the separate budget formats.

The current scanner also tries fixed X25519 HPKE for budget and self outputs.
These are separate current uses. Only authenticated decryption followed by the
appropriate application checks accepts an output; format guessing must not
substitute for authentication.

### Private letters

For nonzero chain ID `chainId`, letter archive `archive`, and deployment message
ID `messageId`:

```text
aad = Keccak256(UTF8("DeepFamily:PrivateLetterHPKE:v1"))
      || I2OSP_BE(chainId, 8) || AddressBytes(archive)
      || I2OSP_BE(messageId, 32)
info = UTF8(LetterInfo)
ciphertext = "DFLC" || 0x01 || primitiveCiphertext
```

The deployed archive accepts nonzero uint128 message IDs. The encrypted plaintext
is the following canonical envelope; all integer fields here are big-endian:

| Offset |    Bytes | Content                         |
| ------ | -------: | ------------------------------- |
| 0      |        4 | ASCII `DFLE`                    |
| 4      |        1 | Version `0x01`                  |
| 5      |        3 | Zero reserved bytes             |
| 8      |       32 | Nonzero proof randomizer `salt` |
| 40     |       32 | Nonzero `authorizationAlias`    |
| 72     |        8 | Exact UTF-8 body byte length    |
| 80     | variable | Nonempty, valid UTF-8 body      |

`salt` and the alias must be less than the BN254 scalar field modulus
`21888242871839275222246405745257275088548364400416034343698204186575808495617`.
The body is not Unicode-normalized. Reserved bytes, version, length, field ranges
and UTF-8 are checked. The complete ciphertext is `197 + body.length` bytes and
has no additional application-level body size cap.

The inbox must authenticate the archive's deployment, read the verified record
and exact blob bytes, check their ciphertext hash, and pass `expectedRecipient`
to `decryptShieldedLetter`. Let `ownerSecret` and `mode` come from the local wallet,
`R` and `salt` from the authenticated envelope, and `A` be the public key rebuilt
by primitive decryption. Recompute:

```text
digest = SHA-256(UTF8(AddressDomain) || A)
viewHi = OS2IP_BE(digest[0:16])
viewLo = OS2IP_BE(digest[16:32])
ownerNonce = OS2IP_BE(digest) mod Fr
owner = Poseidon3(1013, ownerSecret, ownerNonce)
b0 = Poseidon3(202610210102, R, owner)
b1 = Poseidon3(b0, mode, viewLo)
binding = Poseidon3(b1, viewHi, salt)
```

Require `binding` to equal the archive record's nonzero `recipientBinding` and
`mode` to be 0 or 1 and `ownerNonce` to be nonzero. If the original identity is available, require its canonical
authorization alias to equal `R` as well. Only then may the inbox display the
body. The sender's encrypted alias is an opening component, not an independently
trusted identity assertion. The local root spending secret, mode, reconstructed key and verified
record binding cannot come from sender-provided claims.

This rule also works when the original independent root and its credential
material are restored without the identity-derived branch. A valid issuer proof
still authenticates the root spending secret behind the address-diversified `owner`.
Neither current expiry nor current authorization counter enters historical
reading. `decryptShieldedLetter` rejects any call without `expectedRecipient`
(`SHIELDED_LETTER_RECIPIENT_REQUIRED`), so decryptability alone never admits a
record into the inbox.

Encryption to a public address does not authenticate the letter's author. The
presentation proves receive authorization for the record, not the sender's
identity. Replaying unchanged bytes under the same scope may still decrypt;
message-ID uniqueness, note commitments and ledger spending rules provide the
application's replay controls. Changing the authenticated archive or message ID
without re-encrypting is rejected by the cryptographic scope checks.

## Local cryptographic execution

Secret scalar reduction and Ristretto point multiplication execute in the pinned
libsodium WebAssembly implementation. Scalars remain fixed-length byte strings
at that boundary rather than JavaScript `BigInt` values. Initialization must
verify the actual WASM backend before it receives secret material; failure stops
the operation instead of selecting the former BigInt or an asm.js fallback.
AES-256-GCM runs in WebCrypto, which browsers expose only in secure contexts.
Initialization requires it as well, and so does any encryption or decryption that
reaches the key schedule; its absence fails with the same fixed error code instead
of reading as a foreign record.
Synchronous validation of public addresses may use the independent noble
Ristretto decoder and public hash-to-group implementation.

In the browser, these operations run in the existing secret-owning Worker. They
do not introduce a server, remote key service or remote decryption request. The
WASM backend is an implementation hardening measure. Browser engines, runtime
integration and observable application behavior still need evaluation; this does
not establish end-to-end constant-time execution.

## Threat model and conditional analysis

An attacker can know and share receive codes, choose addresses and ciphertexts,
submit protocol transactions using credentials they legitimately control, modify
untrusted archive/RPC data, and observe public records and application-visible
success or failure. A malicious sender knows their own randomness and can create
valid AEAD ciphertexts containing dishonest metadata. The recipient must enforce
the opening and application checks above against that sender as well.

The trusted inputs are the selected wallet's original recovery materials, the
executed client and cryptographic dependencies, secure platform randomness, and
the authenticated deployment and on-chain proof system. An endpoint or extension
that can read arbitrary Worker memory, a replaced client bundle, compromised
recovery material or forged chain consensus is outside the confidentiality claim.
RPC responses must still be checked against the protocol's authenticated records;
RPC selection is not an identity oracle for the sender. Record, event and blob
consistency checks do not independently verify EVM consensus. The application
requires an authentic chain view; a provider fabricating a complete consistent
history is outside this encryption protocol's authorization guarantee.

For honest inputs, the DH correctness relation is exact:

```text
e * P_d = e * (v * G_d) = v * (e * G_d) = v * E.
```

The nonidentity prime-order group prevents small-subgroup inputs. For a fixed
nonzero `E`, different scalars modulo `L` give different shared group elements.
Those facts establish agreement and a property of DH outputs, not by themselves
unique acceptance of a complete ciphertext under every possible key.

The following are explicit security assumptions or proof obligations:

| Property                                      | Basis and remaining obligation                                                                                                                                                                                            |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scalar and shared-secret secrecy              | High-entropy seed material, discrete-log/DH hardness, SHA-512 derivation and a non-leaking implementation. Reusing the same scalar across many attacker-influenced inputs needs side-channel evaluation.                  |
| Address-point unlinkability                   | DDH hardness and RFC 9380 hash-to-group modeled as independent random-oracle bases. This is a claim about points generated by the specified procedure, not whole credential packets.                                      |
| Diversified-owner privacy                     | A high-entropy root spending secret, changing address-derived nonces and the pseudorandomness of the domain-separated Poseidon relation. This does not hide the credential's stable authorization alias.                 |
| Payload confidentiality and integrity         | A suitable hashed-DH/HKDF argument, distinct domain labels, fresh randomness and AES-GCM security with 128-bit tags. A proof must account for adaptively selected points, contexts and ciphertexts.                       |
| Address and context substitution              | Canonical decoding, complete-address digest, authenticated scope, fixed issuer proof and the required note/letter binding checks. This relies on collision resistance and proof-system soundness.                         |
| Cross-key acceptance and partitioning oracles | Must analyze the complete key schedule, encrypted opening, AEAD and application commitment together. AEAD authentication alone is not a general key-commitment guarantee. No complete security reduction is claimed here. |

Each freshly generated ordinary code diversifies both its receiving point and
owner commitment. Reusing the same code reuses both values. Complete codes still
remain linkable through their stable authorization alias, including across
ordinary codes and Fund credentials; Fund also retains its fixed owner and
viewing key and discloses identity to its holder. Diversification does not hide
message size, transaction timing or application-visible operation roles.

The suite of an output is visible too. Every ephemeral point is a canonical
Ristretto encoding, while an X25519 HPKE `enc` decodes as one only about one time
in eight, so an observer can classify 512-byte pool outputs by suite with high
confidence. Today this adds nothing, because each pool output slot already shows
publicly whether it carries a receive authorization. A change that hides or omits
receive authorizations must first make the suites indistinguishable, for example
by encrypting every output with one suite.

The same viewing secret intentionally recovers all its diversified addresses.
Disclosure of that secret exposes the associated past and future ciphertexts;
the scheme provides no forward secrecy. Credential expiry and revocation control
new protocol authorization, not access to previously published encrypted data.
Changing the computational backend does not change these properties.

## Reproducible checks and sources

The protocol-core test command includes fixed synthetic vectors, an independent
Node-crypto/noble reference implementation, RFC invalid point encodings, published
RFC 9380 and RFC 9496 expansion, element-derivation and multiplication vectors, a
ciphertext that AES-GCM authenticates under two receive keys, and deterministic
adversarial-input tests. The reference must not call the production
libsodium operations. Integration tests also exercise both original recovery
modes and the actual note and letter acceptance rules.

The versioned inputs and their provenance are in
[`test/fixtures/README.receive-encryption.md`](../packages/protocol-core/test/fixtures/README.receive-encryption.md),
[`shielded-receive-encryption.vectors.json`](../packages/protocol-core/test/fixtures/shielded-receive-encryption.vectors.json)
and [`ristretto255-invalid-encodings.json`](../packages/protocol-core/test/fixtures/ristretto255-invalid-encodings.json).
The independent implementation is
[`shielded-receive-encryption.reference.js`](../packages/protocol-core/test/fixtures/shielded-receive-encryption.reference.js).

```sh
npm test --workspace @deepfamily/protocol-core
# This smaller suite also runs early in CI, before circuit/proof setup:
npm run test:receive-security --workspace @deepfamily/protocol-core
# Or run just the fixed vectors, differential properties and mutation corpus:
node --test packages/protocol-core/test/shielded-receive-encryption-vectors.test.js
```

Wallet and letter recovery initialize both runtimes before scanning. An unavailable
runtime is an operation failure, not an unrelated-recipient result or an empty
wallet. Backend initialization errors retain a fixed public error code through
the note, letter and recovery layers. Key-input validation and backend initialization
omit nested parser/library diagnostics that could contain key material.

An optional timing diagnostic measures the production WASM multiplication with
public synthetic small, sparse, dense and random scalars in randomized class order:

```sh
npm run security:receive:timing
# Install the Playwright engines if they are not already available:
node node_modules/playwright-core/cli.js install chromium firefox webkit
npm run security:receive:timing -- --browser chromium
npm run security:receive:timing -- --browser firefox
npm run security:receive:timing -- --browser webkit
```

The browser diagnostic first checks all three frozen address/decryption vectors,
then runs the same backend in a local module Worker under a policy allowing WASM
but not JavaScript evaluation. It reports group means and
Welch statistics without a pass/fail threshold. These end-to-end samples include
the fixed-size JavaScript/WASM bridge and memory cleanup; they do not prove the
compiled arithmetic or every browser execution path to be constant-time.

On the local macOS ARM64 validation run, 1000 batches of 16 multiplications per
class produced these descriptive results. The last column is the largest absolute
Welch statistic across the six class pairs:

| Runtime                | Class means, microseconds | Maximum absolute t |
| ---------------------- | ------------------------: | -----------------: |
| Node 26.9.0            |               44.89–44.95 |               1.19 |
| Chromium 148.0.7778.96 |               45.85–46.12 |               2.01 |
| Firefox 150.0.2        |             701.70–702.60 |               0.61 |
| WebKit 26.4            |               62.48–62.59 |               2.01 |

Production CSP and proving-worker flows can also be checked with
`npm run csp:scan --workspace deepfamily-frontend`; set `CSP_SCAN_BROWSER` to
`firefox` or `webkit` to select another engine. This checks the built application,
including actual receive-code and letter proofs, rather than the diagnostic bundle.

The fixture inputs contain no production secrets. A vector generator is a review
tool, not a substitute for inspecting changed expected bytes. Passing differential,
fuzz or timing tests supports the checked cases; it does not complete the proof
obligations above or constitute independent review.

- [RFC 9496: ristretto255 encoding, scalar field and element derivation](https://www.rfc-editor.org/rfc/rfc9496.html).
- [RFC 9380 Appendix B: hash-to-ristretto255](https://www.rfc-editor.org/rfc/rfc9380.html#appendix-B).
- [RFC 5869: HKDF](https://www.rfc-editor.org/rfc/rfc5869.html).
- [libsodium Ristretto API](https://libsodium.gitbook.io/doc/advanced/point-arithmetic/ristretto).
- [libsodium browser/WASM implementation](https://github.com/jedisct1/libsodium.js).
- [Zcash protocol, sections 4.20 and 8.7](https://zips.z.cash/protocol/protocol.pdf), for comparison. Its complete note-commitment-specific argument is not inherited by this protocol.
