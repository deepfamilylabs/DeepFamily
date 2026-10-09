import "../hardhat-test-setup.mjs";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { expect } from "chai";
import hre from "hardhat";
import { encodeGroth16AbcProofData, normalizeGroth16Proof } from "@deepfamily/proof-core";
import {
  buildShieldedPoolPublicInputs,
  computeShieldedCiphertextHashField,
  computeShieldedDummyInputNullifierForSlot,
  computeShieldedOwnerCommitment,
  computeShieldedSpendNullifier,
  computeShieldedValueNoteCommitment,
  deriveShieldedViewPublicKey,
  encodeShieldedValueNotePayload,
  encryptShieldedNote,
} from "@deepfamily/protocol-core";
import { deployUnifiedVerifierAdapter } from "./helpers/unifiedVerifierAdapter.mjs";

describe("development-key real proofs for eight-input VALUE routes", function () {
  this.timeout(600_000);
  it("transfers eight real inputs, withdraws with the eight-slot key and prevents cross-capacity replay", async () => {
    const manifest = JSON.parse(
      fs.readFileSync("circuits/shielded-development-manifest.json", "utf8"),
    );
    assert.equal(manifest.developmentOnly, true);
    assert.equal(manifest.productionReady, false);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "deepfamily-value-eight-real-"));
    try {
      const generated = {};
      for (const action of ["shield", "privateTransfer", "privateTransfer8", "unshield8"]) {
        const contract = action[0].toUpperCase() + action.slice(1);
        generated[action] = await hre.ethers.deployContract(`Shielded${contract}Verifier`);
      }
      const adapter = await deployUnifiedVerifierAdapter(hre, generated);
      const token = await hre.ethers.deployContract("ShieldedPoolTokenMock");
      const lineage = await hre.ethers.deployContract("ShieldedPoolLineageMock");
      const poseidon = await hre.ethers.deployContract("PoseidonT3");
      const Pool = await hre.ethers.getContractFactory("ShieldedErc20Pool", {
        libraries: { PoseidonT3: await poseidon.getAddress() },
      });
      const pool = await Pool.deploy(
        await token.getAddress(),
        await lineage.getAddress(),
        await adapter.getAddress(),
      );
      const [signer, recipient] = await hre.ethers.getSigners();
      const scope = {
        chainId: (await hre.ethers.provider.getNetwork()).chainId,
        poolAddress: await pool.getAddress(),
      };
      const secret = 7001n;
      const owner = computeShieldedOwnerCommitment(secret);
      const hpkeIkm = new Uint8Array(32).fill(17);
      const viewingKey = await deriveShieldedViewPublicKey(hpkeIkm);
      let nonce = 1n;
      const value = async (amount) => {
        const note = { ownerCommitment: owner, amount, nonce: nonce++ };
        const ciphertext = await encryptShieldedNote({
          recipientPublicKey: viewingKey,
          payload: encodeShieldedValueNotePayload(note, scope),
          ...scope,
        });
        const ciphertextHashField = computeShieldedCiphertextHashField(ciphertext);
        return {
          ...note,
          ciphertext,
          ciphertextHashField,
          commitment: computeShieldedValueNoteCommitment({ ...note, ciphertextHashField }, scope),
        };
      };
      const data = (notes) => ({
        inputShardIds: [0n, 0n],
        inputRoots: [0n, 0n],
        inputNullifiers: [0n, 0n],
        periodNullifiers: Array(12).fill(0n),
        outputCommitments: notes.map((note) => note.commitment),
        outputCiphertexts: notes.map((note) => note.ciphertext),
        relation0: 0n,
        relation1: 0n,
        asOf: 0n,
        fundMode: 0n,
        budgetKind: 0n,
      });
      const prove = (action, witness, expected) => {
        const circuit = manifest.circuits[action].source;
        const input = path.join(directory, `${action}.input.json`);
        const proof = path.join(directory, `${action}.proof.json`);
        const publicFile = path.join(directory, `${action}.public.json`);
        fs.writeFileSync(input, JSON.stringify(witness));
        const start = Date.now();
        const cli = path.resolve("node_modules/snarkjs/build/cli.cjs");
        execFileSync(
          process.execPath,
          [
            cli,
            "groth16",
            "fullprove",
            input,
            path.resolve(`frontend/public/zk/shielded/${circuit}.wasm`),
            path.resolve(`frontend/public/zk/shielded/${circuit}_final.zkey`),
            proof,
            publicFile,
          ],
          { stdio: "pipe", timeout: 300_000 },
        );
        const signals = JSON.parse(fs.readFileSync(publicFile, "utf8"));
        assert.deepEqual(signals.map(BigInt), expected);
        const verified = execFileSync(
          process.execPath,
          [
            cli,
            "groth16",
            "verify",
            path.resolve(`frontend/public/zk/shielded/${circuit}.vkey.json`),
            publicFile,
            proof,
          ],
          { encoding: "utf8" },
        );
        assert.match(verified, /OK!/);
        const result = JSON.parse(fs.readFileSync(proof, "utf8"));
        console.log(
          `development-only ${action}: ${Date.now() - start} ms; ${signals.length} public signals`,
        );
        return encodeGroth16AbcProofData(normalizeGroth16Proof(result));
      };
      await token.mint(signer.address, 80n);
      await token.approve(scope.poolAddress, 80n);
      const sources = [];
      for (let i = 0; i < 8; i++) {
        const notes = await Promise.all([value(10n), value(0n)]);
        const actionData = data(notes);
        const publicInputs = buildShieldedPoolPublicInputs({
          action: 0,
          ...scope,
          ...actionData,
          amount: 10n,
        });
        const proof = prove(
          "shield",
          {
            ...publicInputs.witness,
            ownerSecret: String(secret),
            outputAmounts: ["10", "0"],
            outputNonces: notes.map((note) => String(note.nonce)),
          },
          publicInputs.signals,
        );
        await pool.shield(10n, actionData, proof);
        sources.push({ ...notes[0], leafIndex: i * 2 });
      }
      const spend = (note) =>
        computeShieldedSpendNullifier(
          { ownerSecret: secret, noteCommitment: note.commitment },
          scope,
        );
      const pathFor = async (note) => {
        const p = await pool.getNoteMerkleProof(0, note.leafIndex);
        return {
          root: p.proofRoot,
          depth: p.proofDepth,
          index: p.proofIndex,
          siblings: [...p.siblings, ...Array(32 - p.siblings.length).fill(0n)],
        };
      };
      const buildInputs = async (notes, capacity) => {
        const paths = await Promise.all(notes.map(pathFor));
        const fill = (values) =>
          Array.from({ length: capacity }, (_, i) => String(values[i] ?? 0n));
        return {
          data: {
            inputShardIds: Array(capacity).fill(0n),
            inputRoots: Array.from({ length: capacity }, (_, i) => paths[i]?.root ?? paths[0].root),
            inputNullifiers: Array.from({ length: capacity }, (_, i) =>
              notes[i]
                ? spend(notes[i])
                : computeShieldedDummyInputNullifierForSlot(secret, notes[0].commitment, i, scope),
            ),
          },
          witness: {
            inputEnabled: Array.from({ length: capacity }, (_, i) =>
              i < notes.length ? "1" : "0",
            ),
            inputOwnerSecrets: fill(notes.map(() => secret)),
            inputAmounts: fill(notes.map((note) => note.amount)),
            inputNonces: fill(notes.map((note) => note.nonce)),
            inputCiphertextHashes: fill(notes.map((note) => note.ciphertextHashField)),
            inputDepths: fill(paths.map((p) => p.depth)),
            inputIndices: fill(paths.map((p) => p.index)),
            inputSiblings: Array.from({ length: capacity }, (_, i) =>
              (paths[i]?.siblings ?? Array(32).fill(0n)).map(String),
            ),
          },
        };
      };
      const outputs = await Promise.all([value(40n), value(40n)]);
      const opened = await buildInputs(sources, 8);
      const transferData = { ...data(outputs), ...opened.data };
      const transferPublic = buildShieldedPoolPublicInputs({
        action: 3,
        ...scope,
        ...transferData,
      });
      const transferProof = prove(
        "privateTransfer8",
        {
          ...transferPublic.witness,
          ...opened.witness,
          outputOwnerCommitments: [String(owner), String(owner)],
          outputAmounts: ["40", "40"],
          outputNonces: outputs.map((note) => String(note.nonce)),
        },
        transferPublic.signals,
      );
      const receipt = await (await pool.privateTransfer(transferData, transferProof)).wait();
      console.log(`development-only transfer8 gas: ${receipt.gasUsed}`);
      expect(await pool.nullifierCount()).to.equal(8n);
      const replayOutputs = await Promise.all([value(20n), value(0n)]);
      const replayInput = await buildInputs(sources.slice(0, 2), 2);
      const replayData = { ...data(replayOutputs), ...replayInput.data };
      const replayPublic = buildShieldedPoolPublicInputs({ action: 3, ...scope, ...replayData });
      const { inputEnabled, ...smallPrivate } = replayInput.witness;
      const replayProof = prove(
        "privateTransfer",
        {
          ...replayPublic.witness,
          ...smallPrivate,
          hasSecondInput: "1",
          outputOwnerCommitments: [String(owner), String(owner)],
          outputAmounts: ["20", "0"],
          outputNonces: replayOutputs.map((note) => String(note.nonce)),
        },
        replayPublic.signals,
      );
      assert.equal(replayData.inputNullifiers[0], transferData.inputNullifiers[0]);
      await expect(pool.privateTransfer(replayData, replayProof)).to.be.revertedWithCustomError(
        pool,
        "NullifierAlreadySpent",
      );
      await token.mint(signer.address, 60n);
      await token.approve(scope.poolAddress, 60n);
      const exitSources = outputs.map((note, i) => ({ ...note, leafIndex: 16 + i }));
      for (let i = 0; i < 3; i++) {
        const notes = await Promise.all([value(10n), value(10n)]);
        const shieldData = data(notes);
        const shieldPublic = buildShieldedPoolPublicInputs({action:0,...scope,...shieldData,amount:20n});
        const shieldProof = prove("shield", {...shieldPublic.witness,ownerSecret:String(secret),
          outputAmounts:["10","10"],outputNonces:notes.map((note)=>String(note.nonce))},shieldPublic.signals);
        await pool.shield(20n,shieldData,shieldProof);
        exitSources.push(...notes.map((note,j)=>({...note,leafIndex:18+2*i+j})));
      }
      const exitOutputs = await Promise.all([value(120n), value(0n)]);
      const exitInput = await buildInputs(exitSources, 8);
      const exitData = { ...data(exitOutputs), ...exitInput.data };
      const exitPublic = buildShieldedPoolPublicInputs({
        action: 4,
        ...scope,
        ...exitData,
        amount: 20n,
        recipient: recipient.address,
      });
      const exitProof = prove(
        "unshield8",
        {
          ...exitPublic.witness,
          ...exitInput.witness,
          changeAmount: "120",
          changeNonce: String(exitOutputs[0].nonce),
          dummyNonce: String(exitOutputs[1].nonce),
        },
        exitPublic.signals,
      );
      const exitReceipt = await (
        await pool.unshield(recipient.address, 20n, exitData, exitProof)
      ).wait();
      console.log(`development-only unshield8 gas: ${exitReceipt.gasUsed}`);
      expect(await pool.nullifierCount()).to.equal(16n);
      expect(await token.balanceOf(recipient.address)).to.equal(20n);
      expect(await pool.totalShielded()).to.equal(120n);
    } finally {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
});
