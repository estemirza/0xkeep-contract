import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.19",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    // 1. BASE SEPOLIA
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY_TEST ? [process.env.PRIVATE_KEY_TEST] : [],
      chainId: 84532,
    },
    // 1. BASE MAINNET
    base: {
      url: "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453,
    },
    // 2. ARBITRUM ONE
    arbitrum: {
      url: "https://arb1.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 42161,
    },
    // 3. OPTIMISM
    optimism: {
      url: "https://mainnet.optimism.io",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 10,
    },
  },
  etherscan: {
    // Keep your API key mapping
    apiKey: {
      base: process.env.ETHERSCAN_API_KEY || "",
      arbitrumOne: process.env.ETHERSCAN_API_KEY || "",
      optimisticEthereum: process.env.ETHERSCAN_API_KEY || "",
    },
    // DELETE the entire 'customChains' array. 
    // Hardhat already knows Base, Arbitrum, and Optimism.
  },
  sourcify: {
    enabled: true
  }
};

export default config;