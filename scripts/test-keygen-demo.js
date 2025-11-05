/**
 * PersonHash Secure Key Derivation Demo
 *
 * This script follows the complete flow documented in docs/KEY_DERIVATION_FLOW.md
 *
 * Core Security Features:
 * - Step 9-10: Salt includes passphrase hash, preventing attackers from pre-computing salt
 * - scrypt KDF: N=131,072 provides strong brute-force protection
 * - Fully Deterministic: Same inputs always produce the same key
 *
 * Usage:
 *   node scripts/test-keygen-demo.js
 */

const { scrypt } = require('scrypt-js');
const { ethers } = require('ethers');

// Simulate PersonHash computation (simplified version)
function computePersonHash(fullName, birthYear, birthMonth, birthDay, gender, passphrase) {
  const normalizedName = fullName.trim().normalize('NFC');
  const normalizedPass = passphrase.trim().normalize('NFC');

  // Pack personal information
  const packedData = (BigInt(birthYear) << 24n) |
                     (BigInt(birthMonth) << 16n) |
                     (BigInt(birthDay) << 8n) |
                     (BigInt(gender) << 1n);

  // Simplified: directly hash all inputs
  const combined = ethers.concat([
    ethers.toUtf8Bytes(normalizedName),
    ethers.toUtf8Bytes(normalizedPass),
    ethers.toUtf8Bytes(packedData.toString())
  ]);

  return ethers.keccak256(combined);
}

// KDF Key Derivation (following documented flow)
async function deriveKey(personHash, userData, purpose, preset = 'BALANCED') {
  const params = {
    FAST: { N: 16384, r: 8, p: 1 },
    BALANCED: { N: 131072, r: 8, p: 1 },
    STRONG: { N: 262144, r: 8, p: 1 }
  }[preset];

  // Step 9: Compute passphrase hash (security critical!)
  const passphraseHash = userData.passphrase
    ? ethers.keccak256(ethers.toUtf8Bytes(userData.passphrase))
    : ethers.ZeroHash;

  // Step 10: Construct purpose salt (includes passphrase hash)
  const saltComponents = [
    `DeepFamily-${purpose}-v1`,           // Purpose identifier
    userData.fullName,                     // Full name
    `${userData.birthYear}-${userData.birthMonth}-${userData.birthDay}`, // Birth date
    userData.gender.toString(),            // Gender
    passphraseHash                         // 🔒 Passphrase hash (prevents pre-computation)
  ].join(':');

  // Step 11: Hash salt
  const saltHash = ethers.keccak256(ethers.toUtf8Bytes(saltComponents));

  // Step 12: Prepare byte arrays
  const hashBytes = ethers.getBytes(personHash);
  const saltBytes = ethers.getBytes(saltHash);

  const startTime = Date.now();
  const derivedBytes = await scrypt(hashBytes, saltBytes, params.N, params.r, params.p, 32);
  const elapsed = Date.now() - startTime;

  const key = '0x' + Buffer.from(derivedBytes).toString('hex');
  const wallet = new ethers.Wallet(key);

  return { key, address: wallet.address, elapsed };
}

// Main demo
async function demo() {
  console.log('========================================');
  console.log('  PersonHash Secure Key Derivation Demo');
  console.log('========================================\n');

  // Scenario 1: Strong passphrase
  console.log('【Scenario 1】Strong Passphrase User\n');
  const user1 = {
    fullName: 'John Smith',
    birthYear: 1990,
    birthMonth: 5,
    birthDay: 15,
    gender: 1,
    passphrase: 'Spring dawn unaware🌸Birds sing everywhere🐦Night wind and rain🌧️How many flowers fall🌺'
  };

  console.log(`Full Name: ${user1.fullName}`);
  console.log(`Birth Date: ${user1.birthYear}-${user1.birthMonth}-${user1.birthDay}`);
  console.log(`Passphrase: ${user1.passphrase} (${user1.passphrase.length} characters)`);

  // Display passphrase hash (verify salt includes passphrase)
  const passphraseHashDemo = ethers.keccak256(ethers.toUtf8Bytes(user1.passphrase));
  console.log(`Passphrase Hash: ${passphraseHashDemo.substring(0, 20)}... 🔒\n`);

  const hash1 = computePersonHash(
    user1.fullName,
    user1.birthYear,
    user1.birthMonth,
    user1.birthDay,
    user1.gender,
    user1.passphrase
  );
  console.log(`PersonHash: ${hash1}\n`);

  const result1 = await deriveKey(hash1, user1, 'PrivateKey', 'BALANCED');
  console.log(`✅ Derived Private Key (BALANCED, N=131072):`);
  console.log(`   Elapsed: ${result1.elapsed}ms`);
  console.log(`   Private Key: ${result1.key}`);
  console.log(`   Address: ${result1.address}\n`);

  // Scenario 2: Deterministic verification
  console.log('【Scenario 2】Deterministic Verification - Same Inputs\n');

  const hash2 = computePersonHash(
    user1.fullName,
    user1.birthYear,
    user1.birthMonth,
    user1.birthDay,
    user1.gender,
    user1.passphrase
  );
  const result2 = await deriveKey(hash2, user1, 'PrivateKey', 'BALANCED');

  console.log(`Derived Again:`);
  console.log(`   Private Key: ${result2.key}`);
  console.log(`   Address: ${result2.address}`);
  console.log(`\n✅ Completely Identical: ${result1.key === result2.key && result1.address === result2.address}\n`);

  // Scenario 3: Avalanche effect
  console.log('【Scenario 3】Avalanche Effect - Minor Change\n');

  // Passphrase differs by last character
  const user1Modified = { ...user1, passphrase: user1.passphrase + '!' };
  const hash3 = computePersonHash(
    user1Modified.fullName,
    user1Modified.birthYear,
    user1Modified.birthMonth,
    user1Modified.birthDay,
    user1Modified.gender,
    user1Modified.passphrase
  );
  const result3 = await deriveKey(hash3, user1Modified, 'PrivateKey', 'FAST');

  console.log(`Passphrase Change ("...🌺" → "...🌺!"):`);
  console.log(`   Original Key: ${result1.key.substring(0, 20)}...`);
  console.log(`   New Key: ${result3.key.substring(0, 20)}...`);
  console.log(`   Completely Different: ${result1.key !== result3.key}\n`);

  // Scenario 4: Different KDF strength comparison
  console.log('【Scenario 4】KDF Strength Comparison\n');

  const presets = ['FAST', 'BALANCED', 'STRONG'];
  for (const preset of presets) {
    const result = await deriveKey(hash1, user1, 'PrivateKey', preset);
    const n = { FAST: 16384, BALANCED: 131072, STRONG: 262144 }[preset];
    console.log(`${preset.padEnd(9)} (N=${n.toString().padEnd(6)}): ${result.elapsed.toString().padStart(4)}ms → ${result.key.substring(0, 20)}...`);
  }

  // Scenario 5: Actual wallet operations
  console.log('\n【Scenario 5】Actual Wallet Operations\n');

  const wallet = new ethers.Wallet(result1.key);
  const message = 'DeepFamily - My Family Tree Record 2024';
  const signature = await wallet.signMessage(message);
  const recovered = ethers.verifyMessage(message, signature);

  console.log(`Wallet Address: ${wallet.address}`);
  console.log(`Message Signature: ${signature.substring(0, 30)}...`);
  console.log(`Verification Passed: ${recovered === wallet.address}\n`);

  // Summary
  console.log('========================================');
  console.log('  Summary');
  console.log('========================================\n');
  console.log('✅ Deterministic: Same inputs → Same key');
  console.log('✅ Security: KDF provides 131,072x brute-force protection');
  console.log('✅ Avalanche Effect: Any minor change → Completely different key');
  console.log('✅ Practicality: Can be directly used for Ethereum wallets\n');
  console.log('⚠️  Important: Strong passphrase (20+ characters) is key to security!\n');
}

demo().catch(console.error);
