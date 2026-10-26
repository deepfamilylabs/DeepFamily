import assert from "node:assert/strict";
import { poseidon2, poseidon3 } from "poseidon-lite";
import { computeShieldedCiphertextHashField, prepareRevocationScan } from "@deepfamily/protocol-core";
import { proveProtocol } from "../../scripts/protocol-zk-development.mjs";

// Gas/state fixture only: the source, registry and pools are the actual contracts.
// Family/lineage authentication and money proofs are explicit mocks. Revocation
// scan proofs use the real fixed Groth16 verifier unless explicitly disabled.
// This fixture is not full cryptographic acceptance of the money/qualification flow.
// Source state is populated through publication/revocation, never storage writes.
export async function createReceiveRevocationGasFixture(hre, { realScan = true } = {}) {
  const { ethers, networkHelpers } = hre;
  const [endorser, manager] = await ethers.getSigners();
  const abi = ethers.AbiCoder.defaultAbiCoder();
  const echo = (signals) => abi.encode(["uint256[]"], [signals]);
  const boundary = (purpose, signals) => abi.encode(["uint8", "uint256[]"], [purpose, signals]);
  const commitment = (role, secret) => poseidon2([74201n + BigInt(role), secret]);
  const timestamp = async () => BigInt((await ethers.provider.getBlock("latest")).timestamp);
  const mined = async (promise) => (await promise).wait();
  const chainId = (await ethers.provider.getNetwork()).chainId;
  const t3 = await ethers.deployContract("PoseidonT3");
  const t4 = await ethers.deployContract("PoseidonT4");
  const verifier = await ethers.deployContract("FixedProofVerifierMock");
  const boundaryVerifier = await ethers.deployContract("PoolBoundaryVerifierMock");
  const rawScanVerifier = realScan ? await ethers.deployContract("EligibilityRevocationScanVerifier") : null;
  const scanVerifier = realScan
    ? await ethers.deployContract("FixedGroth16Verifier", [await rawScanVerifier.getAddress(), 9])
    : verifier;
  const family = await ethers.deployContract("SourceFamilyMock");
  const lineage = await ethers.deployContract("SourceLineageMock", [await family.getAddress()]);
  const source = await (
    await ethers.getContractFactory("EligibilitySource", {
      libraries: { PoseidonT3: await t3.getAddress(), PoseidonT4: await t4.getAddress() },
    })
  ).deploy(await lineage.getAddress(), await verifier.getAddress(), await verifier.getAddress(), await scanVerifier.getAddress());
  const sourceAddress = await source.getAddress();
  const familyAddress = await family.getAddress();
  await mined(family.setSource(sourceAddress));
  const childIdentity = 201n;
  const parentIdentity = 202n;
  const parentHash = ethers.keccak256(ethers.toBeHex(parentIdentity, 32));
  await mined(family.setManager(parentHash, 1n, manager.address, true));
  const publishRoles = async (secrets, factLeaf, trustLeaf) => {
    const fact = [
      childIdentity,
      parentIdentity,
      endorser.address,
      1n,
      factLeaf,
      commitment(0, secrets[0]),
      commitment(1, secrets[1]),
    ];
    await mined(
      source
        .connect(endorser)
        .publishFact(
          ...fact,
          echo([
            fact[4],
            fact[5],
            fact[6],
            chainId,
            BigInt(sourceAddress),
            childIdentity,
            parentIdentity,
            BigInt(endorser.address),
            1n,
            await lineage.root(0),
          ]),
        ),
    );
    const trust = [parentIdentity, endorser.address, 1n, trustLeaf, commitment(2, secrets[2])];
    await mined(
      source
        .connect(manager)
        .publishTrust(
          ...trust,
          echo([
            trustLeaf,
            trust[4],
            chainId,
            BigInt(sourceAddress),
            parentIdentity,
            BigInt(endorser.address),
            1n,
            await lineage.root(1),
          ]),
        ),
    );
  };
  const targetSecrets = [30000n, 40000n, 50000n];
  await publishRoles(targetSecrets, 10000n, 20000n);
  const registry = await (
    await ethers.getContractFactory("ReceiveRegistry", {
      libraries: { PoseidonT3: await t3.getAddress() },
    })
  ).deploy(sourceAddress, ...Array(3).fill(await verifier.getAddress()));
  const registryAddress = await registry.getAddress();
  const sourceRoot = await source.sourceRoot();
  const trustedRoot = await source.trustedRoot();
  const credential = 301n;
  await mined(
    registry.registerCredential(
      credential,
      sourceRoot,
      trustedRoot,
      echo([credential, chainId, BigInt(registryAddress), sourceRoot, trustedRoot]),
    ),
  );
  const nonce = 64n;
  const tags = targetSecrets.map((secret, role) =>
    poseidon3([73301n + BigInt(role), secret, nonce]),
  );
  const code = {
    codeAlias: 61n,
    commonBinding: 62n,
    revocationTag: poseidon2([74021n, 99n]),
    nonce,
    ownerCommitment: 65n,
    viewKeyLo: 66n,
    viewKeyHi: 67n,
    expiresAt: (await timestamp()) + 365n * 86400n,
  };
  const codeProof = echo([
    code.codeAlias,
    code.commonBinding,
    code.revocationTag,
    chainId,
    BigInt(registryAddress),
    code.nonce,
    code.ownerCommitment,
    code.viewKeyLo,
    code.viewKeyHi,
    code.expiresAt,
  ]);
  const capability = {
    issuanceRoot: await registry.issuanceRoot(),
    parentVersion: 1n,
    capabilityBinding: 72n,
    familyTag: 73n,
    childTag: tags[0],
    endorsementTag: tags[1],
    trustedTag: tags[2],
  };
  const capabilityProof = echo([
    capability.capabilityBinding,
    capability.familyTag,
    ...tags,
    chainId,
    BigInt(registryAddress),
    capability.issuanceRoot,
    code.commonBinding,
    capability.parentVersion,
  ]);
  const token = await ethers.deployContract("PoolTokenMock");
  const poolArgs = [
    await boundaryVerifier.getAddress(),
    registryAddress,
    ...Array(3).fill(await verifier.getAddress()),
  ];
  const libraries = { PoseidonT3: await t3.getAddress() };
  const native = await (
    await ethers.getContractFactory("ShieldedNativePool", { libraries })
  ).deploy(...poolArgs);
  const erc20 = await (
    await ethers.getContractFactory("ShieldedErc20Pool", { libraries })
  ).deploy(await token.getAddress(), ...poolArgs);
  const pools = [
    { asset: "native", pool: native },
    { asset: "erc20", pool: erc20 },
  ];
  const ciphertexts = [`0x${"01".repeat(512)}`, `0x${"02".repeat(512)}`];
  const data = (cm, root, nullifier) => ({
    inputShardIds: root === undefined ? [] : [0n],
    inputRoots: root === undefined ? [] : [root],
    inputNullifiers: root === undefined ? [] : [nullifier],
    outputCommitments: [cm, cm + 1n],
    outputCiphertexts: [...ciphertexts],
  });
  const outputs = (action) => [
    ...action.outputCommitments,
    ...action.outputCiphertexts.map(computeShieldedCiphertextHashField),
  ];
  const createFundOperation = (prefix, deposit, action) => ({
    method: "depositBudget",
    args: [
      code,
      capability,
      codeProof,
      capabilityProof,
      deposit,
      action,
      echo([
        ...prefix,
        code.commonBinding,
        code.codeAlias,
        code.nonce,
        code.ownerCommitment,
        code.viewKeyLo,
        code.viewKeyHi,
        capability.capabilityBinding,
        capability.familyTag,
        capability.parentVersion,
        deposit.policyCommitment,
        deposit.budgetKey,
        deposit.eligibleFrom,
        action.inputRoots[0],
        action.inputNullifiers[0],
        ...outputs(action),
      ]),
    ],
    data: action,
    budgetKey: deposit.budgetKey,
    inputNullifiers: [...action.inputNullifiers],
    outputCommitments: [...action.outputCommitments],
  });
  const initialEligibleFrom = (await timestamp()) + 3600n;
  for (const entry of pools) {
    const { asset, pool } = entry;
    const prefix = [chainId, BigInt(await pool.getAddress())];
    const shieldData = data(100n);
    if (asset === "erc20") {
      await mined(token.mint(endorser.address, 1000n));
      await mined(token.connect(endorser).approve(await pool.getAddress(), 1000n));
    }
    await mined(
      pool
        .connect(endorser)
        .shield(
          1000n,
          shieldData,
          boundary(2, [...prefix, ...outputs(shieldData), 1000n]),
          asset === "native" ? { value: 1000n } : {},
        ),
    );
    const root = (await pool.noteShard(0)).root;
    const appendRecord = {
      policyCommitment: 81n,
      budgetKey: 82n,
      eligibleFrom: initialEligibleFrom,
    };
    const claimRecord = {
      policyCommitment: 83n,
      budgetKey: 84n,
      eligibleFrom: initialEligibleFrom,
    };
    for (const [record, action] of [
      [appendRecord, data(200n, root, 300n)],
      [claimRecord, data(400n, root, 500n)],
    ]) {
      const operation = createFundOperation(prefix, record, action);
      await mined(pool[operation.method](...operation.args));
    }
    Object.assign(entry, {
      prefix,
      appendRecord,
      claimRecord,
      inputRoot: (await pool.noteShard(0)).root,
    });
  }
  // The claim record is mature before any measurement. Echo proofs cannot check
  // policy arithmetic; this clock also keeps the fixture's timeline realistic.
  await networkHelpers.time.increaseTo(initialEligibleFrom + 86400n);
  const refreshOperations = async () => {
    const now = await timestamp();
    for (const entry of pools) {
      const firstRecord = { policyCommitment: 85n, budgetKey: 86n, eligibleFrom: now + 3600n };
      const first = createFundOperation(
        entry.prefix,
        firstRecord,
        data(600n, entry.inputRoot, 700n),
      );
      const append = createFundOperation(
        entry.prefix,
        entry.appendRecord,
        data(800n, entry.inputRoot, 900n),
      );
      const action = data(1000n, entry.inputRoot, 1100n);
      const claimData = {
        budgetKey: entry.claimRecord.budgetKey,
        asOf: now,
        periodNullifier: 1200n,
        issuanceRoot: capability.issuanceRoot,
        childTag: tags[0],
        endorsementTag: tags[1],
        trustedTag: tags[2],
      };
      const claim = {
        method: "claimBudget",
        args: [
          claimData,
          action,
          echo([
            ...entry.prefix,
            code.codeAlias,
            code.nonce,
            code.ownerCommitment,
            code.viewKeyLo,
            code.viewKeyHi,
            entry.claimRecord.policyCommitment,
            claimData.budgetKey,
            entry.claimRecord.eligibleFrom,
            claimData.asOf,
            action.inputRoots[0],
            action.inputNullifiers[0],
            claimData.periodNullifier,
            ...outputs(action),
            BigInt(registryAddress),
            capability.issuanceRoot,
            ...tags,
          ]),
        ],
        data: action,
        budgetKey: claimData.budgetKey,
        periodNullifier: claimData.periodNullifier,
        inputNullifiers: [...action.inputNullifiers],
        outputCommitments: [...action.outputCommitments],
      };
      entry.operations = { first, append, claim };
    }
  };
  await refreshOperations();

  const seedTo = async (count) => {
    assert.ok(
      Number.isSafeInteger(count) && count >= 0,
      "Revocation count must be a non-negative safe integer",
    );
    const counts = await Promise.all([0, 1, 2].map((role) => source.revokedRoleCount(role)));
    const targetRevoked = await Promise.all(
      [0, 1, 2].map(
        async (role) =>
          (await source.roleRecord(role, commitment(role, targetSecrets[role]))).revoked,
      ),
    );
    const offsets = targetRevoked.map((revoked) => (revoked ? 1n : 0n));
    const unrelatedCounts = counts.map((value, role) => value - offsets[role]);
    assert.ok(
      unrelatedCounts.every((value) => value === unrelatedCounts[0]),
      "Unrelated seed counts differ between roles",
    );
    assert.ok(
      BigInt(count) >= unrelatedCounts[0],
      "Cannot remove historical revocations; restore an earlier snapshot",
    );
    let current = Number(unrelatedCounts[0]);
    while (current < count) {
      // One target role per key stays active; leave its slot available.
      const end = Math.min(count, current + 16);
      const factRoles = [],
        factSecrets = [],
        trustSecrets = [];
      for (let index = current; index < end; ++index) {
        const offset = BigInt(index);
        const secrets = [3000000n + offset, 4000000n + offset, 5000000n + offset];
        await publishRoles(secrets, 1000000n + offset, 2000000n + offset);
        factRoles.push(0, 1);
        factSecrets.push(secrets[0], secrets[1]);
        trustSecrets.push(secrets[2]);
      }
      await mined(
        family.connect(endorser).revoke(sourceAddress, endorser.address, factRoles, factSecrets),
      );
      await mined(
        family
          .connect(manager)
          .revoke(sourceAddress, manager.address, Array(trustSecrets.length).fill(2), trustSecrets),
      );
      current = end;
    }
    const actual = await Promise.all([0, 1, 2].map((role) => source.revokedRoleCount(role)));
    assert.ok(
      actual.every((value, role) => value === BigInt(count) + offsets[role]),
      "Source revocation counts do not match the requested unrelated scale and target revocations",
    );
    await refreshOperations();
  };
  const revokeTarget = async (role) => {
    assert.ok(Number.isInteger(role) && role >= 0 && role <= 2, "Unknown target role");
    const actor = role === 2 ? manager : endorser;
    return mined(
      family.connect(actor).revoke(sourceAddress, actor.address, [role], [targetSecrets[role]]),
    );
  };
  const buildScanPlans = async ({ leaveTail = 0 } = {}) => {
    assert.ok(Number.isInteger(leaveTail) && leaveTail >= 0 && leaveTail <= 8, "Invalid live tail size");
    const plans = [];
    for (const role of [0, 1, 2]) {
      let start = await source.roleScanProgress(role, nonce, tags[role]);
      const total = await source.revokedRoleCount(role);
      while (total - start > BigInt(leaveTail)) {
        const end = start + 32n < total ? start + 32n : total;
        const prepared = prepareRevocationScan({ chainId, sourceAddress, role, nonce, tag: tags[role],
          start, startHash: await source.revocationCheckpoint(role, start),
          endHash: await source.revocationCheckpoint(role, end),
          secrets: Array.from(await source.getRevokedRolePage(role, start, end - start)) });
        const before = process.hrtime.bigint();
        const result = realScan
          ? await proveProtocol({ circuit: "revocationScan", witness: prepared.witness, expectedPublicSignals: prepared.publicSignals })
          : { solidityProof: echo(prepared.publicSignals) };
        plans.push({ role, nonce, tag: tags[role], start, end, proof: result.solidityProof,
          proofMilliseconds: Number(process.hrtime.bigint() - before) / 1e6,
          proofBytes: ethers.getBytes(result.solidityProof).length,
          nodeRssBytesAfterProof: process.memoryUsage().rss });
        start = end;
      }
    }
    return plans;
  };
  const submitScanPlans = async plans => {
    const rows = [];
    for (const plan of plans) {
      const previous = await source.roleScanProgress(plan.role, plan.nonce, plan.tag);
      const receipt = await mined(source.prepareRoleScan(plan.role, plan.nonce, plan.tag,
        plan.start, plan.end, plan.proof));
      rows.push({ role: plan.role, start: String(plan.start), end: String(plan.end),
        proofMilliseconds: plan.proofMilliseconds, proofBytes: plan.proofBytes,
        nodeRssBytesAfterProof: plan.nodeRssBytesAfterProof,
        gasUsed: String(receipt.gasUsed), transactionHash: receipt.hash,
        newProgressStorageWords: previous === 0n ? 1 : 0,
        updatedProgressStorageWords: previous === 0n ? 0 : 1 });
    }
    return rows;
  };
  const prepareStatus = async options => submitScanPlans(await buildScanPlans(options));
  return {
    source,
    registry,
    family,
    pools,
    seedTo,
    buildScanPlans,
    submitScanPlans,
    prepareStatus,
    scanVerifier,
    realScan,
    targetSecrets,
    revokeTarget,
    nonce,
    tags,
    token,
    code,
    capability,
    codeProof,
    capabilityProof,
    lineage,
    verifier,
    boundaryVerifier,
    refreshOperations,
    endorser,
    manager,
    familyAddress,
    chainId,
  };
}
