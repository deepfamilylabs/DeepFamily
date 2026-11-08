# Chain client

Internal browser and Node package for contract I/O. It contains no React state,
protocol proof generation, secret storage, translations or automatic retries.

| Module | Responsibility |
| --- | --- |
| `contracts.js` | Construct or instrument ethers contracts; classify read, simulation, estimate and send failures. Preserve `connect`, `attach`, `getFunction` and event APIs. |
| `execution.js` | Execute one read, or send once and track confirmation. Preserve the pre-send replacement scan anchor and durable submission callbacks. |
| `receipts.js` | Check receipt hash/status and follow only an exact fee replacement. Apply caller-selected confirmations, timeout and replacement policies. |
| `errors.js` | Preserve original errors for domain decoding and provide a separate safe, immutable error view. |
| `transport.js` | Serialize and restore validated public error metadata with caller-sanitized wording across Worker boundaries. |
| `wallet.js` | Check the actual wallet network and account against the operation's configured scope. |
| `gas.js` | Validate supported Archive network gas limits and calldata floors. |

`index.js` and `index.d.ts` export the public API.

```js
const contract = createChainContract(address, abi, signer);
const value = await runChainRead({ read: () => contract.value() });
const confirmed = await executeChainTransaction({
  provider: signer.provider,
  beforeSend: () => assertChainWalletScope({ signer, chainId, account, assertActive: assertCurrentView }),
  assertActive: assertCurrentView,
  send: () => contract.update(value),
  onSubmitted: recordPublicHash,
});
```

The executor awaits `beforeSend` after reading the replacement scan anchor, then
checks cancellation immediately before opening the wallet. The wallet check uses
raw `eth_chainId` where available rather than a cached provider network. Once broadcast, it
keeps tracking the public receipt; callers guard their own local completion.
Only fee replacements with identical chain, sender, destination, calldata,
value and nonce are accepted. CREATE deployments and journalled release
operations can explicitly use `replacementPolicy: "reject"`.

Durable callers persist the original response in `onTransactionSubmitted`
before waiting, then use `waitForTransactionHashReceipt` to resume from the
recorded hash. Domain event validation, private output/nonce reconciliation,
release checkpoints, budgets and finality policies stay with the caller.

`getChainErrorDetails(error)` returns category, operation, code, manual retry
eligibility, and public transaction context. It excludes messages, calldata,
proofs, credentials, causes and arbitrary provider diagnostics. An error with
a known submitted hash or confirmation is never marked retryable. Original
errors retain their domain identity and ethers decoding fields; they must not
be serialized as public records.

Worker error messages use `serializeChainError(error, sanitizedMessage)` and
`restoreChainError(dto)`. Only validated public fields and known error codes cross
that boundary; raw errors, causes, provider envelopes and proof material do not.

UI messages are produced by the frontend's shared error presentation adapter.
CLI consumers can use the same canonical details with their own safe wording.
`npm run test:chain-client` checks that runtime waits use this package and runs
its contract, execution, error, transport, wallet, receipt and gas tests.
