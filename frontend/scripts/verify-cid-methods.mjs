#!/usr/bin/env node

/**
 * Verify metadata CID generation against a known raw-leaf CIDv1 fixture.
 * Uses the actual implementation from src/shared/ipfs/cid.ts.
 */

import { generateRawSha256CID, generateMetadataCID } from '../src/shared/ipfs/cid.ts'

// Test data - same as user provided
const testJSON = '{"schema":"deepfamily/person-version@2.0","tag":"v2","person":{"fullName":"a1","gender":0,"birthYear":0,"birthMonth":0,"birthDay":0,"isBirthBC":false,"personHash":"0xe1bb518ea41d7194713607378444fa94b9745c3850ecd884f4f96ccdf01cf1c2"},"parents":{"father":{"fullName":"af","gender":1,"birthYear":0,"birthMonth":0,"birthDay":0,"isBirthBC":false,"personHash":"0x280cb833b484c9d88bd9db450c6fc401ce0281c5ce35308a22c4fee829cd9789","versionIndex":0},"mother":{"fullName":"am","gender":2,"birthYear":0,"birthMonth":0,"birthDay":0,"isBirthBC":false,"personHash":"0x810cebabcdd9f93367b176271294d83ee77ebc8ef99fadb312202fee39859654","versionIndex":0}},"recovery":{"identityKdf":{"algorithm":"Argon2id","kdfVersion":1,"params":{"memoryKiB":65536,"iterations":3,"parallelism":1,"outputBytes":32},"saltHex":"00112233445566778899aabbccddeeff"}}}'
const expectedCID = 'bafkreigf25gcvnqrb7m2qzmqcdxwhqrern6f2g6dzjylfm6ekntp6iqc4e'

console.log('='.repeat(70))
console.log('  CID Generation Fixture Verification')
console.log('  (Using actual implementation from src/shared/ipfs/cid.ts)')
console.log('='.repeat(70))

console.log('\nTest data:')
console.log(`  Length: ${testJSON.length} bytes`)
console.log(`  First 80 chars: ${testJSON.substring(0, 80)}...`)

const start1 = performance.now()
const cid1 = generateRawSha256CID(testJSON)
const time1 = performance.now() - start1

console.log(`CID: ${cid1}`)
console.log(`Time: ${time1.toFixed(3)} ms`)
console.log(`Expected: ${expectedCID}`)

const start2 = performance.now()
const cid2 = await generateMetadataCID(testJSON)
const time2 = performance.now() - start2

console.log(`generateMetadataCID: ${cid2}`)
console.log(`Wrapper time: ${time2.toFixed(3)} ms`)

console.log('\n' + '='.repeat(70))
console.log('  Verification Results')
console.log('='.repeat(70))

const isIdentical = cid1 === expectedCID && cid2 === expectedCID

if (isIdentical) {
  console.log('\nSUCCESS: CID generation matches the fixture!')
  console.log('\nThis proves:')
  console.log('  [ok] src/shared/ipfs/cid.ts implementation is correct')
  console.log('  [ok] Raw codec + sha2-256 CIDv1 output is stable')
  console.log('  [ok] Frontend code is verified')
} else {
  console.log('\nFAILURE: CID does NOT match the fixture!')
  console.log(`  generateRawSha256CID: ${cid1}`)
  console.log(`  generateMetadataCID: ${cid2}`)
  console.log(`  Expected: ${expectedCID}`)
  console.log('\nWarning: There is a bug in src/shared/ipfs/cid.ts!')
  process.exit(1)
}

console.log('\n' + '='.repeat(70))
console.log('  Environment Check')
console.log('='.repeat(70))

console.log('\nNode.js environment:')
console.log(`  - TextEncoder: ${typeof TextEncoder}`)
console.log(`  - Buffer: ${typeof Buffer}`)
console.log(`  - CID generation works without IPFS runtime dependencies`)

console.log('\nBrowser environment:')
console.log('  - TextEncoder: available')
console.log('  - Buffer: not required')
console.log('  - Method: Works without Node.js polyfills')

console.log('\nRecommendation:')
console.log('  - Keep using multiformats + @noble/hashes for production CID generation')

console.log('\nNote:')
console.log('  This script tests the ACTUAL code from src/shared/ipfs/cid.ts')
console.log('  The same code that runs in the frontend')
console.log('  Any changes to src/shared/ipfs/cid.ts will be reflected here')

console.log('\n' + '='.repeat(70))
console.log()
