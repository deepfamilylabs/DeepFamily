// Independent dependency imports (declared in root package.json)
// eslint-disable-next-line @typescript-eslint/no-var-requires
const IpfsHash = require("ipfs-only-hash");
const { ethers } = require("ethers");

function normalizePersonInfo(info) {
  if (!info) return null;
  return {
    fullName: info.fullName || "",
    gender: Number(info.gender) || 0,
    birthYear: Number(info.birthYear) || 0,
    birthMonth: Number(info.birthMonth) || 0,
    birthDay: Number(info.birthDay) || 0,
    isBirthBC: Boolean(info.isBirthBC),
  };
}

/**
 * Build deterministic metadata payload for person version.
 * Note: passphrase is deliberately omitted to avoid leaking secrets.
 */
function buildVersionMetadataPayload({
  tag = "",
  personInfo,
  fatherInfo,
  motherInfo,
  fatherVersionIndex = 0,
  motherVersionIndex = 0,
  personHash = ethers.ZeroHash,
  fatherHash = ethers.ZeroHash,
  motherHash = ethers.ZeroHash,
}) {
  const empty = {
    fullName: "",
    gender: 0,
    birthYear: 0,
    birthMonth: 0,
    birthDay: 0,
    isBirthBC: false,
  };

  const person = normalizePersonInfo(personInfo) || empty;
  const father = normalizePersonInfo(fatherInfo) || empty;
  const mother = normalizePersonInfo(motherInfo) || empty;

  return {
    schema: "deepfamily/person-version@1.0",
    tag: tag || "",
    person: {
      fullName: person.fullName,
      gender: person.gender,
      birthYear: person.birthYear,
      birthMonth: person.birthMonth,
      birthDay: person.birthDay,
      isBirthBC: person.isBirthBC,
      personHash: personHash || ethers.ZeroHash,
    },
    parents: {
      father: {
        fullName: father.fullName,
        gender: father.gender,
        birthYear: father.birthYear,
        birthMonth: father.birthMonth,
        birthDay: father.birthDay,
        isBirthBC: father.isBirthBC,
        personHash: fatherHash || ethers.ZeroHash,
        versionIndex: Number.isFinite(fatherVersionIndex) ? Number(fatherVersionIndex) : 0,
      },
      mother: {
        fullName: mother.fullName,
        gender: mother.gender,
        birthYear: mother.birthYear,
        birthMonth: mother.birthMonth,
        birthDay: mother.birthDay,
        isBirthBC: mother.isBirthBC,
        personHash: motherHash || ethers.ZeroHash,
        versionIndex: Number.isFinite(motherVersionIndex) ? Number(motherVersionIndex) : 0,
      },
    },
  };
}


async function generateCIDIpfs(jsonString) {
  return await IpfsHash.of(jsonString, { cidVersion: 1, rawLeaves: true });
}

async function generateMetadataCID(jsonString) {
  return await generateCIDIpfs(jsonString);
}

module.exports = {
  buildVersionMetadataPayload,
  generateMetadataCID,
  generateCIDIpfs,
};
