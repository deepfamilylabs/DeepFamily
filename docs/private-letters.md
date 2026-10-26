# Receiving codes and letters

`dfreceive` is the only receiving-code format. Privacy is the default. A code supports letters, ordinary transfers and child-budget deposits, including additional contributions to the same budget record.

The recipient generates the code and shares it once. The payer uses that original code, public state and the payer's own money-note secrets to generate a future payment proof. The recipient can remain offline. No private computation service, second budget code or later recipient confirmation is required.

## Authorization and eligibility

A code carries a proof of its receiving authorization: independently derived spending/viewing keys, a nonce, expiry and a code-specific revocation tag. It can include up to two independently proved budget capabilities, for the recipient's eligible family relationships. It does not encode the actual identity, parent, recommender, credential opening, wallet root or private derivation index.

`EligibilitySource` authenticates actual current lineage facts and the publisher's authority. `ReceiveRegistry` verifies qualification issuance and code capabilities. Every budget deposit and additional contribution rechecks current role revocations and expiry; `claimBudget` also requires current qualification. Revoking family qualification does not disable ordinary receipt or letters. The recipient can revoke an individual code separately.

Qualified codes expose shared pseudorandom role indices, so codes using the same qualification can be linked before revocation. The indices use a different hash domain from identity-associated source registration commitments. A public family rule can reveal that a code qualifies for its family commitment. Revocation publishes role openings and may associate historical codes with their source registrations; that behavior is retained.

## Budgets

`depositBudget` computes a record key from the code and complete policy. It creates the record on first use, then appends independent encrypted contributions. Additional contributions preserve the original eligibility clock and do not spend the recipient's existing budget notes.

Different codes may create separate records for the same person and policy. Claims still share a subject/policy/period nullifier, so changing codes does not create another allowance for the same period. Spent money inputs and duplicate outputs remain rejected independently of this record behavior.

## Letters and wallet recovery

`LetterArchive.registerLetter` verifies the generic code authorization and stores HPKE ciphertext through the existing archive blob format. Letters require no family capability or deposit. Wallet viewing secrets remain inside the receiving Worker.

The wallet exports an authenticated encrypted backup containing its root, code index and qualification/controller openings. Each new external code advances that index and requires an updated backup before sharing. Recovery replays public ledger events and decrypts locally; it does not query an identity-filtered note endpoint.

## Artifacts and verification

The single deployment uses 13 relations: two identity/disclosure, three asset boundaries and eight receiving/qualification/budget relations, using direct role-index status checks. Each submitted Groth16 ABC proof is 256 bytes; a transaction may include several proofs. Public signals and ciphertext are separate transaction data.

Run `npm run zk:dev` for local development keys, `npm run zk:dev:check` to check them, and `npm run test:proof` / `npm run test:evm` for real-proof checks. `npm run zk:frontend -- <chainId> <registry>` exports trusted frontend artifacts and a local build configuration. A scanned code cannot choose proof keys or replace that configuration.

Development keys are not a reviewed production ceremony. Public deployment and release remain blocked until all 13 relations have reviewed production evidence. Budget qualification checks use three direct current-status reads, independent of revocation history. There are no preparation proofs or preparation transactions. A target revocation remains effective immediately, including when committed after business-proof generation. See [revocation checks and capacity](receive-revocation-capacity.md) for the measured scope and limitations.
