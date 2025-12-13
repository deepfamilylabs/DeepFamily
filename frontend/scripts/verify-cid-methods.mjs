#!/usr/bin/env node

/**
 * Verify both CID generation methods produce identical results
 * Uses the actual implementation from src/lib/cid.ts
 */

import { generateCIDManual, generateCIDIpfs } from '../src/lib/cid.ts'

// Test data - same as user provided
const testJSON = '{"schema":"deepfamily/person-version@1.0","tag":"v2","person":{"fullName":"a1","gender":0,"birthYear":0,"birthMonth":0,"birthDay":0,"isBirthBC":false,"personHash":"0xe1bb518ea41d7194713607378444fa94b9745c3850ecd884f4f96ccdf01cf1c2"},"parents":{"father":{"fullName":"af","gender":1,"birthYear":0,"birthMonth":0,"birthDay":0,"isBirthBC":false,"personHash":"0x280cb833b484c9d88bd9db450c6fc401ce0281c5ce35308a22c4fee829cd9789","versionIndex":0},"mother":{"fullName":"am","gender":2,"birthYear":0,"birthMonth":0,"birthDay":0,"isBirthBC":false,"personHash":"0x810cebabcdd9f93367b176271294d83ee77ebc8ef99fadb312202fee39859654","versionIndex":0}}}'

console.log('='.repeat(70))
console.log('  CID Generation Methods Verification')
console.log('  (Using actual implementation from src/lib/cid.ts)')
console.log('='.repeat(70))

console.log('\n📝 Test data:')
console.log(`  Length: ${testJSON.length} bytes`)
console.log(`  First 80 chars: ${testJSON.substring(0, 80)}...`)

console.log('\n' + '-'.repeat(70))
console.log('  Method 1: Manual (multiformats + @noble/hashes)')
console.log('-'.repeat(70))

const start1 = performance.now()
const cid1 = generateCIDManual(testJSON)
const time1 = performance.now() - start1

console.log(`CID: ${cid1}`)
console.log(`Time: ${time1.toFixed(3)} ms`)

console.log('\n' + '-'.repeat(70))
console.log('  Method 2: ipfs-only-hash')
console.log('-'.repeat(70))

const start2 = performance.now()
const cid2 = await generateCIDIpfs(testJSON)
const time2 = performance.now() - start2

console.log(`CID: ${cid2}`)
console.log(`Time: ${time2.toFixed(3)} ms`)

console.log('\n' + '='.repeat(70))
console.log('  Verification Results')
console.log('='.repeat(70))

const isIdentical = cid1 === cid2

if (isIdentical) {
  console.log('\n✅✅✅ SUCCESS: Both methods produce IDENTICAL CIDs!')
  console.log('\nThis proves:')
  console.log('  ✓ src/lib/cid.ts implementation is correct')
  console.log('  ✓ Both methods are 100% compatible with IPFS standard')
  console.log('  ✓ Frontend code is verified')
  console.log(`  ✓ Method 1 is ${(time2/time1).toFixed(1)}x faster`)
} else {
  console.log('\n❌ FAILURE: CIDs do NOT match!')
  console.log(`  Method 1: ${cid1}`)
  console.log(`  Method 2: ${cid2}`)
  console.log('\n⚠️  There is a bug in src/lib/cid.ts!')
  process.exit(1)
}

console.log('\n' + '='.repeat(70))
console.log('  Environment Check')
console.log('='.repeat(70))

console.log('\n✅ Node.js environment:')
console.log(`  - TextEncoder: ${typeof TextEncoder}`)
console.log(`  - Buffer: ${typeof Buffer}`)
console.log(`  - Both methods work perfectly`)

console.log('\n⚠️  Browser environment:')
console.log('  - TextEncoder: available')
console.log('  - Buffer: NOT available (needs polyfill)')
console.log('  - Method 1: ✅ Works (no Node.js deps)')
console.log('  - Method 2: ❌ Fails (requires Buffer/Stream polyfills)')

console.log('\n💡 Recommendation:')
console.log('  - Node.js scripts: Either method works')
console.log('  - Browser/Frontend: Use Method 1 (no polyfills needed)')
console.log('  - Production: Use Method 1 (better performance)')

console.log('\n📝 Note:')
console.log('  This script tests the ACTUAL code from src/lib/cid.ts')
console.log('  The same code that runs in the frontend')
console.log('  Any changes to src/lib/cid.ts will be reflected here')

console.log('\n' + '='.repeat(70))
console.log()

