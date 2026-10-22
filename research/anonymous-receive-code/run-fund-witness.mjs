#!/usr/bin/env node
// Reproduce the four existing Fund witness checks from the anonymous-code review.
// Usage: node research/anonymous-receive-code/run-fund-witness.mjs /absolute/repo/root
// Uses the locally available Fund WASM; does not compile circuits or generate a SNARK.
// Copies the WASM and writes its report into a fresh OS temporary directory.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

if (!process.argv[2] || process.argv.length !== 3) {
  process.stderr.write('Usage: node anonymous-receive-code-fund-witness-check.mjs <repoRoot>\n');
  process.exit(2);
}

const repoRoot = await fs.realpath(path.resolve(process.argv[2]));
const requireFromRepo = createRequire(path.join(repoRoot, 'package.json'));
const { WitnessCalculatorBuilder } = await import(
  pathToFileURL(requireFromRepo.resolve('circom_runtime')).href
);
const { buildShieldedFundingFixtures } = await import(
  pathToFileURL(path.join(repoRoot, 'circuits/test/generate_shielded_funding_input.mjs')).href
);

const artifactSource = path.join(repoRoot, 'frontend/public/zk/shielded/shielded_fund.wasm');
const wasm = await fs.readFile(artifactSource);
const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), 'deepfamily-fund-witness-review-'));
const artifactCopy = path.join(outputDir, 'shielded_fund.wasm');
await fs.writeFile(artifactCopy, wasm);
const calculator = await WitnessCalculatorBuilder(wasm, { singleThread: true });
const cases = [];

for (const keyMode of [0, 1]) {
  const fixture = buildShieldedFundingFixtures({ keyMode });
  for (const mode of ['initial', 'continuation']) {
    const input = fixture[mode];
    const witness = await calculator.calculateWitness(input, 1);
    let zeroIdentityRejected = false;
    // The WASM prints expected constraint errors. Suppress only this synthetic
    // negative probe; restore logging before asserting or reporting anything.
    const previousLog = console.log;
    const previousError = console.error;
    console.log = () => {};
    console.error = () => {};
    try {
      await calculator.calculateWitness({ ...input, heirIdentityCommitment: '0' }, 1);
    } catch (error) {
      assert.match(String(error?.message ?? error), /Assert Failed\./u,
        `Expected a constraint failure: ${keyMode}/${mode}`);
      zeroIdentityRejected = true;
    } finally {
      console.log = previousLog;
      console.error = previousError;
    }
    const result = {
      keyMode,
      mode,
      valid: witness[0] === 1n,
      zeroIdentityRejected,
      fieldNamesContainingSecret: Object.keys(input).filter((key) => /secret/i.test(key)),
    };
    cases.push(result);
    assert.equal(result.valid, true, `Expected valid witness: ${keyMode}/${mode}`);
    assert.equal(result.zeroIdentityRejected, true, `Expected I=0 rejection: ${keyMode}/${mode}`);
  }
}

const reportPath = path.join(outputDir, 'report.json');
const report = {
  verificationLevel: 'existing-artifact-witness-only',
  limitations: [
    'No new circuit compilation, R1CS audit, Groth16 proof, or contract call.',
    'The negative probe checks I=0 rejection; it does not test an anonymous-code design.',
    'fieldNamesContainingSecret describes names only; allocationKey and other private fields also exist.',
  ],
  repoRoot,
  artifactSource,
  artifactCopy,
  artifactSha256: createHash('sha256').update(wasm).digest('hex'),
  cases,
};
await fs.writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ passed: true, checks: cases.length, reportPath, cases })}\n`);
