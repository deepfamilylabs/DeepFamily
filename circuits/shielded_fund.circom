pragma circom 2.2.3;

include "lib/shielded_fund.circom";

component main {
    public [chainId, pool, fundMode, budgetKind, publicBudget, inputShardIds, inputRoots, inputNullifiers,
        outputCommitments, ciphertextHashes, endorsementRoot, trustedRoot, asOf, receiveBindings]
} = ShieldedFund(0);
