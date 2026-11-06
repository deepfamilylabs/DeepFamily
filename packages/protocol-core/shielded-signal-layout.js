// Canonical public field order and widths for shielded business proofs.
// Keep this module dependency-free: both protocol clients and the Solidity generator consume it.
export const SHIELDED_POOL_ACTION = Object.freeze({
  Shield: 0,
  Fund: 1,
  Claim: 2,
  PrivateTransfer: 3,
  Unshield: 4,
});

const { Shield, Fund, Claim, PrivateTransfer, Unshield } = SHIELDED_POOL_ACTION;
const ALL_ACTIONS = Object.values(SHIELDED_POOL_ACTION);

// One ordered sequence serves both clients and the pool's shared conditional builder.
export const SHIELDED_POOL_SIGNAL_SEGMENTS = Object.freeze(
  [
    [ALL_ACTIONS, ["chainId", "pool"]],
    [[Fund], ["fundMode", "budgetKind", "publicBudget"]],
    [
      [Fund, Claim, PrivateTransfer, Unshield],
      ["inputRoots", "inputNullifiers"],
    ],
    [[Claim], ["periodNullifiers"]],
    [ALL_ACTIONS, ["outputCommitments", "ciphertextHashes"]],
    [[Shield, Unshield], ["amount"]],
    [[Unshield], ["recipient"]],
    [
      [Fund, Claim],
      ["endorsementRoot", "trustedRoot", "asOf"],
    ],
    [[Fund, PrivateTransfer], ["receiveBindings"]],
  ].map(([actions, fields]) =>
    Object.freeze({ actions: Object.freeze(actions), fields: Object.freeze(fields) }),
  ),
);

export const SHIELDED_POOL_PUBLIC_INPUTS = Object.freeze(
  Object.fromEntries(
    ALL_ACTIONS.map((action) => [
      action,
      Object.freeze(
        SHIELDED_POOL_SIGNAL_SEGMENTS.filter((segment) => segment.actions.includes(action)).flatMap(
          (segment) => segment.fields,
        ),
      ),
    ]),
  ),
);

export const SHIELDED_POOL_INPUT_WIDTHS = Object.freeze({
  chainId: 1,
  pool: 1,
  fundMode: 1,
  budgetKind: 1,
  publicBudget: 10,
  inputRoots: "inputSlots",
  inputNullifiers: "inputSlots",
  periodNullifiers: 3,
  outputCommitments: 2,
  ciphertextHashes: 2,
  amount: 1,
  recipient: 1,
  endorsementRoot: 1,
  trustedRoot: 1,
  asOf: 1,
  receiveBindings: 2,
});

export function shieldedInputSlotCount(action) {
  return action === SHIELDED_POOL_ACTION.Claim ||
    action === SHIELDED_POOL_ACTION.PrivateTransfer ||
    action === SHIELDED_POOL_ACTION.Unshield
    ? 1
    : 2;
}

export function shieldedPublicSignalCount(action, inputSlots = shieldedInputSlotCount(action)) {
  return SHIELDED_POOL_PUBLIC_INPUTS[action].reduce(
    (total, name) =>
      total +
      (SHIELDED_POOL_INPUT_WIDTHS[name] === "inputSlots"
        ? inputSlots
        : SHIELDED_POOL_INPUT_WIDTHS[name]),
    0,
  );
}

export const SHIELDED_POOL_PUBLIC_SIGNAL_COUNTS = Object.freeze(
  Object.fromEntries(
    Object.values(SHIELDED_POOL_ACTION).map((action) => [
      action,
      shieldedPublicSignalCount(action),
    ]),
  ),
);

export const SHIELDED_VALUE_PUBLIC_SIGNAL_COUNTS = Object.freeze(
  Object.fromEntries(
    [1, 4].map((width) => [
      width,
      shieldedPublicSignalCount(SHIELDED_POOL_ACTION.PrivateTransfer, width),
    ]),
  ),
);

// Circuit variants share field order; only their input-slot width or private lineage depth differs.
export const SHIELDED_BUSINESS_CIRCUIT_LAYOUTS = Object.freeze(
  [
    ["Shield", "shielded_shield", 2, "SHIELDED_SHIELD_PUBLIC_SIGNALS_LEN"],
    ["Fund", "shielded_fund", 2, "SHIELDED_FUND_PUBLIC_SIGNALS_LEN"],
    ["Claim", "shielded_claim_32", 1, "SHIELDED_CLAIM_PUBLIC_SIGNALS_LEN"],
    ["Claim", "shielded_claim_64", 1, "SHIELDED_CLAIM_PUBLIC_SIGNALS_LEN"],
    [
      "PrivateTransfer",
      "shielded_private_transfer",
      1,
      "SHIELDED_PRIVATE_TRANSFER_PUBLIC_SIGNALS_LEN",
    ],
    ["Unshield", "shielded_unshield", 1, "SHIELDED_UNSHIELD_PUBLIC_SIGNALS_LEN"],
    [
      "PrivateTransfer",
      "shielded_private_transfer_4",
      4,
      "SHIELDED_PRIVATE_TRANSFER_4_PUBLIC_SIGNALS_LEN",
    ],
    ["Unshield", "shielded_unshield_4", 4, "SHIELDED_UNSHIELD_4_PUBLIC_SIGNALS_LEN"],
  ].map(([actionName, circuit, inputSlots, constant]) =>
    Object.freeze({
      actionName,
      action: SHIELDED_POOL_ACTION[actionName],
      circuit,
      inputSlots,
      constant,
    }),
  ),
);
