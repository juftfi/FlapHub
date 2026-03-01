import dotenv from 'dotenv';
import * as path from 'path';
import {
  loadKeystore,
  decryptPrivateKey,
  keystoreExists,
  promptPassword,
  DEFAULT_KEYSTORE_PATH,
} from './keystore.js';

dotenv.config();

// ============================================
// Keystore Configuration
// ============================================

const KEYSTORE_PATH = process.env.KEYSTORE_PATH || DEFAULT_KEYSTORE_PATH;

/**
 * Load private key from keystore or environment variable
 * Priority: 
 *   1. KEY_PASSWORD env var + keystore.json (for automated deployment)
 *   2. Interactive password prompt + keystore.json (for manual startup)
 *   3. PRIVATE_KEY env var (fallback, not recommended)
 */
async function loadPrivateKey(): Promise<string> {
  // Check if keystore exists
  if (keystoreExists(KEYSTORE_PATH)) {
    console.log('\n🔐 Keystore detected: ' + KEYSTORE_PATH);
    
    // Try KEY_PASSWORD from environment first (for automated deployment)
    const envPassword = process.env.KEY_PASSWORD;
    
    if (envPassword) {
      console.log('   Using KEY_PASSWORD from environment...');
      try {
        const keystore = loadKeystore(KEYSTORE_PATH);
        const privateKey = decryptPrivateKey(keystore, envPassword);
        console.log('   ✅ Private key decrypted from keystore');
        return privateKey;
      } catch (error: any) {
        console.error('   ❌ Decryption failed:', error.message);
        throw new Error('Keystore decryption failed. Check KEY_PASSWORD.');
      }
    }
    
    // Interactive password prompt
    console.log('   Enter password to decrypt:');
    const password = await promptPassword('   Password: ');
    
    if (!password) {
      throw new Error('No password provided');
    }
    
    try {
      const keystore = loadKeystore(KEYSTORE_PATH);
      const privateKey = decryptPrivateKey(keystore, password);
      console.log('   ✅ Private key decrypted from keystore');
      return privateKey;
    } catch (error: any) {
      console.error('   ❌ Decryption failed:', error.message);
      throw new Error('Keystore decryption failed. Wrong password?');
    }
  }
  
  // Fallback to environment variable
  const envPrivateKey = process.env.PRIVATE_KEY;
  
  if (envPrivateKey) {
    console.log('\n⚠️  WARNING: Using PRIVATE_KEY from .env (not recommended)');
    console.log('   Run "npm run encrypt-key" to secure your private key');
    return envPrivateKey;
  }
  
  throw new Error(
    'No private key found!\n' +
    'Either:\n' +
    '  1. Run "npm run encrypt-key" to create keystore.json, or\n' +
    '  2. Set PRIVATE_KEY in .env (not recommended)'
  );
}

// ============================================
// Static Configuration (loaded immediately)
// ============================================

export const config = {
  // ============================================
  // Blockchain Configuration
  // ============================================
  
  // Private key - will be set asynchronously via initConfig()
  privateKey: '',
  
  // BNB Chain RPC URL
  rpcUrl: process.env.RPC_URL || 'https://bsc-dataseed.binance.org/',
  
  // Flap Portal Contract Address (BNB Chain)
  portalAddress: process.env.PORTAL_CONTRACT_ADDRESS || '0xe2cE6ab80874Fa9Fa2aAE65D277Dd6B8e65C9De0',
  
  // Tax Rate in basis points (300 = 3%)
  taxRate: parseInt(process.env.TAX_RATE || '300'),
  
  // Token creation fee in BNB (required by Flap contract)
  creationFee: process.env.CREATION_FEE || '0.01',
  
  // Project wallet (receives 1/3 of tax fees)
  // ⚠️ Set this in .env - do not hardcode!
  projectWallet: process.env.PROJECT_WALLET || '',
  
  // Chain ID
  chainId: parseInt(process.env.CHAIN_ID || '56'),
  
  // ============================================
  // Keystore Configuration
  // ============================================
  
  keystorePath: KEYSTORE_PATH,
  
  // ============================================
  // IPFS Configuration
  // ============================================
  
  // Flap Upload API (GraphQL)
  flapUploadApi: 'https://funcs.flap.sh/api/upload',
  
  // ============================================
  // X (Twitter) API Configuration
  // ============================================
  
  // X API base URL
  twitterApiBaseUrl: process.env.TWITTER_API_BASE_URL || '',
  
  // X API Key
  twitterApiKey: process.env.TWITTER_API_KEY || '',
  
  // Official Twitter account username (without @)
  twitterOfficialUsername: process.env.TWITTER_OFFICIAL_USERNAME || '',
  
  // ============================================
  // Primary Twitter Account (for posting/replying)
  // ============================================
  twitterLoginUsername: process.env.TWITTER_LOGIN_USERNAME || '',
  twitterLoginEmail: process.env.TWITTER_LOGIN_EMAIL || '',
  twitterLoginPassword: process.env.TWITTER_LOGIN_PASSWORD || '',
  twitterLogin2faSecret: process.env.TWITTER_LOGIN_2FA_SECRET || '',
  
  // ============================================
  // Backup Twitter Account (fallback when primary fails)
  // ============================================
  twitterBackupUsername: process.env.TWITTER_BACKUP_USERNAME || '',
  twitterBackupEmail: process.env.TWITTER_BACKUP_EMAIL || '',
  twitterBackupPassword: process.env.TWITTER_BACKUP_PASSWORD || '',
  twitterBackup2faSecret: process.env.TWITTER_BACKUP_2FA_SECRET || '',
  
  // Residential proxy for Twitter login/posting (required!)
  // Format: http://username:password@host:port
  twitterProxy: process.env.TWITTER_PROXY || '',
  
  // ============================================
  // Twitter OAuth 2.0 (Website Login)
  // ============================================
  
  twitterClientId: process.env.TWITTER_CLIENT_ID || '',
  twitterClientSecret: process.env.TWITTER_CLIENT_SECRET || '',
  twitterCallbackUrl: process.env.TWITTER_CALLBACK_URL || '',
  
  // ============================================
  // API Server
  // ============================================
  
  apiPort: parseInt(process.env.API_PORT || '3001'),
  frontendUrl: process.env.FRONTEND_URL || '',
  
  // ============================================
  // Rate Limiting
  // ============================================
  
  // Rate limit: minutes between token creations per user
  rateLimitMinutes: parseInt(process.env.RATE_LIMIT_MINUTES || '1'),
  
  // Polling interval in seconds
  pollIntervalSeconds: parseInt(process.env.POLL_INTERVAL_SECONDS || '5'),
};

/**
 * Initialize configuration (load private key)
 * Must be called before using config.privateKey
 */
export async function initConfig(): Promise<void> {
  config.privateKey = await loadPrivateKey();
}

/**
 * Check if config has been initialized
 */
export function isConfigInitialized(): boolean {
  return config.privateKey.length > 0;
}
