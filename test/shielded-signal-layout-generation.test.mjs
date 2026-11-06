import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "mocha";
import {
  DEFAULT_SHIELDED_SIGNAL_LAYOUT,
  synchronizeShieldedSignalLayout,
  verifyShieldedCircuitLayouts,
} from "../scripts/generate-shielded-signal-layout.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const CORE = "contracts/shielded/ShieldedPoolCore.sol";
const CONSTANTS = "contracts/libraries/ProofConstants.sol";
const FUND = "circuits/shielded/shielded_fund.circom";
const SHIELD = "circuits/shielded/shielded_shield.circom";
const ADAPTER = "contracts/adapters/Groth16VerifierAdapter.sol";

describe("Shielded public-signal layout generation", function () {
  this.timeout(15_000);
  let root;

  beforeEach(async function () {
    root = await fs.mkdtemp(path.join(os.tmpdir(), "deepfamily-signal-layout-"));
    for (const file of [CORE, CONSTANTS, ADAPTER]) {
      await fs.mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await fs.copyFile(path.join(ROOT, file), path.join(root, file));
    }
    await fs.cp(path.join(ROOT, "circuits/shielded"), path.join(root, "circuits/shielded"), {
      recursive: true,
    });
  });

  afterEach(async function () {
    if (root) await fs.rm(root, { recursive: true, force: true });
  });

  async function replace(file, before, after) {
    const target = path.join(root, file);
    const source = await fs.readFile(target, "utf8");
    assert.ok(source.includes(before), `Fixture must contain ${before}`);
    await fs.writeFile(target, source.replace(before, after));
  }

  it("verifies all eight circuit layouts and regenerates deterministically", async function () {
    await synchronizeShieldedSignalLayout({ root, check: true });
    const before = await Promise.all(
      [CORE, CONSTANTS].map((file) => fs.readFile(path.join(root, file), "utf8")),
    );
    await synchronizeShieldedSignalLayout({ root });
    await synchronizeShieldedSignalLayout({ root, check: true });
    const after = await Promise.all(
      [CORE, CONSTANTS].map((file) => fs.readFile(path.join(root, file), "utf8")),
    );
    assert.deepEqual(after, before);
  });

  it("constructs shared proof fields once across all actions", async function () {
    await synchronizeShieldedSignalLayout({ root });
    const source = await fs.readFile(path.join(root, CORE), "utf8");
    const generated = source.slice(
      source.indexOf("// BEGIN GENERATED SHIELDED PUBLIC SIGNALS"),
      source.indexOf("// END GENERATED SHIELDED PUBLIC SIGNALS"),
    );
    for (const binding of [
      "signals[n++] = block.chainid;",
      "signals[n++] = uint256(uint160(address(this)));",
      "signals[n++] = data.outputCommitments[i];",
      "keccak256(data.outputCiphertexts[i])",
    ]) {
      assert.equal(generated.split(binding).length - 1, 1, `${binding} must be shared`);
    }
    assert.equal(generated.split("signals = new uint256[](").length - 1, 1);
    assert.equal(generated.split("uint256 n;").length - 1, 1);
  });

  for (const [description, mutate, message] of [
    [
      "an empty segment action set",
      (layout) => (layout.segments[0].actions = []),
      /segment.*action/u,
    ],
    [
      "an unknown segment action",
      (layout) => layout.segments[0].actions.push(999),
      /segment.*action/u,
    ],
    [
      "a duplicate segment action",
      (layout) => layout.segments[0].actions.push(layout.segments[0].actions[0]),
      /segment.*duplicate/u,
    ],
    [
      "an empty segment field list",
      (layout) => (layout.segments[0].fields = []),
      /segment.*field/u,
    ],
    [
      "an unknown segment field",
      (layout) => layout.segments[0].fields.push("unknownField"),
      /segment.*field/u,
    ],
    [
      "a duplicate field across segments",
      (layout) => layout.segments.push(structuredClone(layout.segments[0])),
      /segment.*duplicate/u,
    ],
    [
      "segment ordering that disagrees with the circuit-checked schema",
      (layout) => layout.segments[0].fields.reverse(),
      /segment.*(order|fields).*schema/u,
    ],
  ]) {
    it(`rejects ${description}`, async function () {
      const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
      mutate(layout);
      await assert.rejects(verifyShieldedCircuitLayouts({ root, layout }), message);
    });
  }

  it("rejects a hand-edited Solidity field binding without rewriting it", async function () {
    await replace(CORE, "signals[n++] = block.chainid;", "signals[n++] = block.chainid + 1;");
    const changed = await fs.readFile(path.join(root, CORE), "utf8");
    await assert.rejects(
      synchronizeShieldedSignalLayout({ root, check: true }),
      /generated output is stale/u,
    );
    assert.equal(await fs.readFile(path.join(root, CORE), "utf8"), changed);
  });

  it("rejects a hand-edited Solidity proof length", async function () {
    await replace(
      CONSTANTS,
      "SHIELDED_FUND_PUBLIC_SIGNALS_LEN = 27;",
      "SHIELDED_FUND_PUBLIC_SIGNALS_LEN = 28;",
    );
    await assert.rejects(
      synchronizeShieldedSignalLayout({ root, check: true }),
      /generated output is stale/u,
    );
  });

  it("rejects schema order drift from the actual circuit declaration", async function () {
    const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
    const fields = layout.fields[layout.actions.Fund];
    [fields[5], fields[6]] = [fields[6], fields[5]];
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root, layout }),
      /public field order differs from schema/u,
    );
  });

  it("rejects action IDs that drift from the pool's ABI enum", async function () {
    const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
    [layout.actions.Shield, layout.actions.Fund] = [layout.actions.Fund, layout.actions.Shield];
    [layout.fields[0], layout.fields[1]] = [layout.fields[1], layout.fields[0]];
    for (const variant of layout.variants) variant.action = layout.actions[variant.actionName];
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root, layout }),
      /Solidity Action enum differs from schema/u,
    );
  });

  it("rejects schema widths that disagree with the constrained circuit inputs", async function () {
    const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
    layout.widths.publicBudget = 11;
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root, layout }),
      /publicBudget width differs from schema/u,
    );
  });

  it("rejects a fixed width for variant-sized input arrays", async function () {
    const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
    layout.widths.inputRoots = 1;
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root, layout }),
      /inputRoots must use its variant input width/u,
    );
  });

  it("rejects note input fields for Shield's zero-input proof", async function () {
    const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
    layout.fields[layout.actions.Shield].push("inputRoots", "inputNullifiers");
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root, layout }),
      /Shield cannot expose note input fields/u,
    );
  });

  it("accepts a reordered public selection list when input declaration order is unchanged", async function () {
    await replace(
      FUND,
      "public [chainId, pool, fundMode, budgetKind,",
      "public [chainId, pool, budgetKind, fundMode,",
    );
    await synchronizeShieldedSignalLayout({ root, check: true });
  });

  it("rejects reordered input declarations even when the public selection list is unchanged", async function () {
    await replace(
      SHIELD,
      "signal input chainId;\n    signal input pool;",
      "signal input pool;\n    signal input chainId;",
    );
    await assert.rejects(
      synchronizeShieldedSignalLayout({ root, check: true }),
      /public field order differs from schema/u,
    );
  });

  it("rejects declaration order drift before rewriting either generated file", async function () {
    const before = await Promise.all(
      [CORE, CONSTANTS].map((file) => fs.readFile(path.join(root, file), "utf8")),
    );
    await replace(
      SHIELD,
      "signal input chainId;\n    signal input pool;",
      "signal input pool;\n    signal input chainId;",
    );
    await assert.rejects(
      synchronizeShieldedSignalLayout({ root }),
      /public field order differs from schema/u,
    );
    const after = await Promise.all(
      [CORE, CONSTANTS].map((file) => fs.readFile(path.join(root, file), "utf8")),
    );
    assert.deepEqual(after, before);
  });

  for (const slots of [1, 4]) {
    it(`rejects reordered declarations in the included ${slots}-input template`, async function () {
      const common = "circuits/shielded/common/shielded_private_transfer_common.circom";
      const reordered = "circuits/shielded/common/shielded_private_transfer_reordered.circom";
      await fs.copyFile(path.join(root, common), path.join(root, reordered));
      await replace(
        reordered,
        "signal input chainId;\n    signal input pool;",
        "signal input pool;\n    signal input chainId;",
      );
      await replace(
        `circuits/shielded/shielded_private_transfer${slots === 4 ? "_4" : ""}.circom`,
        "common/shielded_private_transfer_common.circom",
        "common/shielded_private_transfer_reordered.circom",
      );
      await assert.rejects(
        verifyShieldedCircuitLayouts({ root }),
        /public field order differs from schema/u,
      );
    });
  }

  it("accepts private inputs before public inputs without changing their public order", async function () {
    await replace(SHIELD, "    signal input ownerSecret;\n", "");
    await replace(
      SHIELD,
      "template ShieldedShield() {",
      "template ShieldedShield() {\n    signal input ownerSecret;",
    );
    await synchronizeShieldedSignalLayout({ root, check: true });
  });

  it("rejects missing fields in the public selection list", async function () {
    await replace(SHIELD, "public [chainId, pool,", "public [chainId,");
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /public fields differ from schema/u,
    );
  });

  it("rejects extra fields in the public selection list", async function () {
    await replace(SHIELD, "public [chainId, pool,", "public [ownerSecret, chainId, pool,");
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /public fields differ from schema/u,
    );
  });

  it("rejects duplicate fields in the public selection list", async function () {
    await replace(SHIELD, "public [chainId, pool,", "public [chainId, chainId, pool,");
    await assert.rejects(verifyShieldedCircuitLayouts({ root }), /duplicate public fields/u);
  });

  it("rejects a circuit width change before rewriting either generated file", async function () {
    const before = await Promise.all(
      [CORE, CONSTANTS].map((file) => fs.readFile(path.join(root, file), "utf8")),
    );
    await replace(FUND, "signal input publicBudget[10];", "signal input publicBudget[11];");
    await assert.rejects(
      synchronizeShieldedSignalLayout({ root }),
      /publicBudget width differs from schema/u,
    );
    const after = await Promise.all(
      [CORE, CONSTANTS].map((file) => fs.readFile(path.join(root, file), "utf8")),
    );
    assert.deepEqual(after, before);
  });

  it("checks parameterized single/four-input circuit widths", async function () {
    await replace(
      "circuits/shielded/shielded_private_transfer_4.circom",
      "ShieldedPrivateTransfer(4)",
      "ShieldedPrivateTransfer(1)",
    );
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /inputRoots width differs from schema/u,
    );
  });

  it("rejects a business main output omitted from the explicit public input list", async function () {
    await replace(
      FUND,
      "template ShieldedFund() {",
      "template ShieldedFund() {\n    signal output extra;\n    extra <== 0;",
    );
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /main template outputs are unsupported public signals/u,
    );
  });

  it("rejects a fixed-array verifier ABI width change", async function () {
    await replace(
      ADAPTER,
      "uint256[27] calldata publicSignals",
      "uint256[28] calldata publicSignals",
    );
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /adapter ABI width 27 differs from schema/u,
    );
  });

  it("rejects a dispatch condition that no longer selects its matching fixed-array ABI", async function () {
    await replace(ADAPTER, "if (length == 27)", "if (length == 28)");
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /adapter dispatch width 28 differs from schema/u,
    );
  });

  it("rejects an adapter branch routed to another width", async function () {
    await replace(
      ADAPTER,
      "return IGroth16Verifier27(verifier).verifyProof",
      "return IGroth16Verifier16(verifier).verifyProof",
    );
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /adapter dispatch width 27 differs from schema/u,
    );
  });

  it("rejects a changed fallback width", async function () {
    await replace(
      ADAPTER,
      "uint256[14] memory signals14;\n    for",
      "uint256[16] memory signals14;\n    for",
    );
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root }),
      /adapter fallback width differs from schema/u,
    );
  });

  it("rejects schema and circuit growth without a matching adapter ABI", async function () {
    const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
    layout.widths.publicBudget = 11;
    await replace(FUND, "signal input publicBudget[10];", "signal input publicBudget[11];");
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root, layout }),
      /adapter interface widths differ from schema/u,
    );
  });

  it("rejects schema fields without a Solidity binding", async function () {
    const layout = structuredClone(DEFAULT_SHIELDED_SIGNAL_LAYOUT);
    layout.fields[layout.actions.Shield].push("unknownField");
    await assert.rejects(
      verifyShieldedCircuitLayouts({ root, layout }),
      /unknown field unknownField/u,
    );
  });

  it("rejects missing generation markers", async function () {
    await replace(
      CORE,
      "// BEGIN GENERATED SHIELDED PUBLIC SIGNALS",
      "// REMOVED GENERATION MARKER",
    );
    await assert.rejects(
      synchronizeShieldedSignalLayout({ root, check: true }),
      /missing or duplicate generation markers/u,
    );
  });
});
