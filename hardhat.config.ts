import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
require("dotenv").config();

if (!process.env.RPC_URL || !process.env.OPERATOR_KEY) {
  throw new Error("Missing environment variables: RPC_URL or OPERATOR_KEY");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.28",
  },
  networks: {
    hardhat: {
      
      accounts: {
        count: 10, 
      },
    },
    testnet: {
      // HashIO RPC testnet endpoint in the .env file
      url: process.env.RPC_URL,
      // Your ECDSA account private key pulled from the .env file
      accounts: [process.env.OPERATOR_KEY],
    }
  }
};

export default config;
