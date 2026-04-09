#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// This script serves two related use cases:
// 1. Compare locale JSON files against each other (missing / extra / ordering).
// 2. Compare locale keys against frontend source usage (`--usage`).

// Recursively get all key paths
function getAllKeys(obj, prefix = '') {
  const keys = new Set();
  
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    keys.add(fullKey);
    
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nestedKeys = getAllKeys(value, fullKey);
      nestedKeys.forEach(k => keys.add(k));
    }
  }
  
  return keys;
}

// Recursively get leaf key paths only
function getLeafKeys(obj, prefix = '') {
  const keys = new Set();

  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nestedKeys = getLeafKeys(value, fullKey);
      nestedKeys.forEach(k => keys.add(k));
    } else {
      keys.add(fullKey);
    }
  }

  return keys;
}

// Get nested object value by key path
function getValueByPath(obj, path) {
  return path.split('.').reduce((current, key) => current?.[key], obj);
}

// Set nested object value by key path
function setValueByPath(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  const target = keys.reduce((current, key) => {
    if (!(key in current)) {
      current[key] = {};
    }
    return current[key];
  }, obj);
  target[lastKey] = value;
}

// Deep merge two objects, preserving original structure
function deepMerge(target, source) {
  const result = { ...target };
  
  for (const [key, value] of Object.entries(source)) {
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      if (typeof result[key] === 'object' && result[key] !== null && !Array.isArray(result[key])) {
        result[key] = deepMerge(result[key], value);
      } else {
        result[key] = { ...value };
      }
    } else {
      result[key] = value;
    }
  }
  
  return result;
}

// Save JSON file with formatting
function saveJsonFile(filePath, data) {
  try {
    const content = JSON.stringify(data, null, 2);
    fs.writeFileSync(filePath, content, 'utf8');
    return true;
  } catch (error) {
    console.error(`Unable to save file ${filePath}:`, error.message);
    return false;
  }
}

// Load JSON file
function loadJsonFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(content);
  } catch (error) {
    console.error(`Unable to read file ${filePath}:`, error.message);
    return null;
  }
}

function walkFiles(dirPath, allowedExtensions) {
  const files = [];

  if (!fs.existsSync(dirPath)) {
    return files;
  }

  for (const entry of fs.readdirSync(dirPath, { withFileTypes: true })) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      files.push(...walkFiles(fullPath, allowedExtensions));
      continue;
    }

    if (allowedExtensions.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }

  return files;
}

// We treat dotted paths as translation-like keys, e.g. `common.copy` or `mintNFT.title`.
function looksLikeTranslationKey(value) {
  return /^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)+$/.test(value);
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildTemplateKeyRegex(templateContent) {
  if (!templateContent.includes('${')) {
    return null;
  }

  const parts = templateContent.split(/\$\{[^}]+\}/g);
  if (parts.length < 2) {
    return null;
  }

  const pattern = `^${parts.map(escapeRegex).join('[^.]+')}$`;
  return new RegExp(pattern);
}

// Collect dotted-string candidates from source so config-held translation keys are not missed.
function extractQuotedTranslationCandidates(content) {
  const candidates = new Set();
  const regexes = [
    /"((?:\\.|[^"\\\n])*)"/g,
    /'((?:\\.|[^'\\\n])*)'/g,
    /`((?:\\.|[^`\\\n$])*)`/g,
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const value = match[1];
      if (looksLikeTranslationKey(value)) {
        candidates.add(value);
      }
    }
  }

  return candidates;
}

// Extract direct translation calls so missing locale entries are treated as hard findings.
function extractTCallTranslationCandidates(content) {
  const candidates = new Set();
  const regexes = [
    /(?:\bi18n\.)?\bt\(\s*"((?:\\.|[^"\\\n])*)"/g,
    /(?:\bi18n\.)?\bt\(\s*'((?:\\.|[^'\\\n])*)'/g,
    /(?:\bi18n\.)?\bt\(\s*`((?:\\.|[^`\\\n$])*)`/g,
  ];

  for (const regex of regexes) {
    let match;
    while ((match = regex.exec(content)) !== null) {
      const value = match[1];
      if (looksLikeTranslationKey(value)) {
        candidates.add(value);
      }
    }
  }

  return candidates;
}

// Convert template literals such as `chunkTypes.${key}` into regexes for locale matching.
function extractDynamicTemplatePatterns(content) {
  const patterns = [];
  const templateRegex = /`([^`\n]*\$\{[^`\n]+\}[^`\n]*)`/g;

  let match;
  while ((match = templateRegex.exec(content)) !== null) {
    const template = match[1];
    const regex = buildTemplateKeyRegex(template);
    if (regex) {
      patterns.push({ template, regex });
    }
  }

  return patterns;
}

function summarizeByTopLevel(keys) {
  const counts = new Map();

  for (const key of keys) {
    const namespace = key.split('.')[0];
    counts.set(namespace, (counts.get(namespace) || 0) + 1);
  }

  return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

// Scan frontend source files and classify locale keys into:
// - used keys
// - code references missing from locale
// - unused candidates
//
// The "unused" bucket is intentionally conservative: it is a cleanup hint,
// not a proof that a key is safe to delete in every runtime path.
function analyzeLocaleUsage(localeFilePath, sourceDir) {
  const localeJson = loadJsonFile(localeFilePath);
  if (!localeJson) {
    return null;
  }

  const allLocaleKeys = getAllKeys(localeJson);
  const leafLocaleKeys = getLeafKeys(localeJson);
  const localeNamespaces = new Set([...allLocaleKeys].map(key => key.split('.')[0]));
  const sourceFiles = walkFiles(sourceDir, new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs']));

  const staticUsedLeafKeys = new Set();
  const codeKeysMissingFromLocale = new Set();
  const dynamicCoveredLeafKeys = new Set();
  const dynamicPatternMatches = [];

  for (const filePath of sourceFiles) {
    const content = fs.readFileSync(filePath, 'utf8');

    // Direct t(...) / i18n.t(...) references are the strongest signal and can be missing from locale.
    for (const candidate of extractTCallTranslationCandidates(content)) {
      if (allLocaleKeys.has(candidate)) {
        if (leafLocaleKeys.has(candidate)) {
          staticUsedLeafKeys.add(candidate);
        }
      } else {
        codeKeysMissingFromLocale.add(candidate);
      }
    }

    // Also inspect quoted config strings, but only inside known locale namespaces to limit false positives.
    for (const candidate of extractQuotedTranslationCandidates(content)) {
      const namespace = candidate.split('.')[0];
      if (!localeNamespaces.has(namespace)) {
        continue;
      }

      if (allLocaleKeys.has(candidate)) {
        if (leafLocaleKeys.has(candidate)) {
          staticUsedLeafKeys.add(candidate);
        }
      } else {
        codeKeysMissingFromLocale.add(candidate);
      }
    }

    // Template-literal matches are treated as dynamic coverage, not explicit single-key references.
    for (const { template, regex } of extractDynamicTemplatePatterns(content)) {
      const matches = [...leafLocaleKeys].filter(key => regex.test(key));
      if (matches.length === 0) {
        continue;
      }

      matches.forEach(key => dynamicCoveredLeafKeys.add(key));
      dynamicPatternMatches.push({
        filePath,
        template,
        matchCount: matches.length,
      });
    }
  }

  // Unused keys remain candidates because dynamic/runtime-only references can still exist outside these patterns.
  const usedLeafKeys = new Set([...staticUsedLeafKeys, ...dynamicCoveredLeafKeys]);
  const unusedLeafKeys = [...leafLocaleKeys].filter(key => !usedLeafKeys.has(key)).sort();

  return {
    localeFilePath,
    totalLeafKeys: leafLocaleKeys.size,
    totalAllKeys: allLocaleKeys.size,
    sourceFileCount: sourceFiles.length,
    staticUsedLeafKeys: [...staticUsedLeafKeys].sort(),
    dynamicCoveredLeafKeys: [...dynamicCoveredLeafKeys].sort(),
    usedLeafKeys: [...usedLeafKeys].sort(),
    unusedLeafKeys,
    codeKeysMissingFromLocale: [...codeKeysMissingFromLocale].sort(),
    unusedSummary: summarizeByTopLevel(unusedLeafKeys),
    dynamicPatternMatches: dynamicPatternMatches.sort((a, b) => b.matchCount - a.matchCount),
  };
}

// Keep the CLI output human-readable so the script is useful both locally and in CI logs.
function printUsageReport(localeName, report, verbose = false) {
  console.log(`Locale usage report: ${localeName}\n`);
  console.log(`Locale file: ${report.localeFilePath}`);
  console.log(`Source files scanned: ${report.sourceFileCount}`);
  console.log(`Leaf keys in locale: ${report.totalLeafKeys}`);
  console.log(`Used leaf keys: ${report.usedLeafKeys.length}`);
  console.log(`  - Static/literal coverage: ${report.staticUsedLeafKeys.length}`);
  console.log(`  - Dynamic template coverage: ${report.dynamicCoveredLeafKeys.length}`);
  console.log(`Unused candidate leaf keys: ${report.unusedLeafKeys.length}`);
  console.log(`Code references missing from locale: ${report.codeKeysMissingFromLocale.length}`);

  if (report.codeKeysMissingFromLocale.length > 0) {
    console.log(`\nKeys referenced in code but missing from ${localeName}:`);
    report.codeKeysMissingFromLocale.forEach(key => console.log(`   - ${key}`));
  }

  if (report.unusedLeafKeys.length > 0) {
    console.log(`\nUnused candidate leaf keys in ${localeName}:`);
    const previewLimit = verbose ? report.unusedLeafKeys.length : 80;
    report.unusedLeafKeys.slice(0, previewLimit).forEach(key => console.log(`   - ${key}`));
    if (!verbose && report.unusedLeafKeys.length > previewLimit) {
      console.log(`   ... and ${report.unusedLeafKeys.length - previewLimit} more`);
    }

    if (report.unusedSummary.length > 0) {
      console.log('\nUnused candidate summary by namespace:');
      report.unusedSummary.forEach(([namespace, count]) => {
        console.log(`   - ${namespace}: ${count}`);
      });
    }
  } else {
    console.log(`\nNo unused leaf key candidates found in ${localeName}.`);
  }

  if (verbose && report.dynamicPatternMatches.length > 0) {
    console.log('\nDynamic template patterns that matched locale keys:');
    report.dynamicPatternMatches.forEach(({ filePath, template, matchCount }) => {
      console.log(`   - ${path.relative(process.cwd(), filePath)} :: \`${template}\` (${matchCount} matches)`);
    });
  }
}

// Reorder target JSON to match base structure
function reorderToMatchBase(baseObj, targetObj) {
  const result = {};

  // First, add all keys from base in the same order
  for (const [key, value] of Object.entries(baseObj)) {
    if (key in targetObj) {
      // Key exists in target, check if it's an object
      if (typeof value === 'object' && value !== null && !Array.isArray(value) &&
          typeof targetObj[key] === 'object' && targetObj[key] !== null && !Array.isArray(targetObj[key])) {
        // Recursively reorder nested objects
        result[key] = reorderToMatchBase(value, targetObj[key]);
      } else {
        // Use target's value
        result[key] = targetObj[key];
      }
    } else {
      // Key missing in target, copy from base
      result[key] = value;
    }
  }

  // Then, add any extra keys from target that don't exist in base
  for (const [key, value] of Object.entries(targetObj)) {
    if (!(key in baseObj)) {
      result[key] = value;
    }
  }

  return result;
}

// Sync missing keys to target file
function syncMissingKeys(baseFilePath, targetFilePath, missingKeys) {
  const baseJson = loadJsonFile(baseFilePath);
  const targetJson = loadJsonFile(targetFilePath);

  if (!baseJson || !targetJson) {
    return false;
  }

  let updated = false;
  const updatedJson = { ...targetJson };

  for (const keyPath of missingKeys) {
    const value = getValueByPath(baseJson, keyPath);
    if (value !== undefined) {
      setValueByPath(updatedJson, keyPath, value);
      updated = true;
    }
  }

  if (updated) {
    return saveJsonFile(targetFilePath, updatedJson);
  }

  return true;
}

// Align target file structure with base file
function alignWithBase(baseFilePath, targetFilePath) {
  const baseJson = loadJsonFile(baseFilePath);
  const targetJson = loadJsonFile(targetFilePath);

  if (!baseJson || !targetJson) {
    return false;
  }

  const reorderedJson = reorderToMatchBase(baseJson, targetJson);
  return saveJsonFile(targetFilePath, reorderedJson);
}

// Delete a key from nested object by path
function deleteKeyByPath(obj, path) {
  const keys = path.split('.');
  const lastKey = keys.pop();

  const target = keys.reduce((current, key) => {
    if (!current || typeof current !== 'object') {
      return null;
    }
    return current[key];
  }, obj);

  if (target && lastKey in target) {
    delete target[lastKey];
    return true;
  }
  return false;
}

// Remove specified keys from a file
function removeKeys(filePath, keysToRemove) {
  const json = loadJsonFile(filePath);

  if (!json) {
    return false;
  }

  let removed = 0;
  for (const keyPath of keysToRemove) {
    if (deleteKeyByPath(json, keyPath)) {
      removed++;
    }
  }

  if (removed > 0) {
    return { success: saveJsonFile(filePath, json), removed };
  }

  return { success: true, removed: 0 };
}

// Remove keys from all language files
function removeKeysFromAll(keysToRemove, localesDir, languages = null) {
  const results = [];

  const dirs = languages || fs.readdirSync(localesDir)
    .filter(dir => fs.statSync(path.join(localesDir, dir)).isDirectory());

  console.log(`Removing keys from language files:\n`);
  console.log(`Keys to remove: ${keysToRemove.join(', ')}\n`);

  for (const lang of dirs) {
    const langPath = path.join(localesDir, lang, 'index.json');

    if (!fs.existsSync(langPath)) {
      console.log(`Warning: ${lang}/index.json file does not exist`);
      continue;
    }

    const result = removeKeys(langPath, keysToRemove);

    if (result.success) {
      if (result.removed > 0) {
        console.log(`${lang}: Removed ${result.removed} key(s)`);
        results.push({ lang, removed: result.removed, success: true });
      } else {
        console.log(`Info: ${lang}: No matching keys found`);
        results.push({ lang, removed: 0, success: true });
      }
    } else {
      console.log(`${lang}: Operation failed`);
      results.push({ lang, removed: 0, success: false });
    }
  }

  console.log('\nRemoval summary:');
  const totalRemoved = results.reduce((sum, r) => sum + r.removed, 0);
  console.log(`   Total: Removed ${totalRemoved} key(s) across ${results.filter(r => r.removed > 0).length} file(s)`);

  return results;
}

// Compare keys between two files
function compareKeys(file1Path, file2Path) {
  const json1 = loadJsonFile(file1Path);
  const json2 = loadJsonFile(file2Path);
  
  if (!json1 || !json2) {
    return null;
  }
  
  const keys1 = getAllKeys(json1);
  const keys2 = getAllKeys(json2);
  
  const onlyInFile1 = [...keys1].filter(key => !keys2.has(key));
  const onlyInFile2 = [...keys2].filter(key => !keys1.has(key));
  
  return {
    file1: path.basename(file1Path),
    file2: path.basename(file2Path),
    onlyInFile1,
    onlyInFile2,
    totalKeys1: keys1.size,
    totalKeys2: keys2.size,
    file1Path,
    file2Path
  };
}

// Compare every locale directory against one base locale.
// Optional follow-up actions:
// - `--sync`: copy missing keys from base into target
// - `--align`: reorder target keys to match base structure
function compareAllWithBase(baseFile, localesDir, autoSync = false, alignKeys = false) {
  const basePath = path.join(localesDir, baseFile, 'index.json');

  if (!fs.existsSync(basePath)) {
    console.error(`Base file does not exist: ${basePath}`);
    return;
  }

  const languages = fs.readdirSync(localesDir)
    .filter(dir => fs.statSync(path.join(localesDir, dir)).isDirectory())
    .filter(dir => dir !== baseFile);

  console.log(`Comparing other language files with ${baseFile} as base:\n`);

  let hasAnyDifference = false;
  let syncResults = [];

  for (const lang of languages) {
    const langPath = path.join(localesDir, lang, 'index.json');

    if (!fs.existsSync(langPath)) {
      console.log(`Warning: ${lang}/index.json file does not exist`);
      continue;
    }

    const result = compareKeys(basePath, langPath);
    if (!result) continue;

    const hasDifference = result.onlyInFile1.length > 0 || result.onlyInFile2.length > 0;

    if (hasDifference) {
      hasAnyDifference = true;
      console.log(`${baseFile} vs ${lang}:`);
      console.log(`   ${baseFile}: ${result.totalKeys1} keys, ${lang}: ${result.totalKeys2} keys`);

      if (result.onlyInFile1.length > 0) {
        console.log(`   Missing keys in ${lang} (${result.onlyInFile1.length}):`);
        result.onlyInFile1.sort().forEach(key => console.log(`      - ${key}`));

        if (autoSync) {
          console.log(`   Syncing missing keys to ${lang}...`);
          const syncSuccess = syncMissingKeys(basePath, langPath, result.onlyInFile1);
          if (syncSuccess) {
            console.log(`   Successfully synced ${result.onlyInFile1.length} keys to ${lang}`);
            syncResults.push({ lang, synced: result.onlyInFile1.length, aligned: false, success: true });
          } else {
            console.log(`   Sync failed: ${lang}`);
            syncResults.push({ lang, synced: 0, aligned: false, success: false });
          }
        }
      }

      if (result.onlyInFile2.length > 0) {
        console.log(`   Extra keys in ${lang} (${result.onlyInFile2.length}):`);
        result.onlyInFile2.sort().forEach(key => console.log(`      - ${key}`));
      }
      console.log('');
    } else {
      console.log(`${lang}: Fully consistent with base file (${result.totalKeys2} keys)`);
    }

    // Align key order if requested
    if (alignKeys) {
      console.log(`   Aligning key order in ${lang}...`);
      const alignSuccess = alignWithBase(basePath, langPath);
      if (alignSuccess) {
        console.log(`   Successfully aligned ${lang} with base structure`);
        const existingResult = syncResults.find(r => r.lang === lang);
        if (existingResult) {
          existingResult.aligned = true;
        } else {
          syncResults.push({ lang, synced: 0, aligned: true, success: true });
        }
      } else {
        console.log(`   Alignment failed: ${lang}`);
      }
      console.log('');
    }
  }

  if (!hasAnyDifference && !alignKeys) {
    console.log('All language files are consistent with the base file!');
  } else if ((autoSync || alignKeys) && syncResults.length > 0) {
    console.log('\nOperation results summary:');
    syncResults.forEach(({ lang, synced, aligned, success }) => {
      if (success) {
        const operations = [];
        if (synced > 0) operations.push(`synced ${synced} keys`);
        if (aligned) operations.push('aligned structure');
        console.log(`   ${lang}: ${operations.join(', ') || 'processed'}`);
      } else {
        console.log(`   ${lang}: Operation failed`);
      }
    });
  }
}

// Compare two specified files
function compareTwoFiles(file1, file2, localesDir) {
  const file1Path = path.join(localesDir, file1, 'index.json');
  const file2Path = path.join(localesDir, file2, 'index.json');
  
  if (!fs.existsSync(file1Path)) {
    console.error(`File does not exist: ${file1Path}`);
    return;
  }

  if (!fs.existsSync(file2Path)) {
    console.error(`File does not exist: ${file2Path}`);
    return;
  }
  
  const result = compareKeys(file1Path, file2Path);
  if (!result) return;
  
  console.log(`Comparison result: ${file1} vs ${file2}\n`);
  console.log(`${file1}: ${result.totalKeys1} keys`);
  console.log(`${file2}: ${result.totalKeys2} keys\n`);

  if (result.onlyInFile1.length === 0 && result.onlyInFile2.length === 0) {
    console.log('Both files have identical keys!');
    return;
  }

  if (result.onlyInFile1.length > 0) {
    console.log(`Missing keys in ${file2} (${result.onlyInFile1.length}):`);
    result.onlyInFile1.sort().forEach(key => console.log(`   - ${key}`));
    console.log('');
  }

  if (result.onlyInFile2.length > 0) {
    console.log(`Extra keys in ${file2} (${result.onlyInFile2.length}):`);
    result.onlyInFile2.sort().forEach(key => console.log(`   - ${key}`));
  }
}

// CLI entrypoint:
// - default / compare mode operates on locale JSON files
// - usage mode scans frontend source and compares it against one locale
function main() {
  const args = process.argv.slice(2);
  const localesDir = path.join(__dirname, '../src/locales');
  const sourceDir = path.join(__dirname, '../src');
  
  if (!fs.existsSync(localesDir)) {
    console.error(`Locales directory does not exist: ${localesDir}`);
    process.exit(1);
  }

  // Check for --remove parameter
  const removeIndex = args.indexOf('--remove');
  if (removeIndex !== -1) {
    args.splice(removeIndex, 1); // Remove --remove parameter
    if (args.length === 0) {
      console.error('Error: --remove requires at least one key to remove');
      console.log('\nUsage:');
      console.log('  node compare-locales.mjs --remove key1 [key2 ...]');
      console.log('  node compare-locales.mjs --remove settings.theme header.logo');
      process.exit(1);
    }
    // All remaining args are keys to remove
    removeKeysFromAll(args, localesDir);
    return;
  }

  // Check for --sync and --align parameters
  const syncIndex = args.indexOf('--sync');
  const autoSync = syncIndex !== -1;
  if (autoSync) {
    args.splice(syncIndex, 1); // Remove --sync parameter
  }

  const alignIndex = args.indexOf('--align');
  const alignKeys = alignIndex !== -1;
  if (alignKeys) {
    args.splice(alignIndex, 1); // Remove --align parameter
  }

  const usageIndex = args.indexOf('--usage');
  const checkUsage = usageIndex !== -1;
  if (checkUsage) {
    args.splice(usageIndex, 1);
  }

  const verboseUsageIndex = args.indexOf('--verbose-usage');
  const verboseUsage = verboseUsageIndex !== -1;
  if (verboseUsage) {
    args.splice(verboseUsageIndex, 1);
  }

  // Usage mode is intentionally separate from locale-vs-locale comparison:
  // it answers "does the code reference keys that this locale does not define?"
  if (checkUsage || verboseUsage) {
    const localeName = args[0] || 'en';
    const localeFilePath = path.join(localesDir, localeName, 'index.json');

    if (!fs.existsSync(localeFilePath)) {
      console.error(`Locale file does not exist: ${localeFilePath}`);
      process.exit(1);
    }

    const report = analyzeLocaleUsage(localeFilePath, sourceDir);
    if (!report) {
      process.exit(1);
    }

    printUsageReport(localeName, report, verboseUsage);
    return;
  }

  if (args.length === 0) {
    // Default: compare all files with en as base
    compareAllWithBase('en', localesDir, autoSync, alignKeys);
  } else if (args.length === 1) {
    // Compare all files with specified language as base
    compareAllWithBase(args[0], localesDir, autoSync, alignKeys);
  } else if (args.length === 2) {
    // Compare two specified files
    compareTwoFiles(args[0], args[1], localesDir);
  } else {
    console.log('Usage:');
    console.log('  node compare-locales.mjs                    # Compare all files with en as base');
    console.log('  node compare-locales.mjs --sync             # Compare with en and auto-sync missing keys');
    console.log('  node compare-locales.mjs --align            # Align key order with en structure');
    console.log('  node compare-locales.mjs --sync --align     # Sync missing keys and align structure');
    console.log('  node compare-locales.mjs --usage            # Check en locale keys against frontend code usage');
    console.log('  node compare-locales.mjs zh-CN --usage      # Check zh-CN locale keys against frontend code usage');
    console.log('  node compare-locales.mjs --verbose-usage    # Usage check with dynamic pattern details');
    console.log('  node compare-locales.mjs zh-CN              # Compare all files with zh-CN as base');
    console.log('  node compare-locales.mjs zh-CN --sync       # Compare with zh-CN and auto-sync');
    console.log('  node compare-locales.mjs ja ko              # Compare ja and ko files');
    console.log('  node compare-locales.mjs --remove key1 key2 # Remove specified keys from all files');
    process.exit(1);
  }
}

main();
