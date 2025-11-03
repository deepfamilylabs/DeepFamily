/**
 * seed-historical.js
 * Generate demo data using real historical person data
 * Features:
 * - Historical persons without copyright issues (public domain)
 * - 18 chunk types corresponding to real biographical content
 * - Each chunk close to 2048 byte limit
 * - Real family relationships
 * - Data and logic separated (loaded from JSON files)
 */

const hre = require("hardhat");
const { ethers } = hre;
const path = require("path");
const fs = require("fs");
const {
  addPersonVersion,
  endorseVersion,
  mintPersonNFT,
  computePersonHash,
  checkPersonExists,
} = require("../lib/seedHelpers");

// ========== Constants Configuration ==========

const MAX_CHUNK_CONTENT_LENGTH = 2048;
const MAX_LONG_TEXT_LENGTH = 256;

// Data file paths
const DATA_DIR = path.join(__dirname, "..", "data", "historical-persons");
const DEFAULT_DATA_FILE = "en-family.json";

// Environment variables configuration
const DATA_FILE = process.env.HISTORICAL_DATA_FILE || DEFAULT_DATA_FILE;
const SKIP_CHUNKS = process.env.SKIP_CHUNKS === "true";
const CHUNKS_LIMIT = parseInt(process.env.CHUNKS_LIMIT || "18", 10);

// ========== Utility Functions ==========

// UTF-8 byte length calculation
function utf8ByteLen(s) {
  return Buffer.byteLength(s, "utf8");
}

// UTF-8 safe truncation (avoid cutting multi-byte characters)
function truncateUtf8Bytes(str, maxBytes) {
  if (utf8ByteLen(str) <= maxBytes) return str;
  let res = "";
  for (const ch of str) {
    const nb = utf8ByteLen(ch);
    if (utf8ByteLen(res) + nb > maxBytes) break;
    res += ch;
  }
  return res;
}

// keccak256 string hash
function solidityStringHash(content) {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

// ========== Data Loading and Validation ==========

/**
 * Load historical person data
 * @param {string} filename - JSON file name
 * @returns {Object} Family data object
 */
function loadHistoricalData(filename) {
  const filePath = path.join(DATA_DIR, filename);

  if (!fs.existsSync(filePath)) {
    throw new Error(`Data file not found: ${filePath}`);
  }

  try {
    const rawData = fs.readFileSync(filePath, "utf8");
    const data = JSON.parse(rawData);

    // Validate data structure
    validateFamilyData(data);

    console.log(`✓ Loaded data: ${data.familyName}`);
    console.log(`  Description: ${data.description}`);
    console.log(`  Members: ${data.members.length}\n`);

    return data;
  } catch (error) {
    throw new Error(`Failed to load data file: ${error.message}`);
  }
}

/**
 * Validate family data structure
 * @param {Object} data - Family data
 */
function validateFamilyData(data) {
  if (!data.familyName) {
    throw new Error("Missing required field: familyName");
  }

  if (!Array.isArray(data.members) || data.members.length === 0) {
    throw new Error("Invalid or empty members array");
  }

  // Validate each member
  data.members.forEach((member, index) => {
    const required = ["fullName", "birthYear", "gender", "generation"];
    for (const field of required) {
      if (member[field] === undefined || member[field] === null) {
        throw new Error(
          `Member ${index} (${member.fullName || "unknown"}) missing required field: ${field}`
        );
      }
    }

    // Validate storyData exists
    if (!member.storyData || typeof member.storyData !== "object") {
      throw new Error(
        `Member ${index} (${member.fullName}) missing storyData object`
      );
    }
  });

  console.log("✓ Data validation passed");
}

// ========== Content Generator ==========

/**
 * Generate high-quality content based on chunk type
 * Each chunk is close to the 2048 byte limit
 */
class HistoricalContentGenerator {
  constructor(personData) {
    this.person = personData;
    this.storyData = personData.storyData || {};
  }

  /**
   * Generate chunk content for specified type
   * @param {number} chunkType - 0-17
   * @returns {string} Content close to 2048 bytes
   */
  generateChunk(chunkType) {
    let content = "";

    switch (chunkType) {
      case 0: // Summary
        content = this.generateSummary();
        break;
      case 1: // Early Life
        content = this.generateEarlyLife();
        break;
      case 2: // Education
        content = this.generateEducation();
        break;
      case 3: // Career
        content = this.generateCareer();
        break;
      case 4: // Works
        content = this.generateWorks();
        break;
      case 5: // Achievements
        content = this.generateAchievements();
        break;
      case 6: // Philosophy
        content = this.generatePhilosophy();
        break;
      case 7: // Quotes
        content = this.generateQuotes();
        break;
      case 8: // Anecdotes
        content = this.generateAnecdotes();
        break;
      case 9: // Family
        content = this.generateFamily();
        break;
      case 10: // Lifestyle
        content = this.generateLifestyle();
        break;
      case 11: // Relations
        content = this.generateRelations();
        break;
      case 12: // Activities
        content = this.generateActivities();
        break;
      case 13: // Positions
        content = this.generatePositions();
        break;
      case 14: // Controversies
        content = this.generateControversies();
        break;
      case 15: // Gallery
        content = this.generateGallery();
        break;
      case 16: // Legacy
        content = this.generateLegacy();
        break;
      case 17: // References
        content = this.generateReferences();
        break;
      default:
        content = `Content for ${this.person.fullName}, chunk type ${chunkType}. `;
    }

    // Pad to close to 2048 bytes
    return this.padToMaxLength(content);
  }

  generateSummary() {
    const base =
      this.storyData.summary ||
      `${this.person.fullName} (${this.person.birthYear}-${this.person.deathYear}) was a prominent historical figure. `;

    return `${base} This comprehensive summary provides an overview of their life, contributions, and historical significance. Born in ${this.person.birthPlace}, they lived during a transformative period in history. Their legacy continues to influence modern society through their work, ideas, and the institutions they helped create. `;
  }

  generateEarlyLife() {
    return (
      this.storyData.earlyLife ||
      `${this.person.fullName} was born on ${this.person.birthMonth}/${this.person.birthDay}/${this.person.birthYear} in ${this.person.birthPlace}. Their early years were formative, shaped by family circumstances, historical events, and the social conditions of the time. Growing up during this period meant experiencing firsthand the changes sweeping through society. Their childhood experiences would later inform their worldview and approach to life's challenges. `
    );
  }

  generateEducation() {
    return (
      this.storyData.education ||
      `The educational journey of ${this.person.fullName} reflects the opportunities and challenges of their era. Their formal schooling provided foundational knowledge, while informal learning shaped their practical skills and intellectual development. Education was highly valued in their family, and they pursued knowledge with dedication. Their academic achievements laid the groundwork for their future accomplishments. `
    );
  }

  generateCareer() {
    return (
      this.storyData.career ||
      `${this.person.fullName}'s professional career spanned multiple decades and encompassed various roles and responsibilities. Beginning in their early twenties, they embarked on a path that would define their public life. Their work demonstrated both vision and practical capability. They navigated complex professional landscapes, building relationships and creating opportunities. Their career trajectory shows evolution in thinking and approach over time. `
    );
  }

  generateWorks() {
    return (
      this.storyData.works ||
      `Throughout their lifetime, ${this.person.fullName} produced significant works that contributed to their field. These included written publications, speeches, policies, and other creative or intellectual outputs. Each work reflected their evolving understanding of important issues. Their most influential works continue to be studied and referenced. The body of work they left behind provides insight into their thinking and values. `
    );
  }

  generateAchievements() {
    return (
      this.storyData.achievements ||
      `The achievements of ${this.person.fullName} were numerous and significant. They broke barriers, set precedents, and accomplished goals that had seemed unattainable. Recognition came from peers, institutions, and the public. Their successes were built on talent, hard work, strategic thinking, and often good fortune. Some achievements were celebrated during their lifetime, while others gained recognition posthumously. `
    );
  }

  generatePhilosophy() {
    return (
      this.storyData.philosophy ||
      `${this.person.fullName}'s philosophical outlook shaped their decisions and actions throughout life. Their worldview was informed by personal experience, education, religious or spiritual beliefs, and the intellectual currents of their time. They held strong convictions about human nature, society's organization, and the proper role of individuals and institutions. These beliefs evolved over time as circumstances changed and new challenges emerged. `
    );
  }

  generateQuotes() {
    return (
      this.storyData.quotes ||
      `${this.person.fullName} was known for articulate expression of ideas and memorable turns of phrase. Their words inspired, provoked, comforted, and challenged listeners. Some quotes became famous during their lifetime, while others gained recognition later. Their verbal facility reflected both natural talent and practiced skill. The quotes attributed to them reveal core values and thinking patterns. `
    );
  }

  generateAnecdotes() {
    return `Stories and anecdotes about ${this.person.fullName} reveal character in ways formal biography cannot. Colleagues, family members, and observers shared tales illustrating their personality, habits, and manner of dealing with people and situations. Some anecdotes became legendary, told and retold with embellishments. Others remained within small circles. These stories humanize historical figures, showing quirks, humor, temper, generosity, and other traits. `;
  }

  generateFamily() {
    return (
      this.storyData.family ||
      `Family relationships were central to ${this.person.fullName}'s life. Born into a family with its own history and dynamics, they later created their own family unit. These relationships brought both joy and challenge. Family obligations and loyalties influenced major decisions. The family name carried both advantages and burdens. Balancing public duties with private family life was an ongoing negotiation. `
    );
  }

  generateLifestyle() {
    return (
      this.storyData.lifestyle ||
      `The lifestyle of ${this.person.fullName} reflected their values, resources, and the customs of their social class and era. Daily routines, recreation, social activities, and personal habits reveal much about their character. Their living arrangements evolved with changing circumstances and status. They maintained certain lifestyle choices throughout life while adapting others. Personal style in dress, entertainment, and domestic arrangements showed both conformity and individuality. `
    );
  }

  generateRelations() {
    return `${this.person.fullName} cultivated relationships across professional, political, social, and personal spheres. Some relationships were strategic, others genuine friendships. Mentors, proteges, rivals, allies, and adversaries all played roles in their life story. The quality of relationships often determined success or failure of initiatives. They demonstrated varying abilities in building, maintaining, and sometimes ending relationships as circumstances required. `;
  }

  generateActivities() {
    return `Beyond their primary occupation, ${this.person.fullName} engaged in various activities that rounded out their life. Hobbies, sports, cultural pursuits, community involvement, and other interests provided balance and fulfillment. Some activities were purely recreational, others served networking purposes. These engagements revealed aspects of personality not visible in public roles. Time allocation among competing activities reflected priorities and values. `;
  }

  generatePositions() {
    return `Throughout their career, ${this.person.fullName} held various formal positions and titles. Each role carried specific responsibilities, authorities, and constraints. Position changes marked career evolution and reflected achievements or setbacks. Some positions were stepping stones to greater influence, others represented ultimate accomplishments. The manner of acquiring and leaving positions reveals much about their political skill and reputation. `;
  }

  generateControversies() {
    return (
      this.storyData.controversies ||
      `Like most public figures, ${this.person.fullName} faced controversies during their lifetime and after. Decisions, statements, relationships, and actions generated criticism and debate. Some controversies stemmed from genuine mistakes, others from malicious attacks or historical reassessment. Their responses to controversy revealed character - some defended positions, others apologized, still others ignored criticism. Modern evaluation applies contemporary standards to historical actions, sometimes unfairly. `
    );
  }

  generateGallery() {
    return `Visual documentation of ${this.person.fullName}'s life includes photographs, portraits, news footage, and other imagery. These images capture moments both public and private - formal portraits, candid shots, ceremonial occasions, family gatherings. Early photographs show youth and vigor, later images reveal age's effects. Iconic images became symbols of their legacy. The evolution of photography and media during their lifetime meant increasing visual documentation over time. `;
  }

  generateLegacy() {
    return (
      this.storyData.legacy ||
      `The legacy of ${this.person.fullName} extends far beyond their lifetime. Their influence shaped institutions, inspired individuals, and altered historical trajectories. Some aspects of legacy were intentional, others unintended consequences. Reputation has evolved over time as new information emerged and values changed. Their name became associated with specific ideals, movements, or eras. Descendants, proteges, and institutions carry forward aspects of their work and vision. `
    );
  }

  generateReferences() {
    return `Historical sources documenting ${this.person.fullName}'s life include official records, personal papers, newspaper accounts, books, academic studies, oral histories, and archival materials. Primary sources provide direct evidence, while secondary sources offer analysis and interpretation. Biographies range from hagiographic to critical. Archives at major institutions hold relevant materials. Scholars continue producing new research and reinterpretations. `;
  }

  /**
   * Pad content to close to 2048 bytes
   */
  padToMaxLength(baseContent) {
    const fillerTemplates = [
      "Historical records provide additional context for understanding this period. ",
      "Contemporary observers noted the significance of these developments. ",
      "Scholars have debated the interpretation of these events for decades. ",
      "The historical context illuminates the choices and constraints faced. ",
      "Modern research has revealed previously unknown details about this era. ",
      "Primary sources offer direct insight into the thinking of the time. ",
      "The cultural and social environment shaped possibilities and limitations. ",
      "Economic factors played a crucial role in these developments. ",
      "Political considerations influenced decisions and outcomes significantly. ",
      "Personal correspondence reveals private thoughts and motivations. ",
      "Family papers provide glimpses into domestic and private life. ",
      "Official documents record formal actions and public statements. ",
      "Newspaper accounts capture contemporary public opinion and reaction. ",
      "Biographical research continues to uncover new information and perspectives. ",
      "Archival materials held at major institutions await further study. ",
    ];

    let content = baseContent;
    let fillerIndex = 0;

    while (utf8ByteLen(content) < MAX_CHUNK_CONTENT_LENGTH - 100) {
      content += fillerTemplates[fillerIndex % fillerTemplates.length];
      fillerIndex++;
    }

    return truncateUtf8Bytes(content, MAX_CHUNK_CONTENT_LENGTH);
  }
}

// ========== Person Data Creation Helper Functions ==========

function createPersonData(personInfo) {
  return {
    fullName: personInfo.fullName,
    birthYear: personInfo.birthYear,
    birthMonth: personInfo.birthMonth || 1,
    birthDay: personInfo.birthDay || 1,
    gender: personInfo.gender,
  };
}

function createSupplementInfo(personInfo) {
  return {
    deathYear: personInfo.deathYear || 0,
    deathMonth: personInfo.deathMonth || 0,
    deathDay: personInfo.deathDay || 0,
    birthPlace: personInfo.birthPlace || "",
    deathPlace: personInfo.deathPlace || "",
    story: truncateUtf8Bytes(
      personInfo.storyData.summary || "",
      MAX_LONG_TEXT_LENGTH
    ),
  };
}

// ========== Main Execution Function ==========

async function main() {
  console.log("=".repeat(60));
  console.log("Historical Persons Seed Script");
  console.log("=".repeat(60));

  // Load historical person data
  console.log(`Loading data file: ${DATA_FILE}`);
  const familyData = loadHistoricalData(DATA_FILE);

  // Get contract instances
  const deepFamilyAddr = (await hre.deployments.get("DeepFamily")).address;
  const tokenAddr = (await hre.deployments.get("DeepFamilyToken")).address;

  const deepFamily = await ethers.getContractAt("DeepFamily", deepFamilyAddr);
  const token = await ethers.getContractAt("DeepFamilyToken", tokenAddr);

  const [signer] = await ethers.getSigners();
  console.log(`Using signer: ${signer.address}\n`);

  // Step 1: Token approval
  console.log("Step 1: Preparing token approval...");
  const allowance = await token.allowance(signer.address, deepFamilyAddr);
  if (allowance === 0n) {
    const approveTx = await token.approve(deepFamilyAddr, ethers.MaxUint256);
    await approveTx.wait();
    console.log("✓ Token approved\n");
  } else {
    console.log("✓ Token already approved\n");
  }

  // Step 2: Add historical persons
  console.log(`Step 2: Adding ${familyData.familyName} members...`);

  const addedPersons = [];

  for (const personInfo of familyData.members) {
    console.log(
      `\nProcessing: ${personInfo.fullName} (Gen ${personInfo.generation})`
    );

    // Create person data
    const personData = createPersonData(personInfo);

    // Add passphrase to personData
    const personDataWithPassphrase = {
      ...personData,
      passphrase: personInfo.passphrase || `${familyData.familyName}-tree`,
    };

    // Compute personHash
    const personHash = await computePersonHash({
      deepFamily,
      personData: personDataWithPassphrase,
    });

    // Check if already exists
    const exists = await checkPersonExists({ deepFamily, personHash });

    if (exists.exists) {
      console.log(`  ○ Already exists: ${personInfo.fullName} (versions: ${exists.totalVersions})`);
      const savedPerson = {
        ...personInfo,
        hash: personHash,
        version: 1, // Use first version
        personData: personDataWithPassphrase,
      };
      addedPersons.push(savedPerson);
      continue;
    }

    // Find parent data
    let fatherData = null;
    let fatherVersion = 0;

    if (personInfo.fatherName) {
      const father = addedPersons.find(
        (p) => p.fullName === personInfo.fatherName
      );
      if (father) {
        fatherData = father.personData;
        fatherVersion = father.version;
        console.log(`  Father: ${personInfo.fatherName} (v${fatherVersion})`);
      } else {
        console.log(
          `  Warning: Father "${personInfo.fatherName}" not found`
        );
      }
    }

    let motherData = null;
    let motherVersion = 0;

    if (personInfo.motherName) {
      const mother = addedPersons.find(
        (p) => p.fullName === personInfo.motherName
      );
      if (mother) {
        motherData = mother.personData;
        motherVersion = mother.version;
        console.log(`  Mother: ${personInfo.motherName} (v${motherVersion})`);
      }
    }

    // Add person (using ZK proof)
    await addPersonVersion({
      deepFamily,
      signer,
      personData: personDataWithPassphrase,
      fatherData,
      motherData,
      fatherVersion,
      motherVersion,
      tag: personInfo.tag || `gen${personInfo.generation}`,
      ipfs: personInfo.metadataCID ||
        `ipfs://${familyData.familyName.toLowerCase().replace(/ /g, "-")}/${personInfo.fullName.replace(/ /g, "-")}`,
    });

    const savedPerson = {
      ...personInfo,
      hash: personHash,
      version: 1, // Newly added version index is 1
      personData: personDataWithPassphrase,
    };
    addedPersons.push(savedPerson);

    console.log(`✓ Added ${personInfo.fullName}`);
    console.log(`  Hash: ${personHash.slice(0, 10)}...`);
    console.log(`  Version: 1`);
  }

  console.log(
    `\n✓ Family tree complete: ${addedPersons.length} persons added\n`
  );

  // Step 3: Mint NFTs and add Story Chunks
  console.log("Step 3: Minting NFTs and adding story chunks...");

  let nftCount = 0;
  let skippedCount = 0;
  let totalChunks = 0;

  for (const person of addedPersons) {
    // Check if NFT should be minted (defaults to true for backward compatibility)
    const shouldMintNFT = person.mintNFT !== false;

    if (!shouldMintNFT) {
      console.log(`\n⊘ Skipping NFT for: ${person.fullName} (mintNFT=false)`);
      skippedCount++;
      continue;
    }

    console.log(`\nProcessing NFT for: ${person.fullName}`);

    // Endorse
    console.log("  Endorsing...");
    await endorseVersion({
      deepFamily,
      token,
      signer,
      personHash: person.hash,
      versionIndex: person.version,
      autoApprove: true,
    });

    // Mint NFT
    console.log("  Minting NFT...");
    const supplementInfo = createSupplementInfo(person);

    const mintResult = await mintPersonNFT({
      deepFamily,
      signer,
      personHash: person.hash,
      versionIndex: person.version,
      tokenURI: `ipfs://${familyData.familyName.toLowerCase().replace(/ /g, "-")}-nft/${person.fullName.replace(/ /g, "-")}`,
      basicInfo: person.personData,
      supplementInfo,
    });

    const tokenId = mintResult.tokenId;
    console.log(`  ✓ NFT minted, tokenId: ${tokenId}`);
    nftCount++;

    // Add Story Chunks (optional, controlled by environment variable)
    if (!SKIP_CHUNKS) {
      console.log(`  Adding story chunks (limit: ${CHUNKS_LIMIT})...`);
      const generator = new HistoricalContentGenerator(person);

      const chunksToAdd = Math.min(CHUNKS_LIMIT, 18);

      for (let chunkType = 0; chunkType < chunksToAdd; chunkType++) {
        const content = generator.generateChunk(chunkType);
        const expectedHash = solidityStringHash(content);
        const attachmentCID = `ipfs://${familyData.familyName.toLowerCase().replace(/ /g, "-")}-chunk/${person.fullName.replace(/ /g, "-")}/type${chunkType}`;

        const chunkTx = await deepFamily.addStoryChunk(
          tokenId,
          chunkType, // Use chunkType as index
          chunkType,
          content,
          attachmentCID,
          expectedHash
        );
        await chunkTx.wait();
        totalChunks++;
      }

      console.log(`  ✓ Added ${chunksToAdd} story chunks`);
    } else {
      console.log("  Skipping story chunks (SKIP_CHUNKS=true)");
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Seed Complete!");
  console.log("=".repeat(60));
  console.log(`Family: ${familyData.familyName}`);
  console.log(`Total persons added: ${addedPersons.length}`);
  console.log(`NFTs minted: ${nftCount}`);
  console.log(`NFTs skipped: ${skippedCount}`);
  console.log(`Total story chunks: ${totalChunks}`);
  if (nftCount > 0 && totalChunks > 0) {
    console.log(`Average chunks per NFT: ${(totalChunks / nftCount).toFixed(1)}`);
  }
  console.log("=".repeat(60));
}

// Execute
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n" + "=".repeat(60));
    console.error("ERROR:");
    console.error("=".repeat(60));
    console.error(error);
    console.error("=".repeat(60));
    process.exit(1);
  });
