#!/usr/bin/env node
/**
 * Update frontend environment with latest local deployment
 * Reads deployment info from hardhat-deploy and updates .env.local
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';
import { ethers } from 'ethers';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const FRONTEND_DIR = path.dirname(__dirname);
const PROJECT_ROOT = path.dirname(FRONTEND_DIR);
const DEPLOYMENTS_DIR = path.join(PROJECT_ROOT, 'deployments', 'localhost');
const ENV_LOCAL_PATH = path.join(FRONTEND_DIR, '.env.local');
const require = createRequire(import.meta.url);
const { computePoseidonDigest } = require(path.join(PROJECT_ROOT, 'lib', 'namePoseidon.js'));
const {
  loadMultiLanguageRoots,
  checkPersonExists
} = require(path.join(PROJECT_ROOT, 'lib', 'seedHelpers.js'));

const LANGUAGE_LABELS = {
  en: 'English Root (Kennedy Family)',
  zh: 'Chinese Root (曹操家族)'
};
const LANGUAGE_PRIORITY = ['en', 'zh'];

function prepareBasicInfo(basicInfo) {
  const passphrase = basicInfo.passphrase || '';
  const digest = computePoseidonDigest(basicInfo.fullName, passphrase);

  return {
    fullNameCommitment: digest.digestHex,
    isBirthBC: Boolean(basicInfo.isBirthBC),
    birthYear: Number(basicInfo.birthYear ?? 0),
    birthMonth: Number(basicInfo.birthMonth ?? 0),
    birthDay: Number(basicInfo.birthDay ?? 0),
    gender: Number(basicInfo.gender ?? 0)
  };
}

// Helper: call new getPersonHash (using PersonBasicInfo struct with fullNameCommitment)
async function getPersonHashFromBasicInfo(deepFamily, basicInfo) {
  const prepared = prepareBasicInfo(basicInfo);
  return await deepFamily.getPersonHash(prepared);
}

function getLanguageLabel(lang, rootData = {}) {
  if (LANGUAGE_LABELS[lang]) return LANGUAGE_LABELS[lang];
  if (rootData.familyName) return `${lang.toUpperCase()} Root (${rootData.familyName})`;
  return `${lang.toUpperCase()} Root`;
}

function pickDefaultRoot(entries) {
  const prioritized = (predicate) => {
    for (const lang of LANGUAGE_PRIORITY) {
      const hit = entries.find(entry => entry.lang === lang && predicate(entry));
      if (hit) return hit;
    }
    return null;
  };

  return (
    prioritized(entry => entry.exists) ||
    entries.find(entry => entry.exists) ||
    prioritized(() => true) ||
    entries[0]
  );
}

async function collectMultiLanguageRootHashes(deepFamily) {
  const roots = loadMultiLanguageRoots();
  const entries = [];

  for (const [lang, rootData] of Object.entries(roots)) {
    try {
      const hash = await getPersonHashFromBasicInfo(deepFamily, rootData);
      const { exists, totalVersions } = await checkPersonExists({
        deepFamily,
        personHash: hash
      });

      entries.push({
        lang,
        hash,
        label: getLanguageLabel(lang, rootData),
        exists,
        totalVersions,
        versionIndex: '1',
        personData: rootData
      });
    } catch (error) {
      console.warn(`⚠️  Failed to compute ${lang.toUpperCase()} root hash: ${error.message}`);
    }
  }

  if (entries.length === 0) {
    throw new Error('No multi-language root data found. Ensure data/persons JSON files are present.');
  }

  return {
    entries,
    defaultRoot: pickDefaultRoot(entries)
  };
}

async function updateLocalConfig() {
  try {
    // Check if localhost deployments exist
    if (!fs.existsSync(DEPLOYMENTS_DIR)) {
      console.log('❌ No localhost deployments found. Run `npm run deploy:local` first.');
      process.exit(1);
    }

    // Read deployment info
    const deepFamilyPath = path.join(DEPLOYMENTS_DIR, 'DeepFamily.json');
    if (!fs.existsSync(deepFamilyPath)) {
      console.log('❌ DeepFamily contract not deployed. Run `npm run deploy:local` first.');
      process.exit(1);
    }

    const deepFamilyDeployment = JSON.parse(fs.readFileSync(deepFamilyPath, 'utf8'));
    const contractAddress = deepFamilyDeployment.address;

    console.log(`📄 Found DeepFamily contract at: ${contractAddress}`);

    // Connect to contract and get root person hash
    const provider = new ethers.JsonRpcProvider('http://127.0.0.1:8545');
    const deepFamily = new ethers.Contract(contractAddress, deepFamilyDeployment.abi, provider);

    // Compute latest root hashes for all supported languages
    const { entries: rootEntries, defaultRoot } = await collectMultiLanguageRootHashes(deepFamily);

    console.log('\n🌐 Multi-language root hashes:');
    rootEntries.forEach(entry => {
      console.log(`   [${entry.lang.toUpperCase()}] ${entry.label}`);
      console.log(`      Hash: ${entry.hash}`);
      if (entry.exists) {
        console.log(`      ✓ On-chain (versions: ${entry.totalVersions})`);
      } else {
        console.log('      ⚠ Not found on-chain yet. Run `npm run seed` after deploying.');
      }
    });

    console.log(`\n⭐ Default frontend root: [${defaultRoot.lang.toUpperCase()}] ${defaultRoot.label}`);
    console.log(`   Hash: ${defaultRoot.hash}`);
    if (!defaultRoot.exists) {
      console.log('   ⚠ Default root not found on-chain yet. Frontend tree will stay empty until seeded.');
    }

    // Read current .env.local or create from template
    let envContent = '';
    let isNewFile = false;

    if (fs.existsSync(ENV_LOCAL_PATH)) {
      envContent = fs.readFileSync(ENV_LOCAL_PATH, 'utf8');
      console.log('📝 Updating existing .env.local');
    } else {
      // Create from .env.example
      const envExamplePath = path.join(FRONTEND_DIR, '.env.example');
      if (fs.existsSync(envExamplePath)) {
        envContent = fs.readFileSync(envExamplePath, 'utf8');
        console.log('📄 Creating .env.local from .env.example');
        isNewFile = true;
      } else {
        envContent = `# Local development environment
# Auto-generated by update-local-config.mjs

`;
        isNewFile = true;
      }
    }

    // Update or add contract address
    const updates = {
      'VITE_RPC_URL': 'http://127.0.0.1:8545',
      'VITE_CONTRACT_ADDRESS': contractAddress,
      'VITE_ROOT_PERSON_HASH': defaultRoot.hash,
      'VITE_ROOT_VERSION_INDEX': defaultRoot.versionIndex
    };

    // Record per-language hashes for quick switching in the frontend
    for (const entry of rootEntries) {
      const suffix = entry.lang.toUpperCase();
      updates[`VITE_ROOT_PERSON_HASH_${suffix}`] = entry.hash;
      updates[`VITE_ROOT_VERSION_INDEX_${suffix}`] = entry.versionIndex;
    }

    // Apply updates
    let updatedContent = envContent;
    for (const [key, value] of Object.entries(updates)) {
      const regex = new RegExp(`^${key}=.*$`, 'm');
      if (regex.test(updatedContent)) {
        updatedContent = updatedContent.replace(regex, `${key}=${value}`);
        console.log(`✅ Updated ${key}=${value}`);
      } else {
        updatedContent += `\n${key}=${value}`;
        console.log(`➕ Added ${key}=${value}`);
      }
    }

    // Write updated content
    fs.writeFileSync(ENV_LOCAL_PATH, updatedContent);
    
    if (isNewFile) {
      console.log('\n🎉 Created .env.local with local deployment configuration!');
    } else {
      console.log('\n🎉 Updated .env.local with latest deployment addresses!');
    }
    
    console.log('\n📋 Current configuration:');
    console.log(`   RPC URL: http://127.0.0.1:8545`);
    console.log(`   Contract: ${contractAddress}`);
    console.log(`   Root Hash [${defaultRoot.lang.toUpperCase()}]: ${defaultRoot.hash}`);
    
    console.log('\n🚀 You can now start the frontend with: npm run dev');

  } catch (error) {
    console.error('❌ Error updating local config:', error.message);
    process.exit(1);
  }
}

updateLocalConfig();
