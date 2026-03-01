/**
 * FlapX Unified Server
 * 
 * Combines:
 * - Twitter Bot (monitors mentions, creates tokens, replies to tweets)
 * - API Server (provides token data, earnings, claim functionality)
 * 
 * Usage: npm run start
 */

import express from 'express';
import cors from 'cors';
import crypto from 'crypto';
import { config, initConfig } from './config.js';
import { loadTokens, saveToken, type TokenRecord } from './token-store.js';
import { deriveBeneficiary, createTokenV5, getWalletAddress, getWalletBalance } from './token-creator.js';
import { uploadImageUrlToIPFS } from './ipfs.js';
import {
  getUserMentions,
  getUserInfo,
  login,
  loginBackup,
  hasBackupAccount,
  createTweet,
  parseCreateCommand,
  getBestImageUrl,
  buildTweetUrl,
  canUserCreateToken,
  getUserCooldownRemaining,
  recordUserCreation,
  formatCooldown,
  isTweetProcessed,
  markTweetProcessed,
  type Tweet,
  type TwitterUser,
} from './twitter-api.js';
import {
  createPublicClient,
  createWalletClient,
  http,
  formatEther,
  parseEther,
  type Address,
} from 'viem';
import { bsc } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';

// ============================================
// API Server Setup
// ============================================

const app = express();
const API_PORT = config.apiPort;
const FRONTEND_URL = config.frontendUrl;

// Middleware
app.use(cors({
  // ⚠️ Update with your production domains via FRONTEND_URL env var
  origin: ['http://localhost:8080', 'http://127.0.0.1:8080', FRONTEND_URL].filter(Boolean),
  credentials: true,
}));
app.use(express.json());

// Viem clients
const publicClient = createPublicClient({
  chain: bsc,
  transport: http(config.rpcUrl),
});

// ============================================
// API Endpoints
// ============================================

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    bot: isRunning ? 'running' : 'stopped',
    tokensCreated: loadTokens().length,
  });
});

// Get user tokens (from local data store)
app.get('/api/user/tokens', (req, res) => {
  try {
    const { userId, userName } = req.query;
    
    if (!userId && !userName) {
      return res.status(400).json({ error: 'Missing userId or userName' });
    }
    
    const allTokens = loadTokens();
    
    const userTokens = allTokens.filter(token => {
      if (userId && token.taxReceiverId === userId) return true;
      if (userName && token.taxReceiver.toLowerCase() === (userName as string).toLowerCase()) return true;
      return false;
    });
    
    // Derive beneficiary address if userId provided
    let beneficiaryAddress = null;
    if (userId) {
      const derived = deriveBeneficiary(userId as string);
      beneficiaryAddress = derived.address;
    }
    
    res.json({
      success: true,
      beneficiaryAddress,
      tokens: userTokens.map(token => ({
        symbol: token.symbol,
        name: token.name,
        address: token.address,
        tweetUrl: token.tweetUrl,
        createdAt: token.createdAt,
        flapUrl: `https://beta.flap.sh/token/${token.address}`,
        bscscanUrl: `https://bscscan.com/token/${token.address}`,
      })),
      totalTokens: userTokens.length,
    });
  } catch (error: any) {
    console.error('[API] Tokens error:', error);
    res.status(500).json({ error: 'Failed to get tokens', message: error.message });
  }
});

// Get user earnings
app.get('/api/user/earnings', async (req, res) => {
  try {
    const { userId } = req.query;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    
    const { address: beneficiaryAddress } = deriveBeneficiary(userId as string);
    
    const balance = await publicClient.getBalance({
      address: beneficiaryAddress,
    });
    
    const userShare = (balance * 2n) / 3n;
    const userShareBNB = formatEther(userShare);
    const bnbPrice = 600;
    const userShareUSD = parseFloat(userShareBNB) * bnbPrice;
    
    res.json({
      success: true,
      earnings: {
        totalBNB: formatEther(balance),
        claimableBNB: userShareBNB,
        claimableUSD: userShareUSD.toFixed(2),
        beneficiaryAddress,
      },
    });
  } catch (error: any) {
    console.error('[API] Earnings error:', error);
    res.status(500).json({ error: 'Failed to get earnings', message: error.message });
  }
});

// Claim earnings
app.post('/api/user/claim', async (req, res) => {
  try {
    const { userId, walletAddress } = req.body;
    
    if (!userId) {
      return res.status(400).json({ error: 'Missing userId' });
    }
    
    if (!walletAddress || !/^0x[a-fA-F0-9]{40}$/.test(walletAddress)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    const { address: beneficiaryAddress, privateKey } = deriveBeneficiary(userId);
    
    const balance = await publicClient.getBalance({
      address: beneficiaryAddress,
    });
    
    if (balance === 0n) {
      return res.status(400).json({ error: 'No earnings to claim' });
    }
    
    const userShare = (balance * 2n) / 3n;
    
    const account = privateKeyToAccount(privateKey);
    const walletClient = createWalletClient({
      account,
      chain: bsc,
      transport: http(config.rpcUrl),
    });
    
    const gasPrice = await publicClient.getGasPrice();
    const gasLimit = 21000n;
    const gasCost = gasPrice * gasLimit;
    
    const amountToSend = userShare - gasCost;
    
    if (amountToSend <= 0n) {
      return res.status(400).json({ error: 'Earnings too small to cover gas fees' });
    }
    
    const userTxHash = await walletClient.sendTransaction({
      to: walletAddress as Address,
      value: amountToSend,
    });
    
    await publicClient.waitForTransactionReceipt({ hash: userTxHash });
    
    // Send project's share
    const projectShare = balance - userShare;
    if (projectShare > gasCost && config.projectWallet) {
      try {
        const projectTxHash = await walletClient.sendTransaction({
          to: config.projectWallet as Address,
          value: projectShare - gasCost,
        });
        await publicClient.waitForTransactionReceipt({ hash: projectTxHash });
      } catch (e) {
        console.error('[API] Failed to send project share:', e);
      }
    }
    
    console.log(`[API] ✅ Claimed ${formatEther(amountToSend)} BNB for user ${userId}`);
    
    res.json({
      success: true,
      claimed: {
        amount: formatEther(amountToSend),
        txHash: userTxHash,
        toAddress: walletAddress,
      },
    });
  } catch (error: any) {
    console.error('[API] Claim error:', error);
    res.status(500).json({ error: 'Failed to claim earnings', message: error.message });
  }
});

// ============================================
// Symbol Validation
// ============================================

interface SymbolValidation {
  valid: boolean;
  reason?: string;
  message?: string;
}

/**
 * Validate symbol before creating token
 * 
 * Flap contract restrictions:
 * - Max length: ~20 characters or ~32 bytes
 * - Certain symbols may be reserved/banned
 */
function validateSymbol(symbol: string): SymbolValidation {
  // Check character length (max 20 chars)
  if (symbol.length > 20) {
    return {
      valid: false,
      reason: `Too long: ${symbol.length} chars (max 20)`,
      message: `$${symbol.substring(0, 10)}... is too long (${symbol.length} chars).\n\nMax 20 characters allowed.\nPlease use a shorter symbol.`,
    };
  }
  
  // Check byte length for UTF-8 (Chinese chars = 3 bytes each)
  const byteLength = Buffer.byteLength(symbol, 'utf8');
  if (byteLength > 32) {
    return {
      valid: false,
      reason: `Too many bytes: ${byteLength} bytes (max 32)`,
      message: `$${symbol.substring(0, 6)}... is too long.\n\nChinese characters count as 3 bytes each.\nPlease use a shorter symbol (max ~10 Chinese chars).`,
    };
  }
  
  // Symbol is valid
  return { valid: true };
}

// ============================================
// Twitter Bot State
// ============================================

let loginCookie: string = '';        // Primary account cookie
let backupCookie: string = '';       // Backup account cookie
let usePrimaryAccount = true;        // Which account to try first
let isRunning = false;
let lastCheckedTweetId: string | null = null;       // Primary account
let lastCheckedTweetIdBackup: string | null = null; // Backup account
let isFirstPoll = true;
let isFirstPollBackup = true;

// ============================================
// Token Creation
// ============================================

interface CreateTokenParams {
  tweet: Tweet;
  symbol: string;
  taxReceiverUser: TwitterUser;
}

async function createTokenForTweet(params: CreateTokenParams): Promise<{ 
  success: boolean; 
  tokenAddress?: string; 
  error?: string;
  beneficiaryAddress?: string;
  txHash?: string;
}> {
  const { tweet, symbol, taxReceiverUser } = params;
  
  try {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🚀 Creating token: $${symbol}`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Requested by: @${tweet.author.userName}`);
    console.log(`   Tax receiver: @${taxReceiverUser.userName} (ID: ${taxReceiverUser.id})`);
    
    const { address: beneficiaryAddress } = deriveBeneficiary(taxReceiverUser.id);
    console.log(`   Beneficiary (derived): ${beneficiaryAddress}`);
    
    const taxReceiverAvatarUrl = taxReceiverUser.profilePicture || taxReceiverUser.profilePicUrl;
    const imageUrl = getBestImageUrl(tweet, taxReceiverAvatarUrl);
    console.log(`   Logo source: ${imageUrl.includes('profile_images') ? 'Avatar' : 'Tweet Image'}`);
    
    const tweetUrl = buildTweetUrl(tweet.author.userName, tweet.id);
    console.log(`   Tweet URL: ${tweetUrl}`);
    
    console.log('\n📤 Uploading to IPFS...');
    const metadataCid = await uploadImageUrlToIPFS(imageUrl, {
      description: `$${symbol} - Created via Flap`,
      creator: getWalletAddress(),
      twitter: tweetUrl,
    });
    
    console.log(`   ✅ Metadata CID: ${metadataCid}`);
    
    console.log('\n🔨 Creating token on Flap...');
    const result = await createTokenV5({
      name: symbol,
      symbol: symbol,
      metaCid: metadataCid,
      taxRate: config.taxRate,
      beneficiary: beneficiaryAddress,
      mktBps: 10000,
      deflationBps: 0,
      dividendBps: 0,
      lpBps: 0,
    });
    
    if (result.tokenAddress) {
      console.log(`\n🎉 Token created successfully!`);
      console.log(`   Address: ${result.tokenAddress}`);
      return { 
        success: true, 
        tokenAddress: result.tokenAddress,
        beneficiaryAddress,
        txHash: result.txHash,
      };
    } else {
      return { success: false, error: 'Token address not found in transaction' };
    }
    
  } catch (error: any) {
    console.error(`\n❌ Failed to create token: ${error.message}`);
    return { success: false, error: error.message };
  }
}

// ============================================
// Tweet Reply
// ============================================

/**
 * Random delay to avoid Twitter automation detection
 * @param minSeconds Minimum delay in seconds
 * @param maxSeconds Maximum delay in seconds
 */
async function randomDelay(minSeconds: number = 3, maxSeconds: number = 10): Promise<void> {
  const delay = Math.floor(Math.random() * (maxSeconds - minSeconds + 1) + minSeconds) * 1000;
  console.log(`[Bot] ⏳ Waiting ${delay / 1000}s before replying (anti-detection)...`);
  await new Promise(resolve => setTimeout(resolve, delay));
}

/**
 * Try to send tweet with account rotation
 * If primary fails with 226, try backup; if backup fails, try primary
 */
async function replyToTweet(tweetId: string, message: string): Promise<boolean> {
  // Determine which account to try first
  const tryPrimaryFirst = usePrimaryAccount;
  
  // Random delay to avoid automation detection (3-10 seconds)
  await randomDelay(3, 10);
  
  // Try first account
  const firstResult = await tryReplyWithAccount(
    tweetId, 
    message, 
    tryPrimaryFirst ? 'primary' : 'backup'
  );
  
  if (firstResult.success) {
    return true;
  }
  
  // If failed with 226 (automation detection), try the other account
  if (firstResult.is226Error && hasBackupAccount()) {
    console.log(`[Bot] 🔄 Switching to ${tryPrimaryFirst ? 'backup' : 'primary'} account...`);
    
    // Switch preference for next time
    usePrimaryAccount = !tryPrimaryFirst;
    
    // Additional delay before retry
    await randomDelay(2, 5);
    
    const secondResult = await tryReplyWithAccount(
      tweetId, 
      message, 
      tryPrimaryFirst ? 'backup' : 'primary'
    );
    
    if (secondResult.success) {
      console.log(`[Bot] ✅ ${tryPrimaryFirst ? 'Backup' : 'Primary'} account succeeded!`);
      return true;
    }
  }
  
  return false;
}

/**
 * Try to reply with specific account
 */
async function tryReplyWithAccount(
  tweetId: string, 
  message: string, 
  account: 'primary' | 'backup'
): Promise<{ success: boolean; is226Error: boolean }> {
  try {
    // Get or create cookie for the specified account
    let cookie: string;
    
    if (account === 'primary') {
      if (!loginCookie) {
        console.log('[Bot] Logging in (Primary account)...');
        loginCookie = await login();
      }
      cookie = loginCookie;
    } else {
      if (!backupCookie) {
        console.log('[Bot] Logging in (Backup account)...');
        backupCookie = await loginBackup();
      }
      cookie = backupCookie;
    }
    
    if (!cookie) {
      console.log(`[Bot] ⚠️ No cookie for ${account} account`);
      return { success: false, is226Error: false };
    }
    
    await createTweet(message, cookie, tweetId);
    console.log(`[Bot] ✅ Replied via ${account} account`);
    return { success: true, is226Error: false };
    
  } catch (error: any) {
    const errorMsg = error.message || '';
    const is226Error = errorMsg.includes('226') || errorMsg.includes('automated');
    
    console.error(`[Bot] ❌ ${account} account failed: ${errorMsg.substring(0, 100)}`);
    
    // If auth error, clear cookie to force re-login next time
    if (errorMsg.includes('cookie') || errorMsg.includes('auth')) {
      if (account === 'primary') {
        loginCookie = '';
      } else {
        backupCookie = '';
      }
    }
    
    return { success: false, is226Error };
  }
}

// ============================================
// Process Tweet
// ============================================

async function processTweet(tweet: Tweet): Promise<void> {
  if (isTweetProcessed(tweet.id)) {
    return;
  }
  
  markTweetProcessed(tweet.id);
  
  console.log(`\n[Bot] Processing tweet ${tweet.id}`);
  console.log(`      From: @${tweet.author.userName}`);
  console.log(`      Text: ${tweet.text}`);
  
  const command = parseCreateCommand(tweet.text, config.twitterOfficialUsername);
  
  if (!command) {
    console.log(`[Bot] Not a valid create command, skipping`);
    return;
  }
  
  const { symbol, taxReceiverUsername } = command;
  console.log(`[Bot] Detected create command: $${symbol}`);
  
  if (taxReceiverUsername) {
    console.log(`[Bot] Tax receiver specified: @${taxReceiverUsername}`);
  } else {
    console.log(`[Bot] Tax receiver: @${tweet.author.userName} (tweet author)`);
  }
  
  let taxReceiverUser: TwitterUser;
  
  if (taxReceiverUsername) {
    try {
      console.log(`[Bot] Fetching info for @${taxReceiverUsername}...`);
      taxReceiverUser = await getUserInfo(taxReceiverUsername);
      console.log(`[Bot] Tax receiver: @${taxReceiverUser.userName} (ID: ${taxReceiverUser.id})`);
    } catch (error: any) {
      console.log(`[Bot] ❌ Failed to get user @${taxReceiverUsername}: ${error.message}`);
      console.log(`[Bot] Skipping token creation`);
      return;
    }
  } else {
    taxReceiverUser = tweet.author;
  }
  
  if (!canUserCreateToken(tweet.author.id)) {
    const remaining = getUserCooldownRemaining(tweet.author.id);
    const cooldownStr = formatCooldown(remaining);
    
    console.log(`[Bot] ⏳ User @${tweet.author.userName} is rate limited (${cooldownStr} remaining) - ignoring`);
    return;
  }
  
  // Validate symbol before creating
  const symbolValidation = validateSymbol(symbol);
  if (!symbolValidation.valid) {
    console.log(`[Bot] ❌ Invalid symbol: ${symbolValidation.reason}`);
    if (loginCookie) {
      await replyToTweet(tweet.id, symbolValidation.message!);
    }
    return;
  }
  
  const result = await createTokenForTweet({
    tweet,
    symbol,
    taxReceiverUser,
  });
  
  if (result.success && result.tokenAddress) {
    recordUserCreation(tweet.author.id);
    
    const tweetUrl = buildTweetUrl(tweet.author.userName, tweet.id);
    
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`✅ TOKEN CREATED SUCCESSFULLY!`);
    console.log(`${'═'.repeat(60)}`);
    console.log(`   Symbol: $${symbol}`);
    console.log(`   Contract: ${result.tokenAddress}`);
    console.log(`   Flap: https://beta.flap.sh/token/${result.tokenAddress}`);
    console.log(`   Requested by: @${tweet.author.userName}`);
    console.log(`   Tax receiver: @${taxReceiverUser.userName}`);
    console.log(`   Beneficiary: ${result.beneficiaryAddress}`);
    console.log(`   Tweet: ${tweetUrl}`);
    console.log(`${'═'.repeat(60)}\n`);
    
    const tokenRecord: TokenRecord = {
      symbol,
      name: symbol,
      address: result.tokenAddress,
      taxReceiver: taxReceiverUser.userName,
      taxReceiverId: taxReceiverUser.id,
      beneficiaryAddress: result.beneficiaryAddress || '',
      tweetId: tweet.id,
      tweetUrl,
      createdAt: new Date().toISOString(),
      txHash: result.txHash || '',
    };
    saveToken(tokenRecord);
    
    if (loginCookie) {
      const taxInfo = taxReceiverUsername 
        ? `\n💰 Tax goes to: @${taxReceiverUsername}\n` 
        : '\n';
      
      const successMessage = 
        `$${symbol} token created!` +
        taxInfo +
        `\nhttps://beta.flap.sh/token/${result.tokenAddress}`;
      
      await replyToTweet(tweet.id, successMessage);
    }
    
  } else {
    console.log(`\n❌ Failed to create $${symbol} token: ${result.error}`);
    
    if (loginCookie) {
      let errorMessage: string;
      
      // Check for specific error: symbol already exists (0xa7382e9b)
      // Since we already validated symbol length, this error means duplicate name
      if (result.error?.includes('0xa7382e9b') || result.error?.includes('0xa738')) {
        errorMessage = `$${symbol} already exists on Flap!\n\nPlease try a different, unique symbol.`;
      } else {
        // Truncate other error messages to fit Twitter's 280 char limit
        const shortError = (result.error || 'Unknown error').substring(0, 60);
        errorMessage = `Failed to create $${symbol}.\n${shortError}\nPlease try again.`;
      }
      
      await replyToTweet(tweet.id, errorMessage);
    }
  }
}

// ============================================
// Polling Loop
// ============================================

async function pollMentions(): Promise<void> {
  // Poll primary account
  await pollAccountMentions(
    config.twitterOfficialUsername,
    'Primary',
    () => lastCheckedTweetId,
    (id) => { lastCheckedTweetId = id; },
    () => isFirstPoll,
    (val) => { isFirstPoll = val; }
  );
  
  // Poll backup account (if configured)
  if (config.twitterBackupUsername) {
    await pollAccountMentions(
      config.twitterBackupUsername,
      'Backup',
      () => lastCheckedTweetIdBackup,
      (id) => { lastCheckedTweetIdBackup = id; },
      () => isFirstPollBackup,
      (val) => { isFirstPollBackup = val; }
    );
  }
}

/**
 * Poll mentions for a specific account
 */
async function pollAccountMentions(
  username: string,
  label: string,
  getLastId: () => string | null,
  setLastId: (id: string) => void,
  getIsFirst: () => boolean,
  setIsFirst: (val: boolean) => void
): Promise<void> {
  try {
    console.log(`[Bot] Checking mentions of @${username} (${label})...`);
    
    const response = await getUserMentions(username);
    
    if (!response.tweets || response.tweets.length === 0) {
      return;
    }
    
    console.log(`[Bot] Found ${response.tweets.length} mentions for @${username}`);
    
    const tweets = response.tweets.reverse();
    
    if (getIsFirst()) {
      setIsFirst(false);
      if (tweets.length > 0) {
        setLastId(tweets[tweets.length - 1].id);
        console.log(`[Bot] 📌 ${label}: First poll - skipping ${tweets.length} old tweets`);
      }
      return;
    }
    
    const lastId = getLastId();
    for (const tweet of tweets) {
      if (lastId && tweet.id <= lastId) {
        continue;
      }
      
      await processTweet(tweet);
    }
    
    if (tweets.length > 0) {
      setLastId(tweets[tweets.length - 1].id);
    }
    
  } catch (error: any) {
    console.error(`[Bot] Error polling @${username}: ${error.message}`);
  }
}

// ============================================
// Start Unified Server
// ============================================

async function start(): Promise<void> {
  console.log('🚀 Starting FlapX Server...');
  
  // Initialize configuration
  try {
    await initConfig();
  } catch (error: any) {
    console.error('❌ Configuration error:', error.message);
    process.exit(1);
  }
  
  // Validate configuration
  if (!config.twitterApiKey) {
    throw new Error('TWITTER_API_KEY is not set');
  }
  if (!config.twitterOfficialUsername) {
    throw new Error('TWITTER_OFFICIAL_USERNAME is not set');
  }
  if (!config.privateKey) {
    throw new Error('Private key not loaded. Run "npm run encrypt-key" first.');
  }
  
  // Start API Server
  app.listen(API_PORT, () => {
    console.log(`📡 API Server running on port ${API_PORT}`);
  });
  
  // Login to Twitter accounts
  try {
    loginCookie = await login();
    console.log('✅ Primary account login successful');
  } catch (error: any) {
    console.error('❌ Primary login failed:', error.message);
  }
  
  if (hasBackupAccount()) {
    try {
      backupCookie = await loginBackup();
      console.log('✅ Backup account login successful');
    } catch (error: any) {
      console.error('❌ Backup login failed:', error.message);
    }
  }
  
  console.log('🎯 Server Ready!');
  
  isRunning = true;
  
  // Initial poll
  await pollMentions();
  
  // Polling loop
  while (isRunning) {
    await new Promise(resolve => setTimeout(resolve, config.pollIntervalSeconds * 1000));
    await pollMentions();
  }
}

// ============================================
// Graceful Shutdown
// ============================================

process.on('SIGINT', () => {
  console.log('\n\n🛑 Shutting down server...');
  isRunning = false;
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n\n🛑 Shutting down server...');
  isRunning = false;
  process.exit(0);
});

// ============================================
// Run
// ============================================

start().catch((error) => {
  console.error('\n❌ Server error:', error);
  process.exit(1);
});
