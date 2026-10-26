import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { getAddress, Interface, keccak256, ZeroAddress, toQuantity } from "ethers";
import { poseidon2 } from "poseidon-lite";
import { computeRoleStatusIndex } from "@deepfamily/protocol-core";

const CODE = "(uint256 codeAlias,uint256 commonBinding,uint256 revocationTag,uint256 nonce,uint256 ownerCommitment,uint256 viewKeyLo,uint256 viewKeyHi,uint64 expiresAt)";
const CAPABILITY = "(uint256 issuanceRoot,uint256 parentVersion,uint256 capabilityBinding,uint256 familyTag,uint256 childRoleIndex,uint256 endorsementRoleIndex,uint256 trustedRoleIndex)";
const DATA = "(uint256[] inputShardIds,uint256[] inputRoots,uint256[] inputNullifiers,uint256[2] outputCommitments,bytes[2] outputCiphertexts)";
const DEPOSIT = "(uint256 policyCommitment,uint256 budgetKey,uint64 eligibleFrom)";
const CLAIM = "(uint256 budgetKey,uint64 asOf,uint256 periodNullifier,uint256 issuanceRoot,uint256 childRoleIndex,uint256 endorsementRoleIndex,uint256 trustedRoleIndex)";
export const RECEIVE_POOL_INTERFACE = new Interface([
  `function shield(uint256 amount,${DATA} data,bytes proof) payable`,
  `function depositBudget(${CODE} code,${CAPABILITY} capability,bytes codeProof,bytes capabilityProof,${DEPOSIT} deposit,${DATA} data,bytes proof)`,
  `function claimBudget(${CLAIM} claimData,${DATA} data,bytes proof)`,
  `function transfer(${CODE} code,bytes codeProof,${DATA} data,bytes proof)`,
  `function unshield(address recipient,uint256 amount,${DATA} data,bytes proof)`,
  "function budgetRecords(uint256 key) view returns (bool exists,uint256 commonBinding,uint256 policyCommitment,uint64 eligibleFrom,uint256 codeAlias,uint256 nonce,uint256 ownerCommitment,uint256 viewKeyLo,uint256 viewKeyHi)",
  "event NoteAppended(uint256 indexed shardId,uint256 indexed leafIndex,uint256 commitment,uint256 root,bytes ciphertext)",
  "event NullifierSpent(uint256 nullifier)",
  "event ActionExecuted(uint8 action,uint256 inputShardId0,uint256 inputShardId1)",
  "event BudgetDeposited(uint256 indexed budgetKey,uint256 indexed codeBinding,bool created)",
]);
const SOURCE_INTERFACE = new Interface([
  "function publishFact(uint256 childIdentity,uint256 parentIdentity,address endorser,uint256 parentVersion,uint256 factLeaf,uint256 childRoleCommitment,uint256 endorsementRoleCommitment,bytes proof)",
  "function publishTrust(uint256 parentIdentity,address endorser,uint256 parentVersion,uint256 trustLeaf,uint256 trustRoleCommitment,bytes proof)",
  "function isRoleRevoked(uint8 role,uint256 roleIndex) view returns (bool)",
  "event SourceLeafPublished(uint8 indexed treeId,uint256 indexed leafIndex,uint256 leaf,uint256 root)",
  "event RoleRegistered(uint8 indexed role,uint256 indexed commitment)",
  "event RoleRevoked(uint8 indexed role,uint256 secret,uint256 indexed commitment)",
]);
const REGISTRY_INTERFACE = new Interface([
  "function registerCredential(uint256 credential,uint256 sourceRoot,uint256 trustedRoot,bytes proof)",
  "event CredentialIssued(uint256 indexed leafIndex,uint256 credential,uint256 root)",
]);
const FAMILY_INTERFACE = new Interface(["function revokeEligibilityRoles(uint8[] roles,uint256[] secrets)"]);
const LETTER_INTERFACE = new Interface([
  `function registerLetter(uint128 messageId,${CODE} code,bytes codeProof,bytes ciphertext)`,
  "event LetterRegistered(uint128 indexed messageId,uint256 indexed commonBinding,address indexed sender,(bytes32 payloadHash,address pointer,uint64 payloadLength,uint32 segmentCount) blob)",
]);
const REJECTION_INTERFACE = new Interface([
  "error QualificationRevoked(uint8 role)",
  "error InvalidProof()",
  "error InvalidZKProof()",
]);
const HASH = /^0x[0-9a-f]{64}$/u;
const DECIMAL = /^(?:0|[1-9][0-9]*)$/u;
const ROLES = ["child", "endorsement", "trusted"];
const proofHash = (value) => createHash("sha256").update(Buffer.from(value.slice(2), "hex")).digest("hex");
export const RECEIVE_PROTOCOL_REQUIRED_ACTIONS = Object.freeze([
  "sourceFact", "sourceTrust", "issue", "revokeRole", "shield", "fund", "append", "claim",
  "transfer", "letter", "unshield", "unshield4",
]);
export const RECEIVE_PROTOCOL_CHECKS = Object.freeze([
  "offlinePayer", "notesRecovered", "sameCodeAppends", "crossCodeIndependent",
  "nativeAndToken", "ordinaryReceivingAfterRevocation",
]);
const ACTIONS = Object.freeze({
  sourceFact: [SOURCE_INTERFACE, "publishFact", "eligibilitySource"],
  sourceTrust: [SOURCE_INTERFACE, "publishTrust", "eligibilitySource"],
  issue: [REGISTRY_INTERFACE, "registerCredential", "receiveRegistry"],
  revokeRole: [FAMILY_INTERFACE, "revokeEligibilityRoles", "deepFamily"],
  shield: [RECEIVE_POOL_INTERFACE, "shield", null, 0],
  fund: [RECEIVE_POOL_INTERFACE, "depositBudget", null, 1],
  append: [RECEIVE_POOL_INTERFACE, "depositBudget", null, 1],
  claim: [RECEIVE_POOL_INTERFACE, "claimBudget", null, 2],
  transfer: [RECEIVE_POOL_INTERFACE, "transfer", null, 3],
  letter: [LETTER_INTERFACE, "registerLetter", "letterArchive"],
  unshield: [RECEIVE_POOL_INTERFACE, "unshield", null, 4],
  unshield4: [RECEIVE_POOL_INTERFACE, "unshield", null, 4],
});
function address(value, label) {
  let result;
  try { result = getAddress(value); } catch { throw new Error(`${label} must be an EVM address`); }
  assert.notEqual(result, ZeroAddress, `${label} cannot be zero`);
  return result;
}
function hash(value, label) {
  assert.equal(typeof value, "string", `${label} must be a hash`);
  const result = value.toLowerCase();
  assert.match(result, HASH, `${label} must be a 32-byte hash`);
  return result;
}
function decimal(value, label) {
  assert.equal(typeof value, "string", `${label} must be a canonical decimal string`);
  assert.match(value, DECIMAL, `${label} must be a canonical decimal string`);
  return value;
}
async function chain(provider, expected) {
  const chainId = BigInt(expected);
  assert.ok(chainId > 0n && chainId <= BigInt(Number.MAX_SAFE_INTEGER), "Expected a safe chain ID");
  const [raw, network] = await Promise.all([provider.send("eth_chainId", []), provider.getNetwork()]);
  assert.equal(BigInt(raw), chainId, "Receive evidence raw RPC chain ID differs");
  assert.equal(BigInt(network.chainId), chainId, "Receive evidence provider chain ID differs");
  return chainId;
}
async function canonicalBlock(provider, number, expectedHash) {
  assert.ok(Number.isSafeInteger(number) && number >= 0, "Invalid receive evidence block number");
  const block = await provider.getBlock(number);
  assert.ok(block, "Receive evidence block is missing");
  assert.equal(block.number, number, "Receive evidence block number differs");
  assert.equal(hash(block.hash, "block hash"), hash(expectedHash, "expected block hash"), "Receive evidence block is not canonical");
  return block;
}
function logs(receipt, iface, target, event) {
  return receipt.logs.flatMap((log) => {
    if (address(log.address, "log address") !== target) return [];
    try {
      const parsed = iface.parseLog(log);
      return parsed?.name === event ? [parsed.args] : [];
    } catch { return []; }
  });
}
function oneLog(receipt, iface, target, event) {
  const values = logs(receipt, iface, target, event);
  assert.equal(values.length, 1, `Expected exactly one ${event} event`);
  return values[0];
}
const roleIndices = (value) => [value.childRoleIndex, value.endorsementRoleIndex, value.trustedRoleIndex].map(String);
async function budgetAt(provider, pool, key, blockNumber) {
  const raw = await provider.send("eth_call", [{ to: pool, data: RECEIVE_POOL_INTERFACE.encodeFunctionData("budgetRecords", [key]) }, toQuantity(blockNumber)]);
  const record = RECEIVE_POOL_INTERFACE.decodeFunctionResult("budgetRecords", raw);
  return { exists: record.exists, commonBinding: String(record.commonBinding), policyCommitment: String(record.policyCommitment), eligibleFrom: String(record.eligibleFrom) };
}
async function roleAt(provider, source, role, index, blockNumber) {
  const raw = await provider.send("eth_call", [{ to: source, data: SOURCE_INTERFACE.encodeFunctionData("isRoleRevoked", [role, index]) }, toQuantity(blockNumber)]);
  return SOURCE_INTERFACE.decodeFunctionResult("isRoleRevoked", raw)[0];
}
function poolPublicInput(parsed, data) {
  const value = {
    inputNullifiers: data.inputNullifiers.map(String),
    outputCommitments: data.outputCommitments.map(String),
    ciphertextHashes: data.outputCiphertexts.map(keccak256),
  };
  if (parsed.name === "depositBudget") Object.assign(value, {
    commonBinding: String(parsed.args.code.commonBinding),
    budgetKey: String(parsed.args.deposit.budgetKey),
    eligibleFrom: String(parsed.args.deposit.eligibleFrom),
    policyCommitment: String(parsed.args.deposit.policyCommitment),
    issuanceRoot: String(parsed.args.capability.issuanceRoot),
    roleIndices: roleIndices(parsed.args.capability),
  });
  if (parsed.name === "claimBudget") Object.assign(value, {
    budgetKey: String(parsed.args.claimData.budgetKey),
    periodNullifier: String(parsed.args.claimData.periodNullifier),
    issuanceRoot: String(parsed.args.claimData.issuanceRoot),
    roleIndices: roleIndices(parsed.args.claimData),
  });
  if (parsed.name === "transfer") value.commonBinding = String(parsed.args.code.commonBinding);
  if (parsed.name === "shield" || parsed.name === "unshield") value.amount = String(parsed.args.amount);
  if (parsed.name === "unshield") value.recipient = getAddress(parsed.args.recipient);
  return value;
}

/** Independently observes successful transactions, canonical inclusion, calldata and emitted effects. */
export async function verifyReceiveProtocolReceipts({ provider, expectedChainId, addresses, transactions }) {
  const chainId = await chain(provider, expectedChainId);
  assert.ok(Array.isArray(transactions) && transactions.length > 0, "Receive transactions are required");
  const observed = {}, hashes = new Set();
  for (const entry of transactions) {
    assert.ok(typeof entry.label === "string" && entry.label.length > 0, "Receive transaction label is required");
    assert.ok(!Object.hasOwn(observed, entry.label), "Duplicate receive transaction label");
    const spec = ACTIONS[entry.action];
    assert.ok(spec, `Unknown receive transaction action: ${entry.action}`);
    const [iface, method, scope, ordinal] = spec;
    if (!scope) assert.ok(["native", "erc20"].includes(entry.asset), "Pool receipt requires an asset");
    const target = address(addresses[scope ?? (entry.asset === "native" ? "shieldedNativePool" : "shieldedErc20Pool")], "receive target");
    const txHash = hash(entry.hash, "receive transaction hash");
    assert.ok(!hashes.has(txHash), "Receive evidence repeats a transaction hash");
    hashes.add(txHash);
    const [transaction, receipt, code] = await Promise.all([provider.getTransaction(txHash), provider.getTransactionReceipt(txHash), provider.getCode(target)]);
    assert.ok(transaction && receipt, "Receive transaction or receipt is missing");
    assert.notEqual(code, "0x", "Receive transaction target has no code");
    assert.equal(hash(transaction.hash, "transaction hash"), txHash, "Receive RPC transaction hash differs");
    assert.equal(hash(receipt.hash, "receipt hash"), txHash, "Receive RPC receipt hash differs");
    assert.equal(BigInt(transaction.chainId), chainId, "Receive transaction chain ID differs");
    assert.equal(receipt.status, 1, "Receive transaction did not succeed");
    assert.equal(address(transaction.to, "transaction target"), target, "Receive transaction target differs");
    assert.equal(address(receipt.to, "receipt target"), target, "Receive receipt target differs");
    assert.equal(transaction.blockNumber, receipt.blockNumber, "Receive transaction inclusion number differs");
    assert.equal(hash(transaction.blockHash, "transaction block hash"), hash(receipt.blockHash, "receipt block hash"), "Receive transaction inclusion hash differs");
    const block = await canonicalBlock(provider, receipt.blockNumber, receipt.blockHash);
    const gasUsed = BigInt(receipt.gasUsed), gasLimit = BigInt(transaction.gasLimit), blockLimit = BigInt(block.gasLimit);
    assert.ok(gasUsed > 0n && gasUsed <= gasLimit && gasLimit <= blockLimit, "Receive transaction gas exceeds its transaction or block limit");
    const parsed = iface.parseTransaction({ data: transaction.data, value: transaction.value ?? 0n });
    assert.equal(parsed?.name, method, "Receive transaction method differs");
    let publicInput;
    const proofHashes = {};
    if (ordinal !== undefined) {
      const data = parsed.args.data;
      const expectedInputs = entry.action === "shield" ? 0 : entry.action === "unshield4" ? 4 : 1;
      assert.equal(data.inputNullifiers.length, expectedInputs, "Receive input capacity differs");
      assert.equal(Number(oneLog(receipt, iface, target, "ActionExecuted").action), ordinal, "Receive ledger action differs");
      const outputs = logs(receipt, iface, target, "NoteAppended");
      assert.equal(outputs.length, 2, "Receive action must append two authenticated outputs");
      for (const [index, output] of outputs.entries()) {
        assert.equal(output.commitment, data.outputCommitments[index], "Receive output commitment differs from calldata");
        assert.equal(output.ciphertext.toLowerCase(), data.outputCiphertexts[index].toLowerCase(), "Receive ciphertext differs from calldata");
      }
      const nullifiers = [...data.inputNullifiers];
      if (entry.action === "claim") nullifiers.push(parsed.args.claimData.periodNullifier);
      assert.deepEqual(logs(receipt, iface, target, "NullifierSpent").map((event) => String(event.nullifier)), nullifiers.map(String), "Receive consumed nullifiers differ from calldata");
      publicInput = poolPublicInput(parsed, data);
      proofHashes[entry.action === "append" ? "fund" : entry.action] = proofHash(parsed.args.proof);
      if (["fund", "append", "transfer"].includes(entry.action)) proofHashes.code = proofHash(parsed.args.codeProof);
      if (["fund", "append"].includes(entry.action)) proofHashes.capability = proofHash(parsed.args.capabilityProof);
      if (["fund", "append"].includes(entry.action)) {
        const deposited = oneLog(receipt, iface, target, "BudgetDeposited");
        assert.equal(String(deposited.budgetKey), publicInput.budgetKey, "Receive deposited budget differs");
        assert.equal(String(deposited.codeBinding), publicInput.commonBinding, "Receive deposited code differs");
        assert.equal(deposited.created, entry.action === "fund", "Receive first/append classification differs");
        publicInput.created = deposited.created;
      }
      if (["fund", "append", "claim"].includes(entry.action)) {
        const record = await budgetAt(provider, target, publicInput.budgetKey, receipt.blockNumber);
        assert.equal(record.exists, true, "Receive budget record is missing after execution");
        if (entry.action !== "claim") {
          assert.equal(record.commonBinding, publicInput.commonBinding, "Receive budget code binding differs");
          assert.equal(record.policyCommitment, publicInput.policyCommitment, "Receive budget policy differs");
          assert.equal(record.eligibleFrom, publicInput.eligibleFrom, "Receive budget eligibility clock differs");
        } else Object.assign(publicInput, record);
      }
    } else if (entry.action === "sourceFact" || entry.action === "sourceTrust") {
      const fact = entry.action === "sourceFact";
      const published = oneLog(receipt, SOURCE_INTERFACE, target, "SourceLeafPublished");
      assert.equal(Number(published.treeId), fact ? 0 : 1, "Receive source tree differs");
      assert.equal(published.leaf, fact ? parsed.args.factLeaf : parsed.args.trustLeaf, "Receive source leaf differs");
      const registered = logs(receipt, SOURCE_INTERFACE, target, "RoleRegistered");
      const expectedRoles = fact ? [0, 1] : [2];
      const commitments = fact ? [parsed.args.childRoleCommitment, parsed.args.endorsementRoleCommitment] : [parsed.args.trustRoleCommitment];
      assert.deepEqual(registered.map((event) => Number(event.role)), expectedRoles, "Receive source registered roles differ");
      assert.deepEqual(registered.map((event) => String(event.commitment)), commitments.map(String), "Receive source registered commitments differ");
      publicInput = { treeId: Number(published.treeId), leafIndex: String(published.leafIndex), leaf: String(published.leaf), root: String(published.root), roleCommitments: commitments.map(String) };
      proofHashes[entry.action] = proofHash(parsed.args.proof);
    } else if (entry.action === "issue") {
      const issued = oneLog(receipt, iface, target, "CredentialIssued");
      assert.equal(issued.credential, parsed.args.credential, "Receive issued credential differs");
      publicInput = { credential: String(issued.credential), leafIndex: String(issued.leafIndex), issuanceRoot: String(issued.root), sourceRoot: String(parsed.args.sourceRoot), trustedRoot: String(parsed.args.trustedRoot) };
      proofHashes.issue = proofHash(parsed.args.proof);
    } else if (entry.action === "revokeRole") {
      const source = address(addresses.eligibilitySource, "eligibility source");
      const revoked = logs(receipt, SOURCE_INTERFACE, source, "RoleRevoked");
      assert.equal(revoked.length, parsed.args.roles.length, "Receive revoked role count differs");
      assert.equal(parsed.args.roles.length, parsed.args.secrets.length, "Receive revocation arity differs");
      const indices = [];
      for (const [index, event] of revoked.entries()) {
        const role = Number(parsed.args.roles[index]);
        assert.ok(role >= 0 && role <= 2, "Receive revocation role is invalid");
        assert.equal(Number(event.role), role, "Receive revoked role differs");
        assert.equal(event.secret, parsed.args.secrets[index], "Receive revoked opening differs");
        assert.equal(event.commitment, poseidon2([74201n + BigInt(role), event.secret]), "Receive revoked commitment differs");
        indices.push(String(computeRoleStatusIndex({ role: ROLES[role], roleSecret: event.secret })));
      }
      publicInput = { roles: parsed.args.roles.map(Number), roleIndices: indices };
    } else {
      const registered = oneLog(receipt, iface, target, "LetterRegistered");
      assert.equal(registered.messageId, parsed.args.messageId, "Receive letter message differs");
      assert.equal(registered.commonBinding, parsed.args.code.commonBinding, "Receive letter code differs");
      assert.equal(getAddress(registered.sender), address(transaction.from, "letter sender"), "Receive letter sender differs");
      assert.equal(registered.blob.payloadHash, keccak256(parsed.args.ciphertext), "Receive letter payload differs");
      publicInput = { messageId: String(registered.messageId), commonBinding: String(registered.commonBinding), ciphertextHash: registered.blob.payloadHash };
      proofHashes.code = proofHash(parsed.args.codeProof);
    }
    observed[entry.label] = { action: entry.action, ...(scope ? {} : { asset: entry.asset }), targetAddress: target, txHash, blockNumber: receipt.blockNumber, blockHash: receipt.blockHash.toLowerCase(), selector: transaction.data.slice(0, 10).toLowerCase(), gasUsed: String(gasUsed), transactionGasLimit: String(gasLimit), blockGasLimit: String(blockLimit), data: transaction.data, calldataHash: keccak256(transaction.data), proofHashes, publicInput };
  }
  return { schema: "deepfamily/receive-protocol-receipts@1", chainId: Number(chainId), rpcChecks: "passed", transactions: observed };
}

function failureData(error) {
  for (const value of [error?.data, error?.error?.data, error?.info?.error?.data]) {
    if (typeof value === "string") return value;
    if (typeof value?.data === "string") return value.data;
  }
  throw new Error("Rejected receive call did not return authenticated revert data");
}

/** Replays failed public calls at their exact canonical block; no signing or broadcast occurs. */
export async function verifyReceiveProtocolRejections({ provider, expectedChainId, addresses, roleRevocations }) {
  await chain(provider, expectedChainId);
  const source = address(addresses.eligibilitySource, "eligibility source");
  const allowedPools = [addresses.shieldedNativePool, addresses.shieldedErc20Pool].map((value) => address(value, "receive pool"));
  const verified = [];
  for (const entry of roleRevocations) {
    assert.ok([0, 1, 2].includes(entry.role), "Receive revocation role is invalid");
    decimal(String(entry.roleIndex), "revoked role index");
    decimal(String(entry.otherRoleIndex), "other role index");
    assert.notEqual(String(entry.roleIndex), String(entry.otherRoleIndex), "Substitution must use a different role index");
    const rejections = [];
    for (const rejection of entry.rejections) {
      assert.ok(["first", "append", "claim"].includes(rejection.operation), "Unknown rejected receive operation");
      assert.ok(["revoked", "index-substitution", "credential-substitution"].includes(rejection.kind), "Unknown rejected receive substitution");
      await canonicalBlock(provider, rejection.blockNumber, rejection.blockHash);
      assert.equal(await roleAt(provider, source, entry.role, entry.roleIndex, rejection.blockNumber), true, "Rejected receive role was not revoked at the observation block");
      assert.equal(await roleAt(provider, source, entry.role, entry.otherRoleIndex, rejection.blockNumber), false, "Substitution did not use a currently valid role index");
      const to = address(rejection.to, "rejected receive target"), from = address(rejection.from, "rejected receive sender");
      assert.ok(allowedPools.includes(to), "Rejected receive target is not a selected pool");
      const parsed = RECEIVE_POOL_INTERFACE.parseTransaction({ data: rejection.data });
      assert.equal(parsed?.name, rejection.operation === "claim" ? "claimBudget" : "depositBudget", "Rejected receive method differs");
      const expectedError = rejection.kind === "revoked" ? "QualificationRevoked" : rejection.operation === "claim" ? "InvalidZKProof" : "InvalidProof";
      assert.equal(rejection.errorName, expectedError, "Rejected receive error classification differs");
      let error;
      try { await provider.send("eth_call", [{ to, from, data: rejection.data }, toQuantity(rejection.blockNumber)]); } catch (failure) { error = failure; }
      assert.ok(error, "Rejected receive call unexpectedly succeeded during RPC replay");
      const decoded = REJECTION_INTERFACE.parseError(failureData(error));
      assert.equal(decoded?.name, expectedError, "Rejected receive RPC error differs");
      const expectedArgs = expectedError === "QualificationRevoked" ? [String(entry.role)] : [];
      assert.deepEqual(decoded.args.map(String), expectedArgs, "Rejected receive RPC error arguments differ");
      assert.deepEqual(rejection.errorArgs.map(String), expectedArgs, "Rejected receive recorded error arguments differ");
      const publicInput = poolPublicInput(parsed, parsed.args.data);
      const record = await budgetAt(provider, to, publicInput.budgetKey, rejection.blockNumber);
      assert.equal(record.exists, rejection.operation !== "first", "Rejected first/append/claim budget state differs");
      if (rejection.operation === "claim") publicInput.commonBinding = record.commonBinding;
      const expectedIndex = rejection.kind === "revoked" ? entry.roleIndex : entry.otherRoleIndex;
      assert.equal(publicInput.roleIndices[entry.role], String(expectedIndex), "Rejected receive calldata does not contain the tested role index");
      rejections.push({ ...rejection, to, from, rpcChecks: "passed", calldataHash: keccak256(rejection.data), publicInput: { ...publicInput, budgetExists: record.exists } });
    }
    verified.push({ ...entry, roleIndex: String(entry.roleIndex), otherRoleIndex: String(entry.otherRoleIndex), rejections });
  }
  return verified;
}

/** Offline checks bind each RPC observation to the globally finalized transaction records. */
export function requireReceiveProtocolExecutionEvidence({ evidence, addresses, transactions, expectedChainId, fundMaxGas }) {
  assert.equal(evidence.schemaVersion, 1, "receiveProtocol.schemaVersion must be 1");
  assert.equal(evidence.status, "passed", "receiveProtocol.status must be passed");
  assert.equal(String(evidence.chainId), String(expectedChainId), "receiveProtocol.chainId differs");
  for (const name of RECEIVE_PROTOCOL_CHECKS) assert.equal(evidence.checks?.[name], true, `receiveProtocol.checks.${name} must be true`);
  const receipts = evidence.receipts;
  assert.equal(receipts?.schema, "deepfamily/receive-protocol-receipts@1", "receiveProtocol.receipts.schema differs");
  assert.equal(receipts.rpcChecks, "passed", "receiveProtocol.receipts.rpcChecks must pass");
  assert.equal(String(receipts.chainId), String(expectedChainId), "receiveProtocol.receipts.chainId differs");
  const entries = Object.entries(receipts.transactions), seen = new Set();
  for (const [label, observation] of entries) {
    const spec = ACTIONS[observation.action];
    assert.ok(spec, `receiveProtocol.receipts.${label} has an unknown action`);
    const [, method, scope] = spec;
    const target = address(addresses[scope ?? (observation.asset === "native" ? "shieldedNativePool" : "shieldedErc20Pool")], "receive receipt target");
    if (!scope) assert.ok(["native", "erc20"].includes(observation.asset), "receiveProtocol receipt asset differs");
    assert.equal(address(observation.targetAddress, "observed receive target"), target, "receiveProtocol receipt target differs");
    assert.equal(observation.selector, spec[0].getFunction(method).selector, "receiveProtocol receipt selector differs");
    assert.equal(keccak256(observation.data), observation.calldataHash, "receiveProtocol receipt calldata hash differs");
    const parsed = spec[0].parseTransaction({ data: observation.data });
    assert.equal(parsed?.name, method, "receiveProtocol receipt calldata method differs");
    const expectedProofHashes = {};
    if (spec[3] !== undefined) {
      const decoded = poolPublicInput(parsed, parsed.args.data);
      for (const [field, value] of Object.entries(decoded)) assert.deepEqual(observation.publicInput[field], value, `receiveProtocol receipt calldata ${field} differs`);
      expectedProofHashes[observation.action === "append" ? "fund" : observation.action] = proofHash(parsed.args.proof);
      if (["fund", "append", "transfer"].includes(observation.action)) expectedProofHashes.code = proofHash(parsed.args.codeProof);
      if (["fund", "append"].includes(observation.action)) {
        expectedProofHashes.capability = proofHash(parsed.args.capabilityProof);
        assert.equal(observation.publicInput.created, observation.action === "fund", "receiveProtocol receipt first/append classification differs");
      }
    } else if (["sourceFact", "sourceTrust", "issue"].includes(observation.action)) {
      expectedProofHashes[observation.action] = proofHash(parsed.args.proof);
      if (observation.action === "issue") {
        for (const field of ["credential", "sourceRoot", "trustedRoot"]) assert.equal(observation.publicInput[field], String(parsed.args[field]), `receiveProtocol receipt calldata ${field} differs`);
      } else {
        assert.equal(observation.publicInput.leaf, String(observation.action === "sourceFact" ? parsed.args.factLeaf : parsed.args.trustLeaf), "receiveProtocol receipt calldata source leaf differs");
        assert.deepEqual(observation.publicInput.roleCommitments, observation.action === "sourceFact" ? [parsed.args.childRoleCommitment,parsed.args.endorsementRoleCommitment].map(String) : [String(parsed.args.trustRoleCommitment)], "receiveProtocol receipt calldata source roles differ");
      }
    } else if (observation.action === "revokeRole") {
      assert.deepEqual(observation.publicInput.roles, parsed.args.roles.map(Number), "receiveProtocol receipt calldata revoked roles differ");
      assert.deepEqual(observation.publicInput.roleIndices, parsed.args.roles.map((role,index) => String(computeRoleStatusIndex({role:ROLES[Number(role)],roleSecret:parsed.args.secrets[index]}))), "receiveProtocol receipt calldata revoked indices differ");
    } else {
      expectedProofHashes.code = proofHash(parsed.args.codeProof);
      assert.equal(observation.publicInput.messageId, String(parsed.args.messageId), "receiveProtocol receipt calldata letter ID differs");
      assert.equal(observation.publicInput.commonBinding, String(parsed.args.code.commonBinding), "receiveProtocol receipt calldata letter code differs");
      assert.equal(observation.publicInput.ciphertextHash, keccak256(parsed.args.ciphertext), "receiveProtocol receipt calldata letter payload differs");
    }
    assert.deepEqual(observation.proofHashes, expectedProofHashes, "receiveProtocol receipt proof hashes differ from calldata");
    const recorded = transactions[label];
    assert.ok(recorded, `receiveProtocol transaction ${label} is missing from finality records`);
    assert.equal(recorded.status, 1, `receiveProtocol transaction ${label} did not succeed`);
    assert.equal(hash(observation.txHash, "observed receive hash"), hash(recorded.hash, "recorded receive hash"), "receiveProtocol transaction hash differs");
    assert.ok(!seen.has(observation.txHash), "receiveProtocol repeats a transaction hash");
    seen.add(observation.txHash);
    assert.equal(observation.blockNumber, recorded.blockNumber, "receiveProtocol inclusion block number differs");
    assert.equal(hash(observation.blockHash, "observed receive block"), hash(recorded.blockHash, "recorded receive block"), "receiveProtocol inclusion block hash differs");
    hash(observation.calldataHash, "receive calldata hash");
    const used = BigInt(decimal(observation.gasUsed, "receive gasUsed")), limit = BigInt(decimal(observation.transactionGasLimit, "receive transactionGasLimit")), blockLimit = BigInt(decimal(observation.blockGasLimit, "receive blockGasLimit"));
    assert.ok(used > 0n && used <= limit && limit <= blockLimit, "receiveProtocol gas exceeds transaction or block limit");
    if (["fund", "append"].includes(observation.action) && fundMaxGas !== undefined) assert.ok(used <= BigInt(fundMaxGas), "receiveProtocol deposit exceeds the committed gas threshold");
    if (recorded.gasUsed !== undefined) assert.equal(String(recorded.gasUsed), observation.gasUsed, "receiveProtocol recorded gas differs");
    assert.ok(observation.publicInput && typeof observation.publicInput === "object", "receiveProtocol public inputs are missing");
  }
  for (const action of RECEIVE_PROTOCOL_REQUIRED_ACTIONS) assert.ok(entries.some(([, item]) => item.action === action), `receiveProtocol is missing executed ${action}`);
  for (const asset of ["native", "erc20"]) for (const action of ["shield", "fund", "append", "claim"]) assert.ok(entries.some(([, item]) => item.action === action && item.asset === asset), `receiveProtocol is missing ${asset} ${action}`);
  assert.deepEqual(evidence.roleRevocations?.map((item) => item.role).sort(), [0, 1, 2], "receiveProtocol must cover three distinct revoked roles");
  assert.equal(evidence.reissues?.length, 3, "receiveProtocol must preserve all three reissuance steps");
  let previousCredential, previousRoleIndices;
  for (const role of [0, 1, 2]) {
    const revoked = evidence.roleRevocations.find((item) => item.role === role), reissue = evidence.reissues.find((item) => item.role === role);
    const revocation = receipts.transactions[revoked.transactionLabel];
    assert.equal(revocation?.action, "revokeRole", "receiveProtocol revocation transaction is missing");
    const index = revocation.publicInput.roles.indexOf(role);
    assert.ok(index >= 0, "receiveProtocol revocation transaction does not revoke the tested role");
    assert.equal(revocation.publicInput.roleIndices[index], revoked.roleIndex, "receiveProtocol revoked role index differs");
    const matrix = new Set(), bindings = new Set();
    for (const item of revoked.rejections) {
      assert.equal(item.rpcChecks, "passed", "receiveProtocol rejection was not replayed over RPC");
      assert.ok(item.blockNumber >= revocation.blockNumber, "receiveProtocol rejection predates revocation");
      hash(item.blockHash, "receive rejection block hash");
      assert.equal(keccak256(item.data), item.calldataHash, "receiveProtocol rejected calldata hash differs");
      const parsedCall = RECEIVE_POOL_INTERFACE.parseTransaction({ data: item.data });
      assert.equal(parsedCall?.name, item.operation === "claim" ? "claimBudget" : "depositBudget", "receiveProtocol rejected calldata method differs");
      const decodedInput = poolPublicInput(parsedCall, parsedCall.args.data);
      for (const field of ["budgetKey", "roleIndices", "inputNullifiers", "outputCommitments", "ciphertextHashes"])
        assert.deepEqual(item.publicInput[field], decodedInput[field], `receiveProtocol rejected calldata ${field} differs`);
      if (item.operation !== "claim") assert.equal(item.publicInput.commonBinding, decodedInput.commonBinding, "receiveProtocol rejected calldata code binding differs");
      const expectedError = item.kind === "revoked" ? "QualificationRevoked" : item.operation === "claim" ? "InvalidZKProof" : "InvalidProof";
      assert.equal(item.errorName, expectedError, "receiveProtocol rejection error differs");
      assert.deepEqual(item.errorArgs.map(String), item.kind === "revoked" ? [String(role)] : [], "receiveProtocol rejection role differs");
      const binding = decimal(item.publicInput.commonBinding, "receive rejected code binding");
      bindings.add(binding);
      const key = `${binding}:${item.operation}:${item.kind}`;
      assert.ok(!matrix.has(key), "receiveProtocol repeats a rejection matrix entry");
      matrix.add(key);
      assert.equal(item.publicInput.budgetExists, item.operation !== "first", "receiveProtocol rejection does not test the declared budget state");
      assert.equal(item.publicInput.roleIndices[role], item.kind === "revoked" ? revoked.roleIndex : revoked.otherRoleIndex, "receiveProtocol rejected role index differs");
    }
    assert.equal(bindings.size, 2, "receiveProtocol rejection matrix must cover two codes");
    for (const binding of bindings) for (const operation of ["first", "append", "claim"]) for (const kind of ["revoked", "index-substitution", "credential-substitution"]) assert.ok(matrix.has(`${binding}:${operation}:${kind}`), `receiveProtocol role ${role} lacks ${operation}/${kind}`);
    const other = receipts.transactions[revoked.otherAppendTransactionLabel ?? `receive-native-other-append-${role}`];
    assert.equal(other?.action, "append", "receiveProtocol needs an actual deposit by the other valid qualification after each revocation");
    assert.ok(other.blockNumber >= revocation.blockNumber, "receiveProtocol other qualification execution predates revocation");
    assert.equal(other.publicInput.roleIndices[role], revoked.otherRoleIndex, "receiveProtocol substitution index is not from the actually executing other qualification");
    assert.ok(!bindings.has(other.publicInput.commonBinding), "receiveProtocol other qualification must use a distinct code");
    assert.ok(entries.some(([, item]) => item.action === "issue" && item.publicInput.issuanceRoot === other.publicInput.issuanceRoot), "receiveProtocol other qualification has no observed issuance root");
    assert.ok(reissue, "receiveProtocol reissuance is missing");
    if (previousCredential !== undefined) assert.equal(reissue.oldCredential, previousCredential, "receiveProtocol reissuance chain differs");
    if (previousRoleIndices !== undefined) assert.deepEqual(reissue.oldRoleIndices, previousRoleIndices, "receiveProtocol reissuance role chain differs");
    for (const indices of [reissue.oldRoleIndices, reissue.newRoleIndices]) {
      assert.equal(indices?.length, 3, "receiveProtocol reissuance must contain three roles");
      for (const index of indices) assert.notEqual(decimal(index, "receiveProtocol reissuance role index"), "0", "receiveProtocol reissuance role index cannot be zero");
    }
    assert.notEqual(reissue.newCredential, reissue.oldCredential, "receiveProtocol reissuance did not replace the credential");
    assert.equal(reissue.oldRoleIndices[role], revoked.roleIndex, "receiveProtocol reissuance does not replace the revoked role");
    assert.ok(entries.some(([, item]) => item.action === "issue" && item.publicInput.credential === reissue.newCredential), "receiveProtocol replacement credential was not issued on chain");
    const deposited = receipts.transactions[reissue.depositTransactionLabel], claimed = receipts.transactions[reissue.claimTransactionLabel];
    assert.equal(deposited?.action, "fund", "receiveProtocol original budget deposit is missing");
    assert.equal(claimed?.action, "claim", "receiveProtocol replacement budget claim is missing");
    assert.equal(deposited.publicInput.budgetKey, reissue.originalBudgetKey, "receiveProtocol original budget key differs");
    if (role === 0) assert.deepEqual(deposited.publicInput.roleIndices, reissue.oldRoleIndices, "receiveProtocol original budget did not use the original revoked qualification");
    assert.equal(claimed.publicInput.budgetKey, reissue.originalBudgetKey, "receiveProtocol replacement did not claim the original budget");
    assert.equal(deposited.publicInput.eligibleFrom, claimed.publicInput.eligibleFrom, "receiveProtocol replacement changed the budget clock");
    assert.ok(claimed.blockNumber > revocation.blockNumber, "receiveProtocol replacement claim predates revocation");
    if (role === 2) assert.deepEqual(claimed.publicInput.roleIndices, reissue.newRoleIndices, "receiveProtocol final claim does not use the replacement roles");
    previousCredential = reissue.newCredential;
    previousRoleIndices = reissue.newRoleIndices;
  }
  return { transactionCount: entries.length, rejectionCount: evidence.roleRevocations.reduce((sum, item) => sum + item.rejections.length, 0), reissueCount: evidence.reissues.length };
}
