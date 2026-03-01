/**
 * Twitter Bot - Auto Token Creator
 * 
 * Monitors Twitter for create commands and automatically creates tax tokens on Flap
 * 
 * Command formats:
 * - @Official create $SYMBOL           → Tax receiver = tweet author
 * - @Official create $SYMBOL Tax @xxx  → Tax receiver = @xxx
 * 
 * Features:
 * - HD wallet derivation for tax beneficiary (based on user ID)
 * - Automatic logo from tweet image or user avatar
 * - Rate limiting per user
 * - Proxy support for Twitter replies
 * 
 * Usage: npm run bot
 */

import { config } from './config.js';
import { saveToken, type TokenRecord } from './token-store.js';
import {
  getUserMentions,
  getUserInfo,
  login,
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
import { uploadImageUrlToIPFS } from './ipfs.js';
import { 
  createTokenV5, 
  getWalletAddress, 
  getWalletBalance,
  deriveBeneficiary,
} from './token-creator.js';

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
// Bot State
// ============================================

let loginCookie: string = '';
let isRunning = false;
let lastCheckedTweetId: string | null = null;
let isFirstPoll = true;  // Skip old tweets on startup

// ============================================
// Token Creation
// ============================================

interface CreateTokenParams {
  tweet: Tweet;
  symbol: string;
  taxReceiverUser: TwitterUser;  // The user who receives tax (could be author or specified @xxx)
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
    console.log(`Creating token: $${symbol} for @${taxReceiverUser.userName}`);
    
    // Derive beneficiary address from tax receiver's user ID
    const { address: beneficiaryAddress } = deriveBeneficiary(taxReceiverUser.id);
    
    // Get the best image URL (tweet image > avatar)
    const taxReceiverAvatarUrl = taxReceiverUser.profilePicture || taxReceiverUser.profilePicUrl;
    const imageUrl = getBestImageUrl(tweet, taxReceiverAvatarUrl);
    
    // Build tweet URL
    const tweetUrl = buildTweetUrl(tweet.author.userName, tweet.id);
    
    // Upload image to IPFS
    const metadataCid = await uploadImageUrlToIPFS(imageUrl, {
      description: `$${symbol} - Created via Flap`,
      creator: getWalletAddress(),
      twitter: tweetUrl,
    });
    
    // Create the token
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
      console.log(`✅ Token created: ${result.tokenAddress}`);
      return { 
        success: true, 
        tokenAddress: result.tokenAddress,
        beneficiaryAddress,
        txHash: result.txHash,
      };
    } else {
      return { success: false, error: 'Token address not found' };
    }
    
  } catch (error: any) {
    console.error(`❌ Token creation failed: ${error.message}`);
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
  await new Promise(resolve => setTimeout(resolve, delay));
}

async function replyToTweet(
  tweetId: string,
  message: string
): Promise<boolean> {
  try {
    // Ensure we're logged in
    if (!loginCookie) {
      console.log('[Bot] Logging in to Twitter...');
      loginCookie = await login();
    }
    
    // Random delay to avoid automation detection (3-10 seconds)
    await randomDelay(3, 10);
    
    await createTweet(message, loginCookie, tweetId);
    console.log(`[Bot] ✅ Replied to tweet ${tweetId}`);
    return true;
    
  } catch (error: any) {
    console.error(`[Bot] ❌ Failed to reply: ${error.message}`);
    
    // If login expired, try to re-login
    if (error.message.includes('cookie') || error.message.includes('auth')) {
      console.log('[Bot] Attempting to re-login...');
      try {
        loginCookie = await login();
        await createTweet(message, loginCookie, tweetId);
        return true;
      } catch (e) {
        console.error('[Bot] Re-login failed');
      }
    }
    
    return false;
  }
}

// ============================================
// Process Tweet
// ============================================

async function processTweet(tweet: Tweet): Promise<void> {
  // Skip if already processed
  if (isTweetProcessed(tweet.id)) {
    return;
  }
  
  // Mark as processed immediately to avoid duplicates
  markTweetProcessed(tweet.id);
  
  console.log(`\n[Bot] Processing tweet ${tweet.id}`);
  console.log(`      From: @${tweet.author.userName}`);
  console.log(`      Text: ${tweet.text}`);
  
  // Parse the create command (supports Tax @xxx syntax)
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
  
  // Determine tax receiver user
  let taxReceiverUser: TwitterUser;
  
  if (taxReceiverUsername) {
    // Tax @xxx specified - get that user's info
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
    // No Tax @xxx - use tweet author
    taxReceiverUser = tweet.author;
  }
  
  // Check rate limit based on tweet author (not tax receiver)
  // This prevents someone from spamming "create $XXX Tax @victim"
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
  
  // Create the token
  const result = await createTokenForTweet({
    tweet,
    symbol,
    taxReceiverUser,
  });
  
  if (result.success && result.tokenAddress) {
    // Record the creation for rate limiting (by tweet author)
    recordUserCreation(tweet.author.id);
    
    const tweetUrl = buildTweetUrl(tweet.author.userName, tweet.id);
    
    console.log(`✅ Token $${symbol} created: ${result.tokenAddress}`);
    
    // Save token to store
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
    
    // Reply to tweet with token info
    if (loginCookie) {
      const taxLine = taxReceiverUsername 
        ? `Tax → @${taxReceiverUsername}\n` 
        : '';
      
      // Claim URL from config
      const claimUrl = config.frontendUrl || 'flaphub.vercel.app';
      const successMessage = 
        `$${symbol} created!\n` +
        taxLine +
        `\nClaim tax: ${claimUrl}\n` +
        `\nhttps://beta.flap.sh/token/${result.tokenAddress}`;
      
      await replyToTweet(tweet.id, successMessage);
    }
    
  } else {
    console.log(`\n❌ Failed to create $${symbol} token: ${result.error}`);
    
    // Reply with error message
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
  try {
    const response = await getUserMentions(config.twitterOfficialUsername);
    
    if (!response.tweets || response.tweets.length === 0) {
      return;
    }
    
    // Process tweets in reverse order (oldest first)
    const tweets = response.tweets.reverse();
    
    // On first poll, skip old tweets
    if (isFirstPoll) {
      isFirstPoll = false;
      if (tweets.length > 0) {
        lastCheckedTweetId = tweets[tweets.length - 1].id;
      }
      return;
    }
    
    for (const tweet of tweets) {
      if (lastCheckedTweetId && tweet.id <= lastCheckedTweetId) {
        continue;
      }
      await processTweet(tweet);
    }
    
    if (tweets.length > 0) {
      lastCheckedTweetId = tweets[tweets.length - 1].id;
    }
    
  } catch (error: any) {
    console.error(`Error polling mentions: ${error.message}`);
  }
}

// ============================================
// Main Bot Loop
// ============================================

async function startBot(): Promise<void> {
  console.log('🤖 Starting Token Creator Bot...');
  
  // Validate configuration
  if (!config.twitterApiKey) {
    throw new Error('TWITTER_API_KEY is not set');
  }
  if (!config.twitterOfficialUsername) {
    throw new Error('TWITTER_OFFICIAL_USERNAME is not set');
  }
  if (!config.privateKey) {
    throw new Error('PRIVATE_KEY is not set');
  }
  
  // Login to Twitter
  try {
    loginCookie = await login();
    console.log('✅ Twitter login successful');
  } catch (error: any) {
    console.error(`❌ Twitter login failed: ${error.message}`);
  }
  
  console.log('🚀 Bot ready');
  
  isRunning = true;
  
  // Initial poll
  await pollMentions();
  
  // Polling loop
  while (isRunning) {
    await new Promise(resolve => setTimeout(resolve, config.pollIntervalSeconds * 1000));
    await pollMentions();
  }
}

// Graceful Shutdown
process.on('SIGINT', () => {
  isRunning = false;
  process.exit(0);
});

process.on('SIGTERM', () => {
  isRunning = false;
  process.exit(0);
});

// Export for use in index.ts
export { pollMentions, startBot, loginCookie };
