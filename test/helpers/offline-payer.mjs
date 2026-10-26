// Invoked in a separate process: stdin contains only the shared receive code,
// future public rule/state, and this payer's own input note/key material.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { AbiCoder, hexlify } from "ethers";
import { prepareBudgetDeposit, prepareTransfer } from "../../packages/protocol-core/budget.js";
import { proveProtocol, verifyProtocol } from "../../scripts/protocol-zk-development.mjs";

const serialize = (value) =>
  JSON.stringify(value, (_, item) =>
    typeof item === "bigint" ? String(item) : item instanceof Uint8Array ? hexlify(item) : item,
  );
const encodeProof = (proof) =>
  AbiCoder.defaultAbiCoder().encode(
    ["uint256[2]", "uint256[2][2]", "uint256[2]"],
    [
      proof.pi_a.slice(0, 2),
      proof.pi_b.slice(0, 2).map((row) => row.slice(0, 2).reverse()),
      proof.pi_c.slice(0, 2),
    ],
  );
async function main() {
  try {
    const input = JSON.parse(fs.readFileSync(0, "utf8"));
    for (const forbidden of [
      "recipientSecret",
      "derivedSecretField",
      "codeSecret",
      "ownerSecret",
      "issueNonce",
      "xChild",
      "xEndorse",
      "xTrust",
      "familySalt",
    ])
      assert.equal(Object.hasOwn(input, forbidden), false, `Payer received ${forbidden}`);
    const circuit = input.operation === "transfer" ? "transfer" : "fund";
    let witnessFields;
    const provePayment = async (witness) => {
      witnessFields = Object.keys(witness);
      for (const forbidden of [
        "derivedSecretField",
        "codeSecret",
        "ownerSecret",
        "issueNonce",
        "xChild",
        "xEndorse",
        "xTrust",
        "familySalt",
      ])
        assert.equal(Object.hasOwn(witness, forbidden), false, `Payer proof needs ${forbidden}`);
      return proveProtocol({ circuit, witness });
    };
    const shared = {
      ...input,
      verifyAuthorization: (proof, publicSignals) =>
        verifyProtocol({ circuit: "code", proof, publicSignals }),
      verifyCapability: (proof, publicSignals) =>
        verifyProtocol({ circuit: "capability", proof, publicSignals }),
    };
    const result =
      input.operation === "transfer"
        ? await prepareTransfer({ ...shared, proveTransfer: provePayment }, input.scope)
        : await prepareBudgetDeposit(
            { ...shared, readBudgetRecord: () => input.record, proveFund: provePayment },
            input.scope,
          );
    process.stdout.write(
      serialize({ ...result, proofBytes: encodeProof(result.proof), witnessFields }),
    );
  } finally {
    await globalThis.curve_bn128?.terminate?.();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
