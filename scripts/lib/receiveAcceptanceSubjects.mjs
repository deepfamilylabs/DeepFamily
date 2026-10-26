import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { deriveIdentityMaterial, normalizeIdentityFields, wipeBytes } from "@deepfamily/protocol-core";
import seedHelpers from "../../lib/seedHelpers.js";

/** Real PersonRelation registrations and endorsements, shared by acceptance and its EVM test. */
export async function prepareReceiveAcceptanceSubjects({
  deepFamily,
  token,
  signer,
  runId,
  proofArtifacts,
  recordTx = async (_label, tx) => tx.wait(),
  primary,
  parents,
}) {
  const records = {};
  const materials = [];
  let subjects;
  const signerAddress = await signer.getAddress();
  const syntheticPerson = (name, birthYear, gender) => ({
    fullName: `DeepFamily Receive Acceptance ${name} ${runId}`,
    passphrase: randomBytes(32).toString("base64url"),
    isBirthBC: false,
    birthYear,
    birthMonth: 1,
    birthDay: 1,
    gender,
  });
  const dispose = () => {
    for (const subject of Object.values(subjects ?? {})) subject.identityInput.derivedSecretField = 0n;
    for (const material of materials) {
      wipeBytes(material.identitySalt);
      wipeBytes(material.derivedSecretBytes);
    }
  };
  try {
    for (const [name, year, gender] of [
      ["parent", 1960, 1],
      ["mother", 1962, 2],
      ["primary", 1990, 0],
      ["other", 1992, 0],
    ]) {
      const personData =
        (name === "primary" ? primary?.personData : parents?.[name]) ??
        syntheticPerson(name, year, gender);
      const child = name === "primary" || name === "other";
      const result =
        (name === "primary" ? primary?.result : undefined) ??
        (await seedHelpers.addPersonVersion({
          deepFamily,
          signer,
          personData,
          ...(child
            ? {
                fatherData: records.parent.personData,
                motherData: records.mother.personData,
                fatherVersion: 1,
                motherVersion: 1,
              }
            : {}),
          versionContent: {
            tag: "receive-protocol-acceptance",
            biography: "Synthetic identity for actual receive protocol acceptance.",
          },
          ...(proofArtifacts ? { proofArtifacts } : {}),
        }));
      await recordTx(`receive-identity-${name}`, result.tx);
      assert.equal(await deepFamily.personVersionsCount(result.personHash), 1n);
      const material = await deriveIdentityMaterial({
        identity: normalizeIdentityFields(personData),
        rawPassphrase: personData.passphrase,
        identitySuiteId: 1,
      });
      materials.push(material);
      assert.equal(material.identityCommitment, BigInt(result.identityCommitment));
      assert.equal(material.personHash.toLowerCase(), result.personHash.toLowerCase());
      records[name] = { personData, result, material };
    }
    assert.equal(
      await deepFamily.trustedEndorserOf(records.parent.result.personHash, 1, signerAddress),
      true,
      "The actual parent manager must authorize SourceTrust",
    );
    for (const name of ["primary", "other"]) {
      const personHash = records[name].result.personHash;
      if ((await deepFamily.endorsedVersionIndex(personHash, signerAddress)) !== 1n) {
        const fee = await token.recentReward();
        await recordTx(
          `receive-endorsement-approve-${name}`,
          await token.connect(signer).approve(await deepFamily.getAddress(), fee),
        );
        await recordTx(
          `receive-endorsement-${name}`,
          await deepFamily.connect(signer).endorseVersion(personHash, 1),
        );
      }
    }
    subjects = Object.fromEntries(
      ["primary", "other"].map((name) => {
        const record = records[name];
        return [
          name,
          {
            identityInput: {
              ...record.material.identity,
              derivedSecretField: record.material.derivedSecretField,
              identitySuiteId: 1,
            },
            personHash: record.result.personHash,
            childVersion: 1n,
            parentHash: records.parent.result.personHash,
            parentIdentity: records.parent.material.identityCommitment,
            parentVersion: 1n,
            fatherIdentity: records.parent.material.identityCommitment,
            motherIdentity: records.mother.material.identityCommitment,
          },
        ];
      }),
    );
    return { subjects, dispose };
  } catch (error) {
    dispose();
    throw error;
  }
}
