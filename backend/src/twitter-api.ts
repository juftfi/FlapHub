/**
 * X (Twitter) API Client
 * 
 * Features:
 * - Get user info and mentions
 * - Login with residential proxy
 * - Post tweets/replies
 * - Parse create commands with Tax @xxx syntax
 */

import { config } from './config.js';

const API_BASE = config.twitterApiBaseUrl || '';

// Rate limit tracking: userId -> last creation timestamp
const userRateLimits = new Map<string, number>();

// Processed tweet IDs to avoid duplicates
const processedTweets = new Set<string>();

// ============================================
// Types
// ============================================

export interface TwitterUser {
  id: string;
  userName: string;
  name: string;
  profilePicture: string;       // User avatar URL (from API)
  profilePicUrl?: string;       // Alias for compatibility
  coverPicture?: string;        // User banner URL
  description?: string;
  followers: number;
  following: number;
  isVerified: boolean;
  isBlueVerified: boolean;
  createdAt: string;
  statusesCount: number;
}

export interface TweetMedia {
  type: 'photo' | 'video' | 'animated_gif';
  url: string;
  mediaKey: string;
}

export interface Tweet {
  id: string;
  text: string;
  createdAt: string;
  author: TwitterUser;
  media?: TweetMedia[];
  inReplyToTweetId?: string;
  conversationId?: string;
  likeCount: number;
  retweetCount: number;
  replyCount: number;
}

export interface MentionsResponse {
  tweets: Tweet[];
  cursor?: string;
  hasMore: boolean;
}

export interface LoginResponse {
  login_cookie?: string;
  login_cookies?: string;  // API returns this (plural)
  ct0?: string;
  auth_token?: string;
  cookies?: string;
  data?: {
    login_cookie?: string;
    login_cookies?: string;
    ct0?: string;
    auth_token?: string;
  };
  status: string;
  msg?: string;
  message?: string;
}

/**
 * Parsed create command result
 */
export interface ParsedCreateCommand {
  symbol: string;                    // Token symbol (e.g., "TIGER")
  taxReceiverUsername: string | null; // @xxx from "Tax @xxx" or null (use author)
}

// ============================================
// API Client
// ============================================

/**
 * Make API request to X API
 */
async function apiRequest<T>(
  endpoint: string, 
  method: 'GET' | 'POST' | 'DELETE' = 'GET',
  body?: any
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  
  const headers: Record<string, string> = {
    'X-API-Key': config.twitterApiKey,
    'Content-Type': 'application/json',
  };
  
  const options: RequestInit = {
    method,
    headers,
  };
  
  if (body && method !== 'GET') {
    options.body = JSON.stringify(body);
  }
  
  // API request
  
  const response = await fetch(url, options);
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Twitter API error: ${response.status} - ${errorText}`);
  }
  
  return await response.json() as T;
}

// ============================================
// User Endpoints
// ============================================

/**
 * Get user info by username
 */
export async function getUserInfo(userName: string): Promise<TwitterUser> {
  const response = await apiRequest<{ data: TwitterUser }>(
    `/twitter/user/info?userName=${encodeURIComponent(userName)}`
  );
  return response.data;
}

/**
 * Get mentions of a user (tweets that @mention them)
 */
export async function getUserMentions(
  userName: string, 
  cursor?: string
): Promise<MentionsResponse> {
  let endpoint = `/twitter/user/mentions?userName=${encodeURIComponent(userName)}`;
  if (cursor) {
    endpoint += `&cursor=${encodeURIComponent(cursor)}`;
  }
  
  const response = await apiRequest<{
    tweets: Tweet[];
    next_cursor?: string;
    has_next_page?: boolean;
  }>(endpoint);
  
  return {
    tweets: response.tweets || [],
    cursor: response.next_cursor,
    hasMore: response.has_next_page || false,
  };
}

/**
 * Get user's last tweets
 */
export async function getUserTweets(
  userName: string,
  cursor?: string
): Promise<{ tweets: Tweet[]; cursor?: string }> {
  let endpoint = `/twitter/user/last_tweets?userName=${encodeURIComponent(userName)}`;
  if (cursor) {
    endpoint += `&cursor=${encodeURIComponent(cursor)}`;
  }
  
  return await apiRequest(endpoint);
}

// ============================================
// Login & Post Endpoints
// ============================================

/**
 * Login to get cookie for posting
 * Requires residential proxy for reliable login
 */
/**
 * Login with primary account
 */
export async function login(): Promise<string> {
  return loginWithCredentials(
    config.twitterLoginUsername,
    config.twitterLoginEmail,
    config.twitterLoginPassword,
    config.twitterLogin2faSecret,
    'Primary'
  );
}

/**
 * Login with backup account
 */
export async function loginBackup(): Promise<string> {
  if (!config.twitterBackupUsername) {
    throw new Error('Backup account not configured');
  }
  return loginWithCredentials(
    config.twitterBackupUsername,
    config.twitterBackupEmail,
    config.twitterBackupPassword,
    config.twitterBackup2faSecret,
    'Backup'
  );
}

/**
 * Check if backup account is configured
 */
export function hasBackupAccount(): boolean {
  return !!(config.twitterBackupUsername && config.twitterBackupPassword);
}

/**
 * Login with specific credentials
 */
async function loginWithCredentials(
  username: string,
  email: string,
  password: string,
  totpSecret: string,
  accountLabel: string
): Promise<string> {
  const loginPayload = {
    user_name: username,
    email: email,
    password: password,
    totp_secret: totpSecret,
    proxy: config.twitterProxy || '',
  };
  
  const response = await apiRequest<LoginResponse>(
    '/twitter/user_login_v2',
    'POST',
    loginPayload
  );
  
  if (response.status !== 'success') {
    throw new Error(`Login failed: ${response.msg}`);
  }
  
  // Extract cookie from response
  const cookie = 
    response.login_cookies ||
    response.login_cookie || 
    response.ct0 || 
    response.auth_token ||
    response.cookies ||
    response.data?.login_cookies ||
    response.data?.login_cookie ||
    response.data?.ct0 ||
    response.data?.auth_token ||
    '';
  
  return cookie;
}

/**
 * Create a tweet (reply to another tweet)
 */
export async function createTweet(
  text: string,
  loginCookies: string,
  inReplyToTweetId?: string
): Promise<{ tweetId: string }> {
  const body: any = {
    login_cookies: loginCookies,
    tweet_text: text,
    proxy: config.twitterProxy || '',
  };
  
  if (inReplyToTweetId) {
    body.reply_to_tweet_id = inReplyToTweetId;
  }
  
  const response = await apiRequest<{
    tweet_id?: string;
    status: string;
    msg?: string;
    message?: string;
    error?: string;
    detail?: string;
    data?: any;
  }>('/twitter/create_tweet_v2', 'POST', body);
  
  if (response.status !== 'success') {
    const errorMsg = response.msg || response.message || response.error || response.detail || JSON.stringify(response);
    throw new Error(`Failed to create tweet: ${errorMsg}`);
  }
  
  const tweetId = response.tweet_id || response.data?.tweet_id || '';
  return { tweetId };
}

// ============================================
// Rate Limiting
// ============================================

// Rate limit: 1 minute for testing, change to 60 * 60 * 1000 (1 hour) for production
const RATE_LIMIT_MS = 1 * 60 * 1000; // 1 minute in milliseconds (for testing)
// const RATE_LIMIT_MS = 60 * 60 * 1000; // 1 hour in milliseconds (for production)

/**
 * Check if user can create a token (rate limit: 1 per minute for testing)
 */
export function canUserCreateToken(userId: string): boolean {
  const lastCreation = userRateLimits.get(userId);
  if (!lastCreation) {
    return true;
  }
  
  const elapsed = Date.now() - lastCreation;
  return elapsed >= RATE_LIMIT_MS;
}

/**
 * Get remaining cooldown time for a user
 */
export function getUserCooldownRemaining(userId: string): number {
  const lastCreation = userRateLimits.get(userId);
  if (!lastCreation) {
    return 0;
  }
  
  const elapsed = Date.now() - lastCreation;
  const remaining = RATE_LIMIT_MS - elapsed;
  return Math.max(0, remaining);
}

/**
 * Record that a user created a token
 */
export function recordUserCreation(userId: string): void {
  userRateLimits.set(userId, Date.now());
}

/**
 * Format remaining time as human readable string
 */
export function formatCooldown(ms: number): string {
  const minutes = Math.ceil(ms / 60000);
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60);
    const mins = minutes % 60;
    return `${hours}h ${mins}m`;
  }
  return `${minutes}m`;
}

// ============================================
// Tweet Processing
// ============================================

/**
 * Check if tweet has already been processed
 */
export function isTweetProcessed(tweetId: string): boolean {
  return processedTweets.has(tweetId);
}

/**
 * Mark tweet as processed
 */
export function markTweetProcessed(tweetId: string): void {
  processedTweets.add(tweetId);
  
  // Cleanup old entries to prevent memory leak (keep last 10000)
  if (processedTweets.size > 10000) {
    const entries = Array.from(processedTweets);
    entries.slice(0, 5000).forEach(id => processedTweets.delete(id));
  }
}

/**
 * Parse create command from tweet text
 * 
 * Format A (for self): @OfficialAccount create $SYMBOL
 * Format B (for others): @OfficialAccount create $SYMBOL Tax @username
 * 
 * Supports Chinese and other Unicode characters in SYMBOL
 * 
 * @returns ParsedCreateCommand or null if not a valid command
 */
export function parseCreateCommand(
  text: string, 
  officialUsername: string
): ParsedCreateCommand | null {
  // Pattern: @username create $SYMBOL [Tax @taxReceiver]
  // SYMBOL can be letters, numbers, Chinese, etc.
  // Tax @username is optional
  const pattern = new RegExp(
    `@${officialUsername}\\s+create\\s+\\$([\\w\\u4e00-\\u9fa5]+)(?:\\s+[Tt]ax\\s+@(\\w+))?`,
    'i'
  );
  
  const match = text.match(pattern);
  if (!match) {
    return null;
  }
  
  const symbol = match[1].trim();
  const taxReceiverUsername = match[2] ? match[2].trim() : null;
  
  // Validate symbol length (1-20 characters)
  if (symbol.length < 1 || symbol.length > 20) {
    return null;
  }
  
  return { symbol, taxReceiverUsername };
}

/**
 * Get the best image URL for token logo
 * 
 * Priority:
 * 1. Tweet attached image (if any) - from extendedEntities.media
 * 2. Tax receiver's avatar (if specified)
 * 3. Tweet author's avatar (fallback)
 * 
 * @param tweet The tweet containing the command
 * @param taxReceiverAvatarUrl Optional: avatar URL of the tax receiver
 */
export function getBestImageUrl(tweet: Tweet, taxReceiverAvatarUrl?: string): string {
  // Priority 1: Tweet attached image from extendedEntities.media
  // API returns media in extendedEntities.media, not tweet.media
  const extendedEntities = (tweet as any).extendedEntities;
  if (extendedEntities?.media && extendedEntities.media.length > 0) {
    // Find photo type media
    const photo = extendedEntities.media.find((m: any) => 
      m.type === 'photo' || !m.type // default to photo if no type
    );
    if (photo) {
      // Use media_url_https which is the high-res URL
      const imageUrl = photo.media_url_https || photo.url || photo.media_url;
      if (imageUrl) {
        console.log('[Image] ✅ Using tweet attached image:', imageUrl);
        return imageUrl;
      }
    }
  }
  
  // Also check legacy media field
  if (tweet.media && tweet.media.length > 0) {
    const photo = tweet.media.find(m => m.type === 'photo');
    if (photo && photo.url) {
      console.log('[Image] ✅ Using tweet media:', photo.url);
      return photo.url;
    }
  }
  
  // Priority 2: Tax receiver's avatar (if provided)
  if (taxReceiverAvatarUrl) {
    console.log('[Image] Using tax receiver avatar');
    // Get higher resolution (replace _normal with _400x400)
    return taxReceiverAvatarUrl.replace('_normal', '_400x400');
  }
  
  // Priority 3: Tweet author's avatar (fallback)
  const avatarUrl = tweet.author.profilePicture || tweet.author.profilePicUrl || '';
  console.log('[Image] Using tweet author avatar (fallback)');
  
  // Get higher resolution (replace _normal with _400x400)
  return avatarUrl.replace('_normal', '_400x400');
}

/**
 * Build tweet URL from author username and tweet ID
 */
export function buildTweetUrl(authorUsername: string, tweetId: string): string {
  return `https://x.com/${authorUsername}/status/${tweetId}`;
}

/**
 * Download image from URL
 */
export async function downloadImage(url: string): Promise<Buffer> {
  console.log(`[Image] Downloading from: ${url}`);
  
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download image: ${response.status}`);
  }
  
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}
