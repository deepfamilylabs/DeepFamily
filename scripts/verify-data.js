// Support command line argument to specify data file
const dataFile = process.argv[2] || "en-family.json";
const dataPath = dataFile.includes("/")
  ? dataFile
  : `../data/historical-persons/${dataFile}`;

const data = require(dataPath);

console.log("\n" + "=".repeat(70));
console.log("📊 " + data.familyName + " Final Data Report");
console.log("=".repeat(70));

console.log("\n【Family Information】");
console.log("  Family Name:", data.familyName);
console.log("  Total Members:", data.members.length);

// Statistics by generation
const byGen = {};
const mintByGen = {};

data.members.forEach(m => {
  if (!byGen[m.generation]) {
    byGen[m.generation] = [];
    mintByGen[m.generation] = { mint: 0, skip: 0 };
  }
  byGen[m.generation].push(m);

  if (m.mintNFT !== false) {
    mintByGen[m.generation].mint++;
  } else {
    mintByGen[m.generation].skip++;
  }
});

console.log("\n【Statistics by Generation】");
Object.keys(byGen).sort().forEach(gen => {
  const total = byGen[gen].length;
  const mint = mintByGen[gen].mint;
  const skip = mintByGen[gen].skip;
  const mintRate = ((mint / total) * 100).toFixed(0);
  console.log("  Generation " + gen + ": " + total + " persons  |  Mint NFT: " + mint + " (" + mintRate + "%)  |  Skip: " + skip);
});

// Total
const totalMint = data.members.filter(m => m.mintNFT !== false).length;
const totalSkip = data.members.filter(m => m.mintNFT === false).length;
const totalMintRate = ((totalMint / data.members.length) * 100).toFixed(1);

console.log("\n【NFT Minting Statistics】");
console.log("  Will mint NFT: " + totalMint + " persons (" + totalMintRate + "%)");
console.log("  Skip minting: " + totalSkip + " persons (" + (100-parseFloat(totalMintRate)).toFixed(1) + "%)");

// Validate parent relationships
console.log("\n【Family Relationship Validation】");
let validRelations = 0;

data.members.forEach(m => {
  if (m.fatherName) {
    const father = data.members.find(p => p.fullName === m.fatherName);
    if (father) {
      validRelations++;
    }
  }
});

console.log("  Valid parent relationships: " + validRelations);

// Detailed list of last generation
const maxGen = Math.max(...Object.keys(byGen).map(Number));
if (byGen[maxGen] && byGen[maxGen].length > 0) {
  console.log("\n【Generation " + maxGen + " Member Details】(Total: " + byGen[maxGen].length + " persons)");
  byGen[maxGen].forEach((m, i) => {
    const nftStatus = m.mintNFT !== false ? "✓ Mint" : "⊘ Skip";
    const num = String(i+1).padStart(2, ' ');
    console.log("  " + num + ". " + m.fullName.padEnd(40) + nftStatus);
  });
}

console.log("\n" + "=".repeat(70));
console.log("✅ Data validation complete!");
console.log("=".repeat(70));
