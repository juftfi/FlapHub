import { parseAbi } from 'viem';
import type { Address } from 'viem';

// ============================================
// Contract Addresses (BNB Chain)
// ============================================

// Portal contract address
export const PORTAL_ADDRESS = '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0' as Address;

// Token implementation addresses for CREATE2 vanity address calculation
// From: https://docs.flap.sh/flap/developers/deployed-contract-addresses

// Non-tax token implementation (address ends in 8888)
export const NON_TAX_TOKEN_IMPL = '0x8b4329947e34b6d56d71a3385cac122bade7d78b' as Address;

// Tax Token V1 implementation (address ends in 7777)
// Used when mktBps == 10000 (100% to marketing)
export const TAX_TOKEN_V1_IMPL = '0x29e6383F0ce68507b5A72a53c2B118a118332aA8' as Address;

// Tax Token V2 implementation (address ends in 7777)
// Used when mktBps < 10000 (advanced tax distribution)
export const TAX_TOKEN_V2_IMPL = '0xae562c6A05b798499507c6276C6Ed796027807BA' as Address;

// ============================================
// Enums from Flap Protocol
// ============================================

/**
 * DEX Threshold Types - determines when token migrates to DEX
 */
export enum DexThreshType {
  TWO_THIRDS = 0,      // 66.67% supply
  FOUR_FIFTHS = 1,     // 80% supply
  HALF = 2,            // 50% supply
  _95_PERCENT = 3,     // 95% supply
  _81_PERCENT = 4,     // 81% supply
  _1_PERCENT = 5,      // 1% supply (for testing)
}

/**
 * Migrator Types - determines which DEX to migrate to
 * Note: Tax tokens MUST use V2_MIGRATOR
 */
export enum MigratorType {
  V3_MIGRATOR = 0,     // Uniswap V3 style (for non-tax tokens)
  V2_MIGRATOR = 1,     // Uniswap V2 style (REQUIRED for tax tokens!)
}

/**
 * Token Status
 */
export enum TokenStatus {
  Invalid = 0,
  Tradable = 1,
  InDuel = 2,    // obsolete
  Killed = 3,    // obsolete
  DEX = 4,
}

/**
 * Token Version
 */
export enum TokenVersion {
  TOKEN_LEGACY_MINT_NO_PERMIT = 0,
  TOKEN_LEGACY_MINT_NO_PERMIT_DUPLICATE = 1,
  TOKEN_V2_PERMIT = 2,
  TOKEN_GOPLUS = 3,
  TOKEN_TAXED = 4,       // Tax Token V1
  TOKEN_TAXED_V2 = 5,    // Tax Token V2
}

/**
 * DEX ID for migration
 * On BSC: only DEX0 (PancakeSwap) is enabled
 */
export enum DexId {
  DEX0 = 0,      // PancakeSwap on BSC
  DEX1 = 1,      // Secondary DEX
  DEX2 = 2,      // Tertiary DEX
}

/**
 * LP Fee Profile
 */
export enum LpFeeProfile {
  STANDARD = 0,  // 0.25% on PancakeSwap, 0.3% on Uniswap
  LOW = 1,       // 0.01% on PancakeSwap, 0.05% on Uniswap
  HIGH = 2,      // 1% for exotic pairs
}

// ============================================
// ABI Definitions
// ============================================

export const PORTAL_ABI = parseAbi([
  // Events
  'event TokenCreated(uint256 ts, address creator, uint256 nonce, address token, string name, string symbol, string meta)',
  'event TokenCurveSet(address token, address curve, uint256 curveParameter)',
  'event TokenCurveSetV2(address token, uint256 r, uint256 h, uint256 k)',
  'event TokenDexSupplyThreshSet(address token, uint256 dexSupplyThresh)',
  'event TokenQuoteSet(address token, address quoteToken)',
  'event FlapTokenTaxSet(address token, uint256 tax)',
  'event FlapTokenCirculatingSupplyChanged(address token, uint256 newSupply)',
  'event LaunchedToDEX(address token, address pool, uint256 amount, uint256 eth)',
  
  // Read functions
  'function getTokenV5(address token) external view returns ((uint8,uint256,uint256,uint256,uint8,uint256,uint256,uint256,uint256,address,bool,bytes32))',
  
  // Write functions - newTokenV2 (simpler, for basic tax tokens)
  'function newTokenV2((string name, string symbol, string meta, uint8 dexThresh, bytes32 salt, uint16 taxRate, uint8 migratorType, address quoteToken, uint256 quoteAmt, address beneficiary, bytes permitData)) external payable returns (address)',
  
  // Write functions - newTokenV5 (full tax V2 support)
  'function newTokenV5((string name, string symbol, string meta, uint8 dexThresh, bytes32 salt, uint16 taxRate, uint8 migratorType, address quoteToken, uint256 quoteAmt, address beneficiary, bytes permitData, bytes32 extensionID, bytes extensionData, uint8 dexId, uint8 lpFeeProfile, uint64 taxDuration, uint64 antiFarmerDuration, uint16 mktBps, uint16 deflationBps, uint16 dividendBps, uint16 lpBps, uint256 minimumShareBalance)) external payable returns (address)',
]);

// Simplified ABI for viem writeContract
export const PORTAL_ABI_SIMPLE = [
  {
    "inputs": [
      {
        "components": [
          { "name": "name", "type": "string" },
          { "name": "symbol", "type": "string" },
          { "name": "meta", "type": "string" },
          { "name": "dexThresh", "type": "uint8" },
          { "name": "salt", "type": "bytes32" },
          { "name": "taxRate", "type": "uint16" },
          { "name": "migratorType", "type": "uint8" },
          { "name": "quoteToken", "type": "address" },
          { "name": "quoteAmt", "type": "uint256" },
          { "name": "beneficiary", "type": "address" },
          { "name": "permitData", "type": "bytes" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "newTokenV2",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "inputs": [
      {
        "components": [
          { "name": "name", "type": "string" },
          { "name": "symbol", "type": "string" },
          { "name": "meta", "type": "string" },
          { "name": "dexThresh", "type": "uint8" },
          { "name": "salt", "type": "bytes32" },
          { "name": "taxRate", "type": "uint16" },
          { "name": "migratorType", "type": "uint8" },
          { "name": "quoteToken", "type": "address" },
          { "name": "quoteAmt", "type": "uint256" },
          { "name": "beneficiary", "type": "address" },
          { "name": "permitData", "type": "bytes" },
          { "name": "extensionID", "type": "bytes32" },
          { "name": "extensionData", "type": "bytes" },
          { "name": "dexId", "type": "uint8" },
          { "name": "lpFeeProfile", "type": "uint8" },
          { "name": "taxDuration", "type": "uint64" },
          { "name": "antiFarmerDuration", "type": "uint64" },
          { "name": "mktBps", "type": "uint16" },
          { "name": "deflationBps", "type": "uint16" },
          { "name": "dividendBps", "type": "uint16" },
          { "name": "lpBps", "type": "uint16" },
          { "name": "minimumShareBalance", "type": "uint256" }
        ],
        "name": "params",
        "type": "tuple"
      }
    ],
    "name": "newTokenV5",
    "outputs": [{ "name": "", "type": "address" }],
    "stateMutability": "payable",
    "type": "function"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "ts", "type": "uint256" },
      { "indexed": false, "name": "creator", "type": "address" },
      { "indexed": false, "name": "nonce", "type": "uint256" },
      { "indexed": false, "name": "token", "type": "address" },
      { "indexed": false, "name": "name", "type": "string" },
      { "indexed": false, "name": "symbol", "type": "string" },
      { "indexed": false, "name": "meta", "type": "string" }
    ],
    "name": "TokenCreated",
    "type": "event"
  },
  {
    "anonymous": false,
    "inputs": [
      { "indexed": false, "name": "token", "type": "address" },
      { "indexed": false, "name": "tax", "type": "uint256" }
    ],
    "name": "FlapTokenTaxSet",
    "type": "event"
  }
] as const;

// ============================================
// Metadata Structure (Flap format)
// ============================================

/**
 * Flap token metadata format
 * This is stored on IPFS and returned by the upload API
 */
export interface FlapMetadata {
  buy: string | null;
  creator: string;
  description: string;
  image: string;           // IPFS CID of the image (not full URL)
  sell: string | null;
  telegram: string | null;
  twitter: string | null;
  website: string | null;
}

// ============================================
// Constants
// ============================================

export const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;
export const ZERO_BYTES32 = '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`;

// Tax token vanity suffix
export const TAX_TOKEN_SUFFIX = '7777';
export const STANDARD_TOKEN_SUFFIX = '8888';

// Time constants
export const ONE_YEAR_SECONDS = BigInt(365 * 24 * 60 * 60);         // 31,536,000 seconds
export const HUNDRED_YEARS_SECONDS = BigInt(100 * 365 * 24 * 60 * 60);  // 3,153,600,000 seconds (Flap V5 default)
export const THREE_DAYS_SECONDS = BigInt(3 * 24 * 60 * 60);         // 259,200 seconds

// Tax rate constants (in basis points)
export const MAX_TAX_RATE = 1000;  // 10%
