// Isolated EDR only. No dotenv, RPC endpoints, live wallets or production sources.
import hardhatEthers from "@nomicfoundation/hardhat-ethers";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
const scratch=fs.mkdtempSync(path.join(os.tmpdir(),"deepfamily-composition-hardhat-"));
export default {
 plugins:[hardhatEthers],
 paths:{sources:{solidity:path.join(scratch,"sources")},cache:path.join(scratch,"cache"),artifacts:path.join(scratch,"artifacts")},
 solidity:{version:"0.8.28"},
 networks:{default:{type:"edr-simulated",chainId:31337,allowUnlimitedContractSize:false,blockGasLimit:30000000}}
};
