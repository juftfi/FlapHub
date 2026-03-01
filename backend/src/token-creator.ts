import { 
  createPublicClient, 
  createWalletClient, 
  http, 
  keccak256,
  toHex,
  toBytes,
  concat,
  getContractAddress,
  formatEther,
  parseEther,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { bsc } from 'viem/chains';
import { config } from './config.js';
import { 
  PORTAL_ABI_SIMPLE, 
  DexThreshType, 
  MigratorType,
  DexId,
  LpFeeProfile,
  ZERO_ADDRESS,
  ZERO_BYTES32,
  ONE_YEAR_SECONDS,
  THREE_DAYS_SECONDS,
  // Token implementation addresses
  TAX_TOKEN_V1_IMPL,
  TAX_TOKEN_V2_IMPL,
  NON_TAX_TOKEN_IMPL,
  PORTAL_ADDRESS,
} from './types.js';

// ============================================
// Client Setup (Lazy Loading)
// ============================================

// Account is lazily initialized after config is loaded
let _account: ReturnType<typeof privateKeyToAccount> | null = null;

function getAccount() {
  if (!_account) {
    if (!config.privateKey) {
      throw new Error('Private key not loaded. Call initConfig() first.');
    }
    _account = privateKeyToAccount(config.privateKey as `0x${string}`);
  }
  return _account;
}

// ============================================
// HD Wallet Derivation
// ============================================

/**
 * Derive a unique beneficiary address from Twitter user ID
 * 
 * Uses the master private key + userId to generate a deterministic address.
 * Same userId always generates the same address.
 * 
 * Benefits:
 * - All tokens for the same user have tax going to the same address
 * - User can claim all earnings with one transaction
 * - No database needed to track ownership
 * 
 * @param twitterUserId Twitter user's unique ID (numeric string)
 * @returns Derived address and private key
 */
export function deriveBeneficiary(twitterUserId: string): {
  address: Address;
  privateKey: Hex;
} {
  // Create deterministic seed from master key + userId
  const seed = keccak256(toHex(`flap-beneficiary-v1-${twitterUserId}`));
  
  // Derive private key by hashing master key with seed
  const masterKeyBytes = toBytes(config.privateKey as Hex);
  const seedBytes = toBytes(seed);
  const derivedKey = keccak256(concat([masterKeyBytes, seedBytes]));
  
  // Create account from derived key
  const derivedAccount = privateKeyToAccount(derivedKey);
  
  return {
    address: derivedAccount.address,
    privateKey: derivedKey,
  };
}

/**
 * Get balance of a derived beneficiary address
 */
export async function getBeneficiaryBalance(twitterUserId: string): Promise<bigint> {
  const { address } = deriveBeneficiary(twitterUserId);
  return await publicClient.getBalance({ address });
}

/**
 * Execute claim: transfer funds from derived address to user wallet
 * 
 * Distribution: 2/3 to user, 1/3 to project
 * 
 * @param twitterUserId Twitter user ID
 * @param userWallet User's BNB wallet address
 * @returns Transaction results
 */
export async function executeClaim(
  twitterUserId: string,
  userWallet: Address
): Promise<{
  success: boolean;
  userAmount: bigint;
  projectAmount: bigint;
  userTxHash?: Hash;
  projectTxHash?: Hash;
  error?: string;
}> {
  try {
    const { address: beneficiary, privateKey } = deriveBeneficiary(twitterUserId);
    const balance = await publicClient.getBalance({ address: beneficiary });
    
    if (balance === 0n) {
      return { success: false, userAmount: 0n, projectAmount: 0n, error: 'No balance to claim' };
    }
    
    // Calculate gas costs (estimate 2 transfers)
    const gasPrice = await publicClient.getGasPrice();
    const gasPerTransfer = 21000n;
    const totalGasCost = gasPrice * gasPerTransfer * 3n; // 3x buffer
    
    if (balance <= totalGasCost) {
      return { success: false, userAmount: 0n, projectAmount: 0n, error: 'Balance too low to cover gas' };
    }
    
    // Calculate distribution
    const available = balance - totalGasCost;
    const userAmount = (available * 2n) / 3n;
    const projectAmount = available - userAmount; // Rest goes to project
    
    // Create wallet client for derived address
    const derivedAccount = privateKeyToAccount(privateKey);
    const derivedWalletClient = createWalletClient({
      account: derivedAccount,
      chain: bsc,
      transport: http(config.rpcUrl),
    });
    
    // Transfer to project first
    const projectTxHash = await derivedWalletClient.sendTransaction({
      to: config.projectWallet as Address,
      value: projectAmount,
    });
    await publicClient.waitForTransactionReceipt({ hash: projectTxHash });
    
    // Transfer to user
    const userTxHash = await derivedWalletClient.sendTransaction({
      to: userWallet,
      value: userAmount,
    });
    await publicClient.waitForTransactionReceipt({ hash: userTxHash });
    
    return {
      success: true,
      userAmount,
      projectAmount,
      userTxHash,
      projectTxHash,
    };
    
  } catch (error: any) {
    return {
      success: false,
      userAmount: 0n,
      projectAmount: 0n,
      error: error.message,
    };
  }
}

const publicClient = createPublicClient({
  chain: bsc,
  transport: http(config.rpcUrl),
});

// WalletClient is lazily initialized after config is loaded
let _walletClient: ReturnType<typeof createWalletClient> | null = null;

function getWalletClient() {
  if (!_walletClient) {
    _walletClient = createWalletClient({
      account: getAccount(),
      chain: bsc,
      transport: http(config.rpcUrl),
    });
  }
  return _walletClient;
}

// ============================================
// Vanity Salt Generation
// ============================================

/**
 * Predict token address using CREATE2
 * Based on Flap's official documentation
 */
function predictVanityTokenAddress(salt: Hex, tokenImpl: Address, portal: Address): Address {
  // EIP-1167 minimal proxy bytecode
  const bytecode = ('0x3d602d80600a3d3981f3363d3d373d3d3d363d73'
    + tokenImpl.slice(2).toLowerCase()
    + '5af43d82803e903d91602b57fd5bf3') as Hex;

  return getContractAddress({
    from: portal,
    salt: toBytes(salt),
    bytecode,
    opcode: "CREATE2",
  });
}

/**
 * Find a salt that generates a token address ending with the specified suffix
 * 
 * @param suffix The suffix the token address should end with (e.g., "7777" for tax tokens)
 * @param tokenImpl The token implementation address
 * @param portal The portal contract address
 * @returns The salt and predicted token address
 */
export async function findVanitySalt(
  suffix: string, 
  tokenImpl: Address, 
  portal: Address
): Promise<{ salt: Hex; address: Address }> {
  if (suffix.length !== 4) {
    throw new Error("Suffix must be exactly 4 characters");
  }
  
  // Use a random private key as the starting seed
  let seed = generatePrivateKey();
  let salt = keccak256(toHex(seed));
  const startTime = Date.now();
  
  // Keep hashing until we find an address ending with the suffix
  while (!predictVanityTokenAddress(salt, tokenImpl, portal).toLowerCase().endsWith(suffix.toLowerCase())) {
    salt = keccak256(salt);
    
    // Timeout after 5 minutes
    if (Date.now() - startTime > 300000) {
      throw new Error(`Timeout: Could not find vanity salt`);
    }
  }
  
  const address = predictVanityTokenAddress(salt, tokenImpl, portal);
  return { salt, address };
}

// ============================================
// Helper Functions
// ============================================

/**
 * Get wallet address from private key
 */
export function getWalletAddress(): Address {
  return getAccount().address;
}

/**
 * Get wallet balance
 */
export async function getWalletBalance(): Promise<bigint> {
  return await publicClient.getBalance({ address: getAccount().address });
}

// ============================================
// Token Creation with newTokenV2
// ============================================

export interface CreateTokenV2Params {
  name: string;
  symbol: string;
  metaCid: string;
  taxRate?: number;              // Default: 300 (3%)
  dexThresh?: DexThreshType;     // Default: FOUR_FIFTHS (80%)
  quoteAmt?: bigint;             // Default: 0 (no initial buy)
  beneficiary?: Address;         // Default: creator address
}

/**
 * Create a tax token using newTokenV2
 * Tax tokens must use V2_MIGRATOR and will have address ending in 7777
 */
export async function createTokenV2(params: CreateTokenV2Params): Promise<{
  txHash: Hash;
  tokenAddress: Address | null;
}> {
  const {
    name,
    symbol,
    metaCid,
    taxRate = config.taxRate,
    dexThresh = DexThreshType.FOUR_FIFTHS,
    quoteAmt = BigInt(0),
    beneficiary = getAccount().address,
  } = params;
  
  // Determine token implementation
  const tokenImpl = taxRate > 0 ? TAX_TOKEN_V1_IMPL : NON_TAX_TOKEN_IMPL;
  const suffix = taxRate > 0 ? '7777' : '8888';
  
  // Find vanity salt
  const { salt, address: predictedAddress } = await findVanitySalt(
    suffix,
    tokenImpl,
    config.portalAddress as Address
  );
  
  // Prepare parameters struct
  const tokenParams = {
    name,
    symbol,
    meta: metaCid,
    dexThresh: dexThresh,
    salt: salt,
    taxRate: taxRate,
    migratorType: MigratorType.V2_MIGRATOR, // Tax tokens MUST use V2_MIGRATOR
    quoteToken: ZERO_ADDRESS,               // Native BNB
    quoteAmt: quoteAmt,
    beneficiary: beneficiary,
    permitData: '0x' as `0x${string}`,
  };
  
  // Calculate total value: creation fee + initial buy amount
  const creationFee = parseEther(config.creationFee);
  const totalValue = quoteAmt + creationFee;
  
  try {
    // Estimate gas
    const gasEstimate = await publicClient.estimateContractGas({
      address: config.portalAddress as Address,
      abi: PORTAL_ABI_SIMPLE,
      functionName: 'newTokenV2',
      args: [tokenParams],
      account: getAccount().address,
      value: totalValue,
    });
    
    const gasLimit = gasEstimate * BigInt(120) / BigInt(100);
    
    // Send transaction
    const txHash = await getWalletClient().writeContract({
      address: config.portalAddress as Address,
      abi: PORTAL_ABI_SIMPLE,
      functionName: 'newTokenV2',
      args: [tokenParams],
      value: totalValue,
      gas: gasLimit,
    });
    
    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ 
      hash: txHash,
      confirmations: 2,
    });
    
    // The token address should be the predicted address
    let tokenAddress: Address | null = predictedAddress;
    
    // Verify from logs
    for (const log of receipt.logs) {
      // TokenCreated event topic
      const tokenCreatedTopic = keccak256(
        toHex('TokenCreated(uint256,address,uint256,address,string,string,string)')
      );
      
      if (log.topics[0] === tokenCreatedTopic) {
        // Extract token address from log data
        if (log.data && log.data.length >= 130) {
          const tokenAddressHex = '0x' + log.data.slice(2 + 192, 2 + 192 + 64).slice(24);
          tokenAddress = tokenAddressHex as Address;
        }
      }
    }
    
    return { txHash, tokenAddress };
    
  } catch (error: any) {
    throw error;
  }
}

// ============================================
// Token Creation with newTokenV5 (Full Tax V2)
// ============================================

export interface CreateTokenV5Params extends CreateTokenV2Params {
  taxDuration?: bigint;          // Default: 100 years (Flap default)
  antiFarmerDuration?: bigint;   // Default: 3 days
  mktBps?: number;               // Marketing allocation (default: 10000 = 100%)
  deflationBps?: number;         // Burn allocation (default: 0)
  dividendBps?: number;          // Dividend allocation (default: 0)
  lpBps?: number;                // LP allocation (default: 0)
  minimumShareBalance?: bigint;  // Default: 0
}

/**
 * Create a tax token using newTokenV5 (full Tax V2 support)
 * 
 * When mktBps == 10000, creates Tax Token V1 (ends in 7777)
 * When mktBps < 10000, creates Tax Token V2 (ends in 7777, different impl)
 */
export async function createTokenV5(params: CreateTokenV5Params): Promise<{
  txHash: Hash;
  tokenAddress: Address | null;
}> {
  const {
    name,
    symbol,
    metaCid,
    taxRate = config.taxRate,
    dexThresh = DexThreshType.FOUR_FIFTHS,
    quoteAmt = BigInt(0),
    beneficiary = getAccount().address,
    taxDuration = BigInt(100 * 365 * 24 * 60 * 60), // 100 years (Flap default)
    antiFarmerDuration = THREE_DAYS_SECONDS,
    mktBps = 10000,       // 100% to marketing by default (creates V1 tax token)
    deflationBps = 0,
    dividendBps = 0,
    lpBps = 0,
    minimumShareBalance = BigInt(0),
  } = params;
  
  // Validate tax allocation sums to 100%
  const totalBps = mktBps + deflationBps + dividendBps + lpBps;
  if (totalBps !== 10000) {
    throw new Error(`Tax allocation must sum to 10000 (100%). Current: ${totalBps}`);
  }
  
  // Determine token implementation
  const tokenImpl = mktBps === 10000 ? TAX_TOKEN_V1_IMPL : TAX_TOKEN_V2_IMPL;
  const suffix = '7777';
  
  // Find vanity salt
  const { salt, address: predictedAddress } = await findVanitySalt(
    suffix,
    tokenImpl,
    config.portalAddress as Address
  );
  
  // Prepare parameters struct
  const tokenParams = {
    name,
    symbol,
    meta: metaCid,
    dexThresh: dexThresh,
    salt: salt,
    taxRate: taxRate,
    migratorType: MigratorType.V2_MIGRATOR,
    quoteToken: ZERO_ADDRESS,
    quoteAmt: quoteAmt,
    beneficiary: beneficiary,
    permitData: '0x' as `0x${string}`,
    extensionID: ZERO_BYTES32,
    extensionData: '0x' as `0x${string}`,
    dexId: DexId.DEX0,
    lpFeeProfile: LpFeeProfile.STANDARD,
    taxDuration: taxDuration,
    antiFarmerDuration: antiFarmerDuration,
    mktBps: mktBps,
    deflationBps: deflationBps,
    dividendBps: dividendBps,
    lpBps: lpBps,
    minimumShareBalance: minimumShareBalance,
  };
  
  // Calculate total value: creation fee + initial buy amount
  const creationFee = parseEther(config.creationFee);
  const totalValue = quoteAmt + creationFee;
  
  try {
    // Estimate gas
    const gasEstimate = await publicClient.estimateContractGas({
      address: config.portalAddress as Address,
      abi: PORTAL_ABI_SIMPLE,
      functionName: 'newTokenV5',
      args: [tokenParams],
      account: getAccount().address,
      value: totalValue,
    });
    
    const gasLimit = gasEstimate * BigInt(120) / BigInt(100);
    
    // Send transaction
    const txHash = await getWalletClient().writeContract({
      address: config.portalAddress as Address,
      abi: PORTAL_ABI_SIMPLE,
      functionName: 'newTokenV5',
      args: [tokenParams],
      value: totalValue,
      gas: gasLimit,
    });
    
    // Wait for confirmation
    const receipt = await publicClient.waitForTransactionReceipt({ 
      hash: txHash,
      confirmations: 2,
    });
    
    // Token address should be the predicted address
    let tokenAddress: Address | null = predictedAddress;
    
    // Verify from logs
    for (const log of receipt.logs) {
      const tokenCreatedTopic = keccak256(
        toHex('TokenCreated(uint256,address,uint256,address,string,string,string)')
      );
      
      if (log.topics[0] === tokenCreatedTopic && log.data && log.data.length >= 130) {
        const tokenAddressHex = '0x' + log.data.slice(2 + 192, 2 + 192 + 64).slice(24);
        tokenAddress = tokenAddressHex as Address;
      }
    }
    
    return { txHash, tokenAddress };
    
  } catch (error: any) {
    throw error;
  }
}
