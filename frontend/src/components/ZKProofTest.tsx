import React, { useState } from "react";
import type { PersonData } from "../lib/zk";
import { DEFAULT_SCHEMA_VERSION, DEFAULT_CRYPTO_SUITE_VERSION, DEFAULT_HASH_ALGO_ID } from "../lib/zk";
import { zkWorkerCall } from "../lib/zkWorkerClient";
import { computeIdentityHashMaterial } from "../lib/identityHash";

type EditablePerson = {
  fullName: string;
  passphrase: string;
  birthYear: number;
  birthMonth: number;
  birthDay: number;
  isBirthBC: boolean;
  gender: number;
  schemaVersion: number;
  cryptoSuiteVersion: number;
  hashAlgoId: number;
};

const ZKProofTest: React.FC = () => {
  const [isLoading, setIsLoading] = useState(false);
  const [result, setResult] = useState<string>("");
  const [person, setPerson] = useState<EditablePerson>({
    fullName: "Test Person",
    passphrase: "test-person-passphrase",
    birthYear: 1990,
    birthMonth: 12,
    birthDay: 25,
    isBirthBC: false,
    gender: 2,
    schemaVersion: DEFAULT_SCHEMA_VERSION,
    cryptoSuiteVersion: DEFAULT_CRYPTO_SUITE_VERSION,
    hashAlgoId: DEFAULT_HASH_ALGO_ID,
  });

  const buildPersonData = async (input: EditablePerson): Promise<PersonData> => {
    const computed = await computeIdentityHashMaterial(input);
    return {
      fullName: computed.canonicalFullName,
      derivedSecretField: computed.derivedSecretField,
      birthYear: input.birthYear,
      birthMonth: input.birthMonth,
      birthDay: input.birthDay,
      isBirthBC: input.isBirthBC,
      gender: input.gender,
      schemaVersion: input.schemaVersion,
      cryptoSuiteVersion: input.cryptoSuiteVersion,
      hashAlgoId: input.hashAlgoId,
    };
  };

  const handleGenerateProof = async () => {
    setIsLoading(true);
    setResult("");

    try {
      const personData = await buildPersonData(person);
      const father = await buildPersonData({
        fullName: "Test Father",
        passphrase: "test-father-passphrase",
        birthYear: 1960,
        birthMonth: 5,
        birthDay: 15,
        isBirthBC: false,
        gender: 1,
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        cryptoSuiteVersion: DEFAULT_CRYPTO_SUITE_VERSION,
        hashAlgoId: DEFAULT_HASH_ALGO_ID,
      });

      const mother = await buildPersonData({
        fullName: "Test Mother",
        passphrase: "test-mother-passphrase",
        birthYear: 1965,
        birthMonth: 8,
        birthDay: 20,
        isBirthBC: false,
        gender: 2,
        schemaVersion: DEFAULT_SCHEMA_VERSION,
        cryptoSuiteVersion: DEFAULT_CRYPTO_SUITE_VERSION,
        hashAlgoId: DEFAULT_HASH_ALGO_ID,
      });

      const { proof, publicSignals } = await zkWorkerCall("generatePersonCommitmentProof", {
        person: personData,
        father,
        mother,
        submitterAddress: "0x1234567890123456789012345678901234567890",
      });

      const { ok: isValid } = await zkWorkerCall("verifyPersonCommitmentProof", {
        proof,
        publicSignals,
      });

      setResult(
        `
ZK Proof Generated Successfully!

Public Signals (${publicSignals.length} total):
${publicSignals.map((signal, i) => `  [${i}]: ${signal}`).join("\n")}

Proof Verification: ${isValid ? "VALID" : "INVALID"}

Signals:
- [0] identityCommitment: ${publicSignals[0]}
- [1] fatherIdentityCommitment: ${publicSignals[1]}
- [2] motherIdentityCommitment: ${publicSignals[2]}
- [3] submitter: ${publicSignals[3]}
- [4] schemaVersion: ${publicSignals[4]}
- [5] cryptoSuiteVersion: ${publicSignals[5]}
- [6] hashAlgoId: ${publicSignals[6]}

Test Details:
- Person: ${person.fullName} (${person.birthYear}/${person.birthMonth}/${person.birthDay})
- Person passphrase: ${person.passphrase}
- Father: Test Father (exists)
- Mother: Test Mother (exists)
      `.trim(),
      );
    } catch (error) {
      console.error("Error:", error);
      setResult(`Error: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  const handleTestNoParents = async () => {
    setIsLoading(true);
    setResult("");

    try {
      const personData = await buildPersonData(person);
      const { proof, publicSignals } = await zkWorkerCall("generatePersonCommitmentProof", {
        person: personData,
        father: null,
        mother: null,
        submitterAddress: "0x1234567890123456789012345678901234567890",
      });

      const { ok: isValid } = await zkWorkerCall("verifyPersonCommitmentProof", {
        proof,
        publicSignals,
      });

      setResult(
        `
No Parents Test Successful!

Public Signals (${publicSignals.length} total):
${publicSignals.map((signal, i) => `  [${i}]: ${signal}`).join("\n")}

Proof Verification: ${isValid ? "VALID" : "INVALID"}

Expected Behavior:
- Signal [1]: Father identity commitment should be 0
- Signal [2]: Mother identity commitment should be 0
- In contract: bytes32(0) when identity commitment is 0
      `.trim(),
      );
    } catch (error) {
      console.error("Error:", error);
      setResult(`Error: ${error}`);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="max-w-4xl mx-auto p-6 bg-white rounded-lg shadow-lg">
      <h2 className="text-2xl font-bold mb-6 text-gray-800">ZK Proof Generator Test</h2>

      <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <h3 className="font-semibold text-blue-800 mb-2">Test Person Data</h3>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Full Name</label>
            <input
              type="text"
              value={person.fullName}
              onChange={(e) => setPerson({ ...person, fullName: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Birth Year</label>
            <input
              type="number"
              value={person.birthYear}
              onChange={(e) => setPerson({ ...person, birthYear: parseInt(e.target.value) })}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Birth Month</label>
            <input
              type="number"
              min="1"
              max="12"
              value={person.birthMonth}
              onChange={(e) => setPerson({ ...person, birthMonth: parseInt(e.target.value) })}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Birth Day</label>
            <input
              type="number"
              min="1"
              max="31"
              value={person.birthDay}
              onChange={(e) => setPerson({ ...person, birthDay: parseInt(e.target.value) })}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Passphrase</label>
            <input
              type="text"
              value={person.passphrase}
              onChange={(e) => setPerson({ ...person, passphrase: e.target.value })}
              className="w-full p-2 border border-gray-300 rounded-md"
            />
          </div>
        </div>
      </div>

      <div className="flex space-x-4 mb-6">
        <button
          onClick={handleGenerateProof}
          disabled={isLoading}
          className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Generating..." : "Test with Parents"}
        </button>

        <button
          onClick={handleTestNoParents}
          disabled={isLoading}
          className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isLoading ? "Testing..." : "Test No Parents"}
        </button>
      </div>

      {result && (
        <div className="bg-gray-50 rounded-lg border p-4">
          <h3 className="font-semibold text-gray-800 mb-2">Result:</h3>
          <pre className="text-sm text-gray-700 whitespace-pre-wrap overflow-x-auto">{result}</pre>
        </div>
      )}

      <div className="mt-6 p-4 bg-green-50 rounded-lg border border-green-200">
        <h3 className="font-semibold text-green-800 mb-2">Circuit Status</h3>
        <ul className="text-sm text-green-700 space-y-1">
          <li>- PersonCommitment circuit with Poseidon4-based identity commitments</li>
          <li>- DisclosureBinding circuit with disclosure binding</li>
          <li>- Schema v{DEFAULT_SCHEMA_VERSION}, CryptoSuite v{DEFAULT_CRYPTO_SUITE_VERSION}, HashAlgo {DEFAULT_HASH_ALGO_ID}</li>
          <li>- Parent existence flags (hasFather/hasMother) fully supported</li>
          <li>- Proof generation may take 30-60 seconds due to computation complexity</li>
        </ul>
      </div>
    </div>
  );
};

export default ZKProofTest;
