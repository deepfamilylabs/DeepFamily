#!/usr/bin/env node
// Local-only real-proof family setup for the three-wallet browser acceptance.
// The output containing synthetic identity passphrases stays beneath tmp/.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Contract, JsonRpcProvider, getAddress } from "ethers";
import { addPersonVersion, endorseVersion } from "../../lib/seedHelpers.js";

const ROOT = path.resolve(import.meta.dirname, "../..");
const stringify = (value) =>
  JSON.stringify(value, (_, item) => (typeof item === "bigint" ? String(item) : item), 2);

export function assertLocalAcceptanceRpc(value) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  ) {
    throw new Error("Qualification browser acceptance requires an unauthenticated local HTTP RPC");
  }
  return url.toString();
}

async function deployment(name) {
  return JSON.parse(
    await fs.readFile(path.join(ROOT, "deployments/localhost", `${name}.json`), "utf8"),
  );
}

function publicFixture(fixture) {
  const withoutPassphrase = ({ identityPassphrase: _private, ...rest }) => rest;
  return {
    ...fixture,
    persons: Object.fromEntries(
      Object.entries(fixture.persons).map(([name, person]) => [name, withoutPassphrase(person)]),
    ),
  };
}

export async function prepareQualificationBrowserFixture({
  rpcUrl = "http://127.0.0.1:8545",
  directory,
} = {}) {
  rpcUrl = assertLocalAcceptanceRpc(rpcUrl);
  const provider = new JsonRpcProvider(rpcUrl, undefined, { cacheTimeout: -1 });
  const originalCpus = os.cpus;
  os.cpus = () => originalCpus().slice(0, 2);
  const runId = `${Date.now()}-${randomBytes(3).toString("hex")}`;
  const output = path.resolve(ROOT, directory ?? `tmp/qualification-browser-acceptance/${runId}`);
  if (!output.startsWith(`${path.join(ROOT, "tmp")}${path.sep}`))
    throw new Error("Acceptance output must stay beneath tmp/");
  try {
    const network = await provider.getNetwork();
    assert.ok(
      [31337n, 1337n].includes(network.chainId),
      "Acceptance must use a local development chain",
    );
    const artifacts = Object.fromEntries(
      await Promise.all(
        [
          "DeepFamily",
          "DeepFamilyReader",
          "DeepFamilyToken",
          "ReceiveRegistry",
          "EligibilitySource",
          "ShieldedNativePool",
          "LetterArchive",
        ].map(async (name) => [name, await deployment(name)]),
      ),
    );
    for (const [name, item] of Object.entries(artifacts)) {
      assert.notEqual(
        await provider.getCode(item.address),
        "0x",
        `${name} is not deployed at its recorded local address`,
      );
    }
    const actors = Object.fromEntries(
      await Promise.all(
        [
          ["issuer", 1],
          ["recipient", 2],
          ["payer", 3],
          ["otherRecipient", 4],
        ].map(async ([name, index]) => {
          const signer = await provider.getSigner(index);
          return [name, { index, address: await signer.getAddress(), signer }];
        }),
      ),
    );
    assert.equal(new Set(Object.values(actors).map((item) => item.address.toLowerCase())).size, 4);
    const family = new Contract(
      artifacts.DeepFamily.address,
      artifacts.DeepFamily.abi,
      actors.issuer.signer,
    );
    const token = new Contract(
      artifacts.DeepFamilyToken.address,
      artifacts.DeepFamilyToken.abi,
      actors.issuer.signer,
    );
    assert.equal(
      getAddress(await family.eligibilitySource()),
      getAddress(artifacts.EligibilitySource.address),
    );
    const registry = new Contract(
      artifacts.ReceiveRegistry.address,
      artifacts.ReceiveRegistry.abi,
      provider,
    );
    assert.equal(
      getAddress(await registry.SOURCE()),
      getAddress(artifacts.EligibilitySource.address),
    );
    const persons = {};
    for (const [name, birthYear] of [
      ["parent", 1960],
      ["mother", 1962],
      ["recipient", 1990],
      ["otherRecipient", 1992],
    ]) {
      const personData = {
        fullName: `Qualification Acceptance  ${name} ${runId}`,
        passphrase: `acceptance ${name} ${randomBytes(18).toString("base64url")}`,
        isBirthBC: false,
        birthYear,
        birthMonth: 1,
        birthDay: 1,
        gender: 0,
      };
      const child = name === "recipient" || name === "otherRecipient";
      const result = await addPersonVersion({
        deepFamily: family,
        signer: actors.issuer.signer,
        personData,
        ...(child
          ? {
              fatherData: persons.parent.seed,
              motherData: persons.mother.seed,
              fatherVersion: 1,
              motherVersion: 1,
            }
          : {}),
        versionContent: {
          tag: "qualification-browser-acceptance",
          biography: "Synthetic local browser acceptance identity.",
        },
      });
      assert.equal(await family.personVersionsCount(result.personHash), 1n);
      persons[name] = {
        seed: personData,
        identityFields: {
          fullName: personData.fullName,
          isBirthBC: false,
          birthYear,
          birthMonth: 1,
          birthDay: 1,
          gender: 0,
        },
        identityPassphrase: personData.passphrase,
        identityCommitment: String(result.identityCommitment),
        personHash: result.personHash,
        version: 1,
        relationTransaction: result.receipt.hash,
      };
    }
    assert.equal(
      await family.trustedEndorserOf(persons.parent.personHash, 1, actors.issuer.address),
      true,
      "The issuer must manage the actual parent recommendation",
    );
    const endorsements = [];
    for (const name of ["recipient", "otherRecipient"]) {
      const result = await endorseVersion({
        deepFamily: family,
        token,
        signer: actors.issuer.signer,
        personHash: persons[name].personHash,
        versionIndex: 1,
      });
      endorsements.push({
        subject: name,
        transactionHash: result.receipt.hash,
        blockNumber: result.receipt.blockNumber,
      });
    }
    const fixture = {
      schemaVersion: 1,
      developmentOnly: true,
      realIdentityProofs: true,
      runId,
      createdAt: new Date().toISOString(),
      rpcUrl,
      chainId: String(network.chainId),
      deployments: Object.fromEntries(
        Object.entries(artifacts).map(([name, value]) => [name, getAddress(value.address)]),
      ),
      actors: Object.fromEntries(
        Object.entries(actors).map(([name, { index, address }]) => [name, { index, address }]),
      ),
      persons: Object.fromEntries(
        Object.entries(persons).map(([name, { seed: _private, ...value }]) => [name, value]),
      ),
      endorsements,
    };
    await fs.mkdir(output, { recursive: true, mode: 0o700 });
    const privateFile = path.join(output, "fixture.private.json"),
      publicFile = path.join(output, "fixture.json");
    await fs.writeFile(privateFile, `${stringify(fixture)}\n`, { mode: 0o600 });
    await fs.writeFile(publicFile, `${stringify(publicFixture(fixture))}\n`, { mode: 0o600 });
    return { fixture, privateFile, publicFile, directory: output };
  } finally {
    os.cpus = originalCpus;
    provider.destroy();
    await globalThis.curve_bn128?.terminate?.();
    delete globalThis.curve_bn128;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await prepareQualificationBrowserFixture({
      rpcUrl: process.env.QUALIFICATION_ACCEPTANCE_RPC,
      directory: process.env.QUALIFICATION_ACCEPTANCE_DIRECTORY,
    });
    console.log(
      `[qualification-acceptance] Real family fixture: ${path.relative(ROOT, result.publicFile)}`,
    );
    console.log(
      `[qualification-acceptance] Private synthetic inputs: ${path.relative(ROOT, result.privateFile)}`,
    );
  } catch (error) {
    console.error(`[qualification-acceptance] ${error.message}`);
    process.exitCode = 1;
  }
}
