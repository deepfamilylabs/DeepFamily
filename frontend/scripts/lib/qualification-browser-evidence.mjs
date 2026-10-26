import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { Contract, Interface, getAddress } from "ethers";

/** Independently reconcile every browser submission with actual receipts and ledger inputs. */
export async function verifyQualificationTransactionEvidence({ root, provider, fixture, report }) {
  const entries = await Promise.all(
    Object.entries(fixture.deployments).map(async ([name, address]) => {
      const artifact = JSON.parse(
        await fs.readFile(path.join(root, "deployments/localhost", `${name}.json`), "utf8"),
      );
      return [getAddress(address), { name, artifact, interface: new Interface(artifact.abi) }];
    }),
  );
  const contracts = new Map(entries),
    byMethod = {};
  for (const item of report.transactions) {
    const tx = await provider.getTransaction(item.transactionHash),
      receipt = await provider.getTransactionReceipt(item.transactionHash);
    assert.ok(tx && receipt, "Every reported transaction must exist on the actual local chain");
    assert.equal(receipt.status, 1, "All accepted browser actions must have successful receipts");
    assert.equal(
      getAddress(tx.from),
      getAddress(item.account),
      "Receipt signer must match the isolated browser wallet",
    );
    const target = contracts.get(getAddress(tx.to));
    assert.ok(target, "Browser transactions may target only the recorded current deployment");
    const decoded = target.interface.parseTransaction({ data: tx.data, value: tx.value });
    assert.ok(decoded);
    item.method = decoded.name;
    item.blockNumber = receipt.blockNumber;
    item.gasUsed = String(receipt.gasUsed);
    (byMethod[decoded.name] ??= []).push({ tx, receipt, decoded });
  }
  const deposits = byMethod.depositBudget ?? [],
    claims = byMethod.claimBudget ?? [];
  assert.equal(deposits.length, 2, "Both initial budget funding and append must have executed");
  assert.equal(claims.length, 1, "Exactly one successful post-reissue claim must execute");
  const original = deposits[0].decoded.args,
    append = deposits[1].decoded.args,
    claimed = claims[0].decoded.args;
  assert.equal(
    original.deposit.budgetKey,
    append.deposit.budgetKey,
    "Append must preserve the original budget key",
  );
  assert.equal(
    original.deposit.eligibleFrom,
    append.deposit.eligibleFrom,
    "Append must preserve the original budget schedule",
  );
  assert.equal(
    claimed.claimData.budgetKey,
    original.deposit.budgetKey,
    "Replacement qualification must claim the original budget",
  );
  assert.notEqual(
    claimed.claimData.childRoleIndex,
    original.capability.childRoleIndex,
    "Claim must use replacement qualification indices",
  );
  assert.notEqual(claimed.claimData.endorsementRoleIndex, original.capability.endorsementRoleIndex);
  const source = new Contract(
    fixture.deployments.EligibilitySource,
    contracts.get(getAddress(fixture.deployments.EligibilitySource)).artifact.abi,
    provider,
  );
  assert.equal(await source.isRoleRevoked(0, original.capability.childRoleIndex), true);
  assert.equal(await source.isRoleRevoked(1, original.capability.endorsementRoleIndex), true);
  assert.equal(await source.isRoleRevoked(0, claimed.claimData.childRoleIndex), false);
  assert.equal(await source.isRoleRevoked(1, claimed.claimData.endorsementRoleIndex), false);
  const pool = new Contract(
    fixture.deployments.ShieldedNativePool,
    contracts.get(getAddress(fixture.deployments.ShieldedNativePool)).artifact.abi,
    provider,
  );
  assert.equal(
    await pool.nullifierSpent(claimed.claimData.periodNullifier),
    true,
    "Successful claim must consume its period allowance",
  );
  const budget = await pool.budgetRecords(original.deposit.budgetKey);
  assert.equal(budget.exists, true);
  assert.equal(budget.eligibleFrom, original.deposit.eligibleFrom);
  for (const method of ["shield", "transfer", "registerLetter", "revokeEligibilityRoles"])
    assert.equal(byMethod[method]?.length, 1);
  for (const method of ["publishFact", "publishTrust", "registerCredential"])
    assert.equal(byMethod[method]?.length, 2);
  return {
    successfulReceipts: report.transactions.length,
    methods: Object.fromEntries(
      Object.entries(byMethod).map(([name, values]) => [name, values.length]),
    ),
    originalBudgetKey: String(original.deposit.budgetKey),
    originalEligibleFrom: String(original.deposit.eligibleFrom),
    replacementClaimUsesOriginalBudget: true,
    oldRoleIndicesRevoked: true,
    replacementRoleIndicesCurrent: true,
    periodNullifierSpent: true,
  };
}
