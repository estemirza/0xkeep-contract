import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// ─────────────────────────────────────────────
// SAFETY GUARD
// If these are missing, stop immediately rather
// than deploying from the wrong wallet.
// ─────────────────────────────────────────────
if (
  process.env.npm_lifecycle_event !== "compile" &&
  process.env.npm_lifecycle_event !== "test"
) {
  if (!process.env.PRIVATE_KEY) {
    throw new Error("❌ PRIVATE_KEY is not set in your .env file. Aborting.");
  }
}

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
    // ── TESTNETS ──────────────────────────────
    baseSepolia: {
      url: "https://sepolia.base.org",
      accounts: process.env.PRIVATE_KEY_TEST
        ? [process.env.PRIVATE_KEY_TEST]
        : [],
      chainId: 84532,
    },
    arbitrumSepolia: {
      url: "https://sepolia-rollup.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY_TEST
        ? [process.env.PRIVATE_KEY_TEST]
        : [],
      chainId: 421614,
    },
    optimismSepolia: {
      url: "https://sepolia.optimism.io",
      accounts: process.env.PRIVATE_KEY_TEST
        ? [process.env.PRIVATE_KEY_TEST]
        : [],
      chainId: 11155420,
    },

    // ── MAINNETS ──────────────────────────────
    base: {
      url: process.env.RPC_BASE || "https://mainnet.base.org",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 8453,
    },
    arbitrum: {
      url: process.env.RPC_ARBITRUM || "https://arb1.arbitrum.io/rpc",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 42161,
    },
    optimism: {
      url: process.env.RPC_OPTIMISM || "https://mainnet.optimism.io",
      accounts: process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [],
      chainId: 10,
    },
  },

  etherscan: {
    // Etherscan V2 unified API — one key works for Base, Arbitrum, and Optimism.
    // Get your key at: https://etherscan.io/myapikey
    apiKey: process.env.ETHERSCAN_API_KEY || "",
  },

  sourcify: {
    enabled: true,
  },
};

export default config;